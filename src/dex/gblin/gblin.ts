import { Interface } from '@ethersproject/abi';
import {
  Token,
  Address,
  ExchangePrices,
  PoolPrices,
  AdapterExchangeParam,
  SimpleExchangeParam,
  PoolLiquidity,
  Logger,
  NumberAsString,
  DexExchangeParam,
  PoolReserves,
} from '../../types';
import {
  SwapSide,
  Network,
  UNLIMITED_USD_LIQUIDITY,
  UNLIMITED_RESERVES,
} from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getDexKeysWithNetwork } from '../../utils';
import { IDex } from '../idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { GblinData, GblinPoolState } from './types';
import { SimpleExchange } from '../simple-exchange';
import { GblinConfig } from './config';
import { GblinEventPool } from './gblin-pool';
import { BI_POWS } from '../../bigint-constants';
import GBLIN_ABI from '../../abi/gblin/GBLIN.json';
import { directionalReserves } from '../../lib/pools-storage/reserves';

const BPS = 10_000n;
const SECONDS_PER_YEAR = 365n * 24n * 60n * 60n;
// virtual shares and assets the vault adds to the mint formula
const VIRTUAL_SHARES = 1_000_000n;
const VIRTUAL_ASSETS = 1n;
// buyGBLINWithWeth, measured on Base
const MINT_GAS_COST = 560_000;

// GBLIN is an on-chain index vault on Base (cbBTC, WETH, USDC). Shares are minted at net asset
// value with WETH through `buyGBLINWithWeth`, with no cap and no price impact, so the vault is a
// liquidity source of unlimited depth for WETH -> GBLIN. Redemption pays out the basket in kind
// (three tokens) and is not a swap, so GBLIN -> WETH is left to the pools.
export class Gblin extends SimpleExchange implements IDex<GblinData> {
  protected eventPool: GblinEventPool;

  readonly hasConstantPriceLargeAmounts = true;
  readonly needWrapNative = true;
  readonly isFeeOnTransferSupported = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(GblinConfig);

  logger: Logger;
  readonly vault: Address;
  readonly weth: Address;
  readonly vaultIface: Interface;

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
  ) {
    super(dexHelper, dexKey);
    const params = GblinConfig[dexKey][network];
    this.vault = params.vault.toLowerCase();
    this.weth = params.weth.toLowerCase();
    this.vaultIface = new Interface(GBLIN_ABI);
    this.logger = dexHelper.getLogger(dexKey);
    this.eventPool = new GblinEventPool(
      dexKey,
      network,
      dexHelper,
      this.logger,
      params.vault,
      params.lens,
      params.feedAggregators,
      this.vaultIface,
    );
  }

  async initializePricing(blockNumber: number) {
    await this.eventPool.initialize(blockNumber);
  }

  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return null;
  }

  private isWeth(address: Address) {
    return address.toLowerCase() === this.weth;
  }

  private isVault(address: Address) {
    return address.toLowerCase() === this.vault;
  }

  // Only WETH -> GBLIN with an exact input: the vault mints from an amount of WETH and has no
  // function that mints an exact number of shares.
  private isMint(srcToken: Token, destToken: Token, side: SwapSide): boolean {
    const src = this.dexHelper.config.wrapETH(srcToken);
    return (
      side === SwapSide.SELL &&
      this.isWeth(src.address) &&
      this.isVault(destToken.address)
    );
  }

  private poolIdentifier() {
    return `${this.dexKey}_${this.vault}`;
  }

  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    return this.isMint(srcToken, destToken, side)
      ? [this.poolIdentifier()]
      : [];
  }

  // Shares out for `wethIn`, as `GBLINLens.quoteBuy` computes them: the two fees come off the
  // input, then the net amount is converted at the supply-to-NAV ratio, with the management fee
  // accrued up to the time the state was read. Accruing to an earlier time under-states the
  // supply, which under-quotes the output: the vault never pays less than quoted for that reason.
  static sharesOut(wethIn: bigint, state: GblinPoolState): bigint {
    if (wethIn === 0n) return 0n;
    const protocolFee = (wethIn * state.protocolFeeBps) / BPS;
    const stabilityFee = (wethIn * state.stabilityFeeBps) / BPS;
    let supply = state.supply;
    if (state.lastAccrual !== 0n && state.timestamp > state.lastAccrual) {
      supply +=
        (supply *
          state.managementFeeBps *
          (state.timestamp - state.lastAccrual)) /
        (BPS * SECONDS_PER_YEAR);
    }
    return (
      ((wethIn - protocolFee - stabilityFee) * (supply + VIRTUAL_SHARES)) /
      (state.navEth + VIRTUAL_ASSETS)
    );
  }

  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<GblinData>> {
    if (!this.isMint(srcToken, destToken, side)) return null;
    if (limitPools && !limitPools.includes(this.poolIdentifier())) return null;

    const state = await this.eventPool.getOrGenerateState(blockNumber);
    if (!state || !state.navReliable) return null;

    return [
      {
        unit: Gblin.sharesOut(BI_POWS[18], state),
        prices: amounts.map(amount => Gblin.sharesOut(amount, state)),
        gasCost: MINT_GAS_COST,
        data: { exchange: this.vault },
        poolAddresses: [this.vault],
        poolIdentifiers: [this.poolIdentifier()],
        exchange: this.dexKey,
      },
    ];
  }

  getCalldataGasCost(poolPrices: PoolPrices<GblinData>): number | number[] {
    return CALLDATA_GAS_COST.DEX_NO_PAYLOAD;
  }

  async updatePoolState(): Promise<void> {
    const state = this.eventPool.getStaleState();
    if (!state) {
      const blockNumber = await this.dexHelper.provider.getBlockNumber();
      const fresh = await this.eventPool.generateState(blockNumber);
      this.eventPool.setState(fresh, blockNumber);
    }
  }

  // WETH -> GBLIN mints with no cap; the vault does not swap GBLIN back into WETH.
  getPoolReserves(): PoolReserves[] {
    const state = this.eventPool.getStaleState();
    if (!state || !state.navReliable) return [];
    return [
      {
        dex: this.dexKey,
        id: this.vault,
        address: this.vault,
        reserves: directionalReserves([
          { src: this.weth, dest: this.vault, capacity: UNLIMITED_RESERVES },
        ]),
      },
    ];
  }

  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    if (!this.isWeth(tokenAddress)) return [];
    return [
      {
        exchange: this.dexKey,
        address: this.vault,
        connectorTokens: [
          {
            decimals: 18,
            address: this.vault,
            liquidityUSD: UNLIMITED_USD_LIQUIDITY,
          },
        ],
        liquidityUSD: UNLIMITED_USD_LIQUIDITY,
      },
    ];
  }

  // Augustus V5 path: the shares go to Augustus, which forwards them.
  async getSimpleParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: GblinData,
    side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    const swapData = this.vaultIface.encodeFunctionData('buyGBLINWithWeth', [
      srcAmount,
      '0',
      this.augustusAddress,
    ]);
    return this.buildSimpleParamWithoutWETHConversion(
      srcToken,
      srcAmount,
      destToken,
      destAmount,
      swapData,
      data.exchange,
    );
  }

  // The vault pulls the WETH from the caller and mints to `receiver`. The executor overwrites the
  // amount with what it actually holds; `minOut` is left at zero because the router enforces the
  // user's minimum on the whole route.
  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: GblinData,
    side: SwapSide,
  ): DexExchangeParam {
    const swapData = this.vaultIface.encodeFunctionData('buyGBLINWithWeth', [
      srcAmount,
      '0',
      recipient,
    ]);
    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: true,
      exchangeData: swapData,
      targetExchange: data.exchange,
      returnAmountPos: undefined,
    };
  }

  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: GblinData,
    side: SwapSide,
  ): AdapterExchangeParam {
    return { targetExchange: data.exchange, payload: '0x', networkFee: '0' };
  }
}

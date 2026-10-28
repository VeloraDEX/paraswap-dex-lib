import { Interface } from '@ethersproject/abi';
import { BytesLike } from 'ethers';
import {
  Token,
  Address,
  ExchangePrices,
  PoolPrices,
  AdapterExchangeParam,
  PoolLiquidity,
  Logger,
  DexExchangeParam,
  NumberAsString,
} from '../../types';
import { SwapSide, Network } from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getDexKeysWithNetwork } from '../../utils';
import { IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { MultiResult } from '../../lib/multi-wrapper';
import { addressDecode, generalDecoder } from '../../lib/decoders';
import { extractReturnAmountPosition } from '../../executor/utils';
import { BI_POWS } from '../../bigint-constants';
import ERC20ABI from '../../abi/erc20.json';
import OrbitalPoolABI from '../../abi/orbital/OrbitalPool.json';
import OrbitalFactoryABI from '../../abi/orbital/OrbitalFactory.json';
import {
  getLocalDeadlineAsFriendlyPlaceholder,
  SimpleExchange,
} from '../simple-exchange';
import { OrbitalConfig } from './config';
import { OrbitalEventPool } from './orbital-pool';
import { OrbitalData, OrbitalPoolInfo, PoolState } from './types';
import { OrbitalQuoteError } from './contract-math/errors';
import { quoteExactInput, quoteExactOutput } from './contract-math/quote';

// Gas of a swap that crosses no tick, and per crossed tick (interior <-> boundary), measured by the Orbital SDK on
// the Polygon pool (@orbitaldefi/sdk SWAP_BASE_GAS / SWAP_CROSSING_GAS) less the 21k transaction base cost.
const SWAP_GAS = 239_000;
const CROSSING_GAS = 190_000;

export class Orbital extends SimpleExchange implements IDex<OrbitalData> {
  protected eventPools: Record<string, OrbitalEventPool> = {};

  readonly hasConstantPriceLargeAmounts = false;
  // Orbital pools hold ERC-20s only.
  readonly needWrapNative = true;

  readonly isFeeOnTransferSupported = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(OrbitalConfig);

  logger: Logger;

  readonly poolIface = new Interface(OrbitalPoolABI);
  readonly factoryIface = new Interface(OrbitalFactoryABI);
  readonly erc20Iface = new Interface(ERC20ABI);
  readonly factory: Address;

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey);
    this.factory = OrbitalConfig[dexKey][network].factory;
  }

  async initializePricing(blockNumber: number) {
    await this.discoverPools(blockNumber, true);
  }

  /** Reads the factory's pool list and starts tracking every pool not tracked yet. */
  private async discoverPools(blockNumber: number, subscribe: boolean) {
    const [length] = await this.dexHelper.multiWrapper.aggregate<bigint>(
      [
        {
          target: this.factory,
          callData: this.factoryIface.encodeFunctionData('allPoolsLength'),
          decodeFunction: (r: MultiResult<BytesLike> | BytesLike) =>
            generalDecoder(r, ['uint256'], undefined, v =>
              BigInt(v[0].toString()),
            ),
        },
      ],
      blockNumber,
    );
    const known = new Set(Object.keys(this.eventPools));
    const addresses = (
      await this.dexHelper.multiWrapper.aggregate<string>(
        Array.from({ length: Number(length) }, (_, i) => ({
          target: this.factory,
          callData: this.factoryIface.encodeFunctionData('allPools', [i]),
          decodeFunction: addressDecode,
        })),
        blockNumber,
      )
    ).filter(address => !known.has(address.toLowerCase()));
    if (!addresses.length) return;

    const infos = await this.readPoolInfos(addresses, blockNumber);
    for (const info of infos) {
      const eventPool = new OrbitalEventPool(
        this.dexKey,
        this.network,
        this.dexHelper,
        this.logger,
        info,
        this.poolIface,
      );
      if (subscribe) {
        await eventPool.initialize(blockNumber);
      } else {
        eventPool.setState(
          await eventPool.generateState(blockNumber),
          blockNumber,
        );
      }
      this.eventPools[info.address.toLowerCase()] = eventPool;
    }
  }

  /** Assets, fee and asset decimals of each pool: immutables, read once. */
  private async readPoolInfos(
    pools: Address[],
    blockNumber: number,
  ): Promise<OrbitalPoolInfo[]> {
    const immutables = await this.dexHelper.multiWrapper.aggregate<any>(
      pools.flatMap(pool => [
        ...[0, 1, 2].map(i => ({
          target: pool,
          callData: this.poolIface.encodeFunctionData('assets', [i]),
          decodeFunction: addressDecode,
        })),
        {
          target: pool,
          callData: this.poolIface.encodeFunctionData('fee'),
          decodeFunction: (r: MultiResult<BytesLike> | BytesLike) =>
            generalDecoder(r, ['uint256'], undefined, v =>
              BigInt(v[0].toString()),
            ),
        },
      ]),
      blockNumber,
    );
    const assets = pools.map(
      (_, p) => immutables.slice(4 * p, 4 * p + 3) as [string, string, string],
    );
    const decimals = await this.dexHelper.multiWrapper.aggregate<number>(
      assets.flat().map(token => ({
        target: token,
        callData: this.erc20Iface.encodeFunctionData('decimals'),
        decodeFunction: (r: MultiResult<BytesLike> | BytesLike) =>
          generalDecoder(r, ['uint8'], undefined, v => Number(v[0])),
      })),
      blockNumber,
    );
    return pools.map((address, p) => ({
      address,
      assets: assets[p],
      decimals: decimals.slice(3 * p, 3 * p + 3) as [number, number, number],
      fee: immutables[4 * p + 3],
    }));
  }

  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return null;
  }

  private poolIdentifier(pool: Address): string {
    return `${this.dexKey}_${pool}`.toLowerCase();
  }

  /** Pools holding both tokens, with each token's asset index. */
  private poolsFor(
    srcToken: Token,
    destToken: Token,
  ): { eventPool: OrbitalEventPool; assetIn: number; assetOut: number }[] {
    const src = srcToken.address.toLowerCase();
    const dest = destToken.address.toLowerCase();
    if (src === dest) return [];
    return Object.values(this.eventPools).flatMap(eventPool => {
      const assets = eventPool.poolInfo.assets.map(a => a.toLowerCase());
      const assetIn = assets.indexOf(src);
      const assetOut = assets.indexOf(dest);
      return assetIn < 0 || assetOut < 0
        ? []
        : [{ eventPool, assetIn, assetOut }];
    });
  }

  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    return this.poolsFor(srcToken, destToken)
      .filter(({ eventPool }) => {
        const state = eventPool.getState(blockNumber);
        return state && !state.isShutdown;
      })
      .map(({ eventPool }) => this.poolIdentifier(eventPool.poolInfo.address));
  }

  /**
   * Exact amounts from the pool's quote path: SELL quotes an exact input (`swapExactInput`), BUY an exact output
   * (`swapExactOutput`). An amount the pool would refuse (beyond its widest tick, below the minimum…) prices at 0.
   */
  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<OrbitalData>> {
    const result: ExchangePrices<OrbitalData> = [];
    for (const { eventPool, assetIn, assetOut } of this.poolsFor(
      srcToken,
      destToken,
    )) {
      const address = eventPool.poolInfo.address;
      const identifier = this.poolIdentifier(address);
      if (limitPools && !limitPools.includes(identifier)) continue;
      const state = eventPool.getState(blockNumber) as PoolState | null;
      if (!state || state.isShutdown) continue;

      const price = (amount: bigint): [bigint, number] => {
        if (amount === 0n) return [0n, 0];
        try {
          const quote =
            side === SwapSide.SELL
              ? quoteExactInput(state, assetIn, assetOut, amount)
              : quoteExactOutput(state, assetIn, assetOut, amount);
          const value =
            side === SwapSide.SELL ? quote.amountOut : (quote as any).amountIn;
          return [value, SWAP_GAS + CROSSING_GAS * quote.ticksCrossed];
        } catch (e) {
          if (e instanceof OrbitalQuoteError) return [0n, 0];
          throw e;
        }
      };
      const priced = amounts.map(price);
      if (priced.every(([value]) => value === 0n)) continue;
      const unitToken = side === SwapSide.SELL ? srcToken : destToken;

      result.push({
        prices: priced.map(([value]) => value),
        unit: price(BI_POWS[unitToken.decimals])[0],
        gasCost: priced.map(([, gas]) => gas),
        exchange: this.dexKey,
        poolIdentifiers: [identifier],
        poolAddresses: [address],
        data: { exchange: address, assetIn, assetOut },
      });
    }
    return result.length ? result : null;
  }

  // assetIn, assetOut, two amounts, recipient and deadline.
  getCalldataGasCost(poolPrices: PoolPrices<OrbitalData>): number | number[] {
    return (
      CALLDATA_GAS_COST.DEX_OVERHEAD +
      CALLDATA_GAS_COST.FUNCTION_SELECTOR +
      CALLDATA_GAS_COST.INDEX * 2 +
      CALLDATA_GAS_COST.AMOUNT * 2 +
      CALLDATA_GAS_COST.ADDRESS +
      CALLDATA_GAS_COST.TIMESTAMP
    );
  }

  // Legacy V5 adapters are not supported: Orbital is integrated for Augustus V6 (getDexParam).
  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: OrbitalData,
    side: SwapSide,
  ): AdapterExchangeParam {
    return { targetExchange: data.exchange, payload: '0x', networkFee: '0' };
  }

  /**
   * SELL: swapExactInput(assetIn, assetOut, srcAmount, destAmount as minimum output, recipient, deadline).
   * BUY: swapExactOutput(assetIn, assetOut, destAmount, srcAmount as maximum input, recipient, deadline).
   * The pool pulls the input from msg.sender with transferFrom, so it is the spender.
   */
  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: OrbitalData,
    side: SwapSide,
  ): DexExchangeParam {
    const { exchange, assetIn, assetOut } = data;
    const deadline = getLocalDeadlineAsFriendlyPlaceholder();
    const exchangeData =
      side === SwapSide.SELL
        ? this.poolIface.encodeFunctionData('swapExactInput', [
            assetIn,
            assetOut,
            srcAmount,
            destAmount,
            recipient,
            deadline,
          ])
        : this.poolIface.encodeFunctionData('swapExactOutput', [
            assetIn,
            assetOut,
            destAmount,
            srcAmount,
            recipient,
            deadline,
          ]);

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: true,
      exchangeData,
      targetExchange: exchange,
      spender: exchange,
      returnAmountPos:
        side === SwapSide.SELL
          ? extractReturnAmountPosition(
              this.poolIface,
              'swapExactInput',
              'amountOut',
            )
          : undefined,
    };
  }

  async updatePoolState(): Promise<void> {
    const blockNumber = await this.dexHelper.web3Provider.eth.getBlockNumber();
    await this.discoverPools(blockNumber, false);
    await Promise.all(
      Object.values(this.eventPools).map(async eventPool =>
        eventPool.setState(
          await eventPool.generateState(blockNumber),
          blockNumber,
        ),
      ),
    );
  }

  /** Pools holding `tokenAddress`, by the USD value of their real reserves; the two other assets are connectors. */
  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    const token = tokenAddress.toLowerCase();
    const pools: PoolLiquidity[] = [];
    for (const eventPool of Object.values(this.eventPools)) {
      const { address, assets, decimals } = eventPool.poolInfo;
      const index = assets.findIndex(a => a.toLowerCase() === token);
      const state = eventPool.getStaleState() as PoolState | null;
      if (index < 0 || !state || state.isShutdown) continue;

      // Real reserve of each asset: the invariant reserve less the virtual floor, in raw units.
      const usd = await Promise.all(
        assets.map((asset, i) =>
          this.dexHelper.getTokenUSDPrice(
            { address: asset, decimals: decimals[i] },
            (state.reserves[i] - state.floor) / state.scales[i],
          ),
        ),
      );
      pools.push({
        exchange: this.dexKey,
        address,
        connectorTokens: assets
          .map((asset, i) => ({
            address: asset,
            decimals: decimals[i],
            liquidityUSD: usd[i],
          }))
          .filter((_, i) => i !== index),
        liquidityUSD: usd.reduce((sum, v) => sum + v, 0),
      });
    }
    return pools
      .sort((a, b) => b.liquidityUSD - a.liquidityUSD)
      .slice(0, limit);
  }
}

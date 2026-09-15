import { Interface } from '@ethersproject/abi';
import {
  Token,
  Address,
  ExchangePrices,
  PoolPrices,
  AdapterExchangeParam,
  PoolLiquidity,
  Logger,
  NumberAsString,
  DexExchangeParam,
} from '../../types';
import { SwapSide, Network, MAX_UINT } from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getDexKeysWithNetwork } from '../../utils';
import { IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { WstGBPData, PoolState, DexParams } from './types';
import { SimpleExchange } from '../simple-exchange';
import { WstGBPConfig } from './config';
import { uint256ToBigInt, booleanDecode } from '../../lib/decoders';
import { Utils } from '../../utils';
import WsgemAdapterABI from '../../abi/wstgbp/WsgemDirectAdapter.json';
import WstGBPWrapperABI from '../../abi/wstgbp/wstGBP.json';
import ERC20ABI from '../../abi/erc20.json';
import { extractReturnAmountPosition } from '../../executor/utils';

const WAD = 1000000000000000000n;
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

/**
 * WstGBP — the tGBP <-> wstGBP atomic wrapper venue, PSM-like: a constant-price market at the wrapper
 * protocol's own oracle prices. Buys of wstGBP execute at `mintcost()` (ask), sells at `burncost()`
 * (bid, ~25bps below); prices ratchet up slowly (weekly NAV steps) and are size-independent within the
 * caps.
 *
 * Swaps route through the ownerless, inventory-free `WsgemDirectAdapter` (plain approve -> swap with a
 * recipient param; direction inferred from tokenIn; exact-in and exact-out; the adapter's own view
 * quotes mirror execution bit-for-bit). Depth caps: buys are limited by the wrapper's remaining supply
 * capacity, sells by the wrapper's tGBP reserve. There are no events to track — state is a handful of
 * view reads, refreshed per pricing tick like wstETH.
 */
export class WstGBP extends SimpleExchange implements IDex<WstGBPData> {
  static readonly adapterIface = new Interface(WsgemAdapterABI);
  static readonly wrapperIface = new Interface(WstGBPWrapperABI);
  static readonly erc20Iface = new Interface(ERC20ABI);

  protected config: DexParams;

  readonly hasConstantPriceLargeAmounts = true;

  readonly needWrapNative = false;

  readonly isFeeOnTransferSupported = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(WstGBPConfig);

  logger: Logger;

  private state: { blockNumber: number } & PoolState = {
    blockNumber: 0,
    mintcost: 0n,
    burncost: 0n,
    capacity: 0n,
    totalSupply: 0n,
    tGBPReserve: 0n,
    mintable: false,
    burnable: false,
    cooldown: 0n,
  };

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
  ) {
    super(dexHelper, dexKey);
    const config = WstGBPConfig[dexKey][network];
    this.config = {
      adapterAddress: config.adapterAddress.toLowerCase(),
      wstGBPAddress: config.wstGBPAddress.toLowerCase(),
      tGBPAddress: config.tGBPAddress.toLowerCase(),
    };
    this.logger = dexHelper.getLogger(dexKey);
  }

  // v6-only integration: no Augustus v5 adapter contracts.
  getAdapters(_side: SwapSide): { name: string; index: number }[] | null {
    return null;
  }

  /** true = buy wstGBP (tGBP in / mint), false = sell wstGBP (wstGBP in / redeem), null = not our pair. */
  protected direction(srcToken: Token, destToken: Token): boolean | null {
    const src = srcToken.address.toLowerCase();
    const dest = destToken.address.toLowerCase();
    if (src === this.config.tGBPAddress && dest === this.config.wstGBPAddress)
      return true;
    if (src === this.config.wstGBPAddress && dest === this.config.tGBPAddress)
      return false;
    return null;
  }

  // Not relevant for hasConstantPriceLargeAmounts exchanges: one virtual pool.
  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    _side: SwapSide,
    _blockNumber: number,
  ): Promise<string[]> {
    if (this.direction(srcToken, destToken) === null) return [];
    return [this.dexKey];
  }

  protected async getState(
    blockNumber: number,
  ): Promise<{ blockNumber: number } & PoolState> {
    if (blockNumber <= this.state.blockNumber) return this.state;

    const cached = await this.dexHelper.cache.get(
      this.dexKey,
      this.network,
      'state',
    );
    if (cached) {
      this.state = Utils.Parse(cached);
      if (blockNumber <= this.state.blockNumber) return this.state;
    }

    const wrapper = this.config.wstGBPAddress;
    const calls = [
      ...['mintcost', 'burncost', 'capacity', 'totalSupply', 'cooldown'].map(
        fn => ({
          target: wrapper,
          callData: WstGBP.wrapperIface.encodeFunctionData(fn),
          decodeFunction: uint256ToBigInt,
        }),
      ),
      ...['mintable', 'burnable'].map(fn => ({
        target: wrapper,
        callData: WstGBP.wrapperIface.encodeFunctionData(fn),
        decodeFunction: booleanDecode,
      })),
      {
        target: this.config.tGBPAddress,
        callData: WstGBP.erc20Iface.encodeFunctionData('balanceOf', [wrapper]),
        decodeFunction: uint256ToBigInt,
      },
    ];
    const results = await this.dexHelper.multiWrapper.tryAggregate<
      bigint | boolean
    >(true, calls, blockNumber);

    this.state = {
      blockNumber,
      mintcost: results[0].returnData as bigint,
      burncost: results[1].returnData as bigint,
      capacity: results[2].returnData as bigint,
      totalSupply: results[3].returnData as bigint,
      cooldown: results[4].returnData as bigint,
      mintable: results[5].returnData as boolean,
      burnable: results[6].returnData as boolean,
      tGBPReserve: results[7].returnData as bigint,
    };
    this.dexHelper.cache.setex(
      this.dexKey,
      this.network,
      'state',
      60,
      Utils.Serialize(this.state),
    );
    return this.state;
  }

  /**
   * Pure conversion at the oracle price — the exact wrapper math, no size gating (mirrors the
   * on-chain venue bit-for-bit):
   * - buy exact-in:   wstGBPOut = tGBPIn * 1e18 / mintcost         (floor)
   * - buy exact-out:  tGBPIn    = ceil(wstGBPOut * mintcost / 1e18)
   * - sell exact-in:  tGBPOut   = wstGBPIn * burncost / 1e18       (floor)
   * - sell exact-out: wstGBPIn  = ceil(tGBPOut * 1e18 / burncost)
   */
  protected convert(
    buy: boolean,
    side: SwapSide,
    amount: bigint,
    state: PoolState,
  ): bigint {
    if (buy) {
      return side === SwapSide.SELL
        ? (amount * WAD) / state.mintcost
        : ceilDiv(amount * state.mintcost, WAD);
    }
    return side === SwapSide.SELL
      ? (amount * state.burncost) / WAD
      : ceilDiv(amount * WAD, state.burncost);
  }

  /**
   * `convert`, gated by the wrapper's dust floors and depth caps: amounts the on-chain venue would
   * revert on price to 0 (unfillable).
   */
  protected compute(
    buy: boolean,
    side: SwapSide,
    amount: bigint,
    state: PoolState,
  ): bigint {
    if (amount === 0n) return 0n;
    const headroom =
      state.capacity > state.totalSupply
        ? state.capacity - state.totalSupply
        : 0n;
    if (buy) {
      if (side === SwapSide.SELL) {
        // Wrapper dust floor: mint reverts below one wstGBP-worth of tGBP.
        if (amount < state.mintcost) return 0n;
        const out = this.convert(buy, side, amount, state);
        return out <= headroom ? out : 0n;
      }
      const tGBPIn = this.convert(buy, side, amount, state);
      if (tGBPIn < state.mintcost) return 0n;
      // `mint(tGBPIn)` mints tGBPIn*1e18/mintcost, which is >= the requested output (the input was
      // rounded up). The wrapper's capacity gate applies to that minted amount, so check it — not
      // the requested output — or the quote could read fillable while the mint reverts at the
      // capacity boundary.
      const minted = (tGBPIn * WAD) / state.mintcost;
      return minted <= headroom ? tGBPIn : 0n;
    }
    if (side === SwapSide.SELL) {
      // Wrapper dust floor: redeem reverts below 1 wstGBP.
      if (amount < WAD) return 0n;
      const out = this.convert(buy, side, amount, state);
      return out <= state.tGBPReserve ? out : 0n;
    }
    const wstGBPIn = this.convert(buy, side, amount, state);
    if (wstGBPIn < WAD) return 0n;
    // The wrapper pays claim = wstGBPIn * burncost / 1e18 (>= amount); it must be fully funded.
    const claim = (wstGBPIn * state.burncost) / WAD;
    return claim <= state.tGBPReserve ? wstGBPIn : 0n;
  }

  // Returns pool prices for amounts. limitPools ignored (hasConstantPriceLargeAmounts).
  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    _limitPools?: string[],
  ): Promise<null | ExchangePrices<WstGBPData>> {
    const buy = this.direction(srcToken, destToken);
    if (buy === null) return null;

    const state = await this.getState(blockNumber);

    // Availability gates: time-gated markets, paused oracle (price == 0), and — for sells — a
    // non-zero redemption cooldown would defer the payout, so the venue is unusable.
    if (buy) {
      if (!state.mintable || state.mintcost === 0n) return null;
    } else {
      if (!state.burnable || state.burncost === 0n || state.cooldown !== 0n)
        return null;
    }

    // `unit` is the marginal-rate reference (rate for exactly 1e18), so it uses the ungated
    // conversion: the 1e18 probe can sit below the wrapper's mint dust floor (mintcost > 1e18)
    // even when the venue is fully live, and a 0 unit would read as unpriceable.
    const unit = this.convert(buy, side, WAD, state);
    const prices = amounts.map(a => this.compute(buy, side, a, state));

    return [
      {
        unit,
        prices,
        data: {},
        poolAddresses: [this.config.adapterAddress],
        exchange: this.dexKey,
        // Fork-measured end-to-end: mint ~141k, redeem ~213k.
        gasCost: buy ? 150_000 : 220_000,
        poolIdentifiers: [this.dexKey],
      },
    ];
  }

  // Returns estimated gas cost of calldata for this DEX in multiSwap.
  getCalldataGasCost(_poolPrices: PoolPrices<WstGBPData>): number | number[] {
    // swapExactInput/Output: selector + (tokenIn, amount, bound, recipient, deadline).
    return (
      CALLDATA_GAS_COST.DEX_OVERHEAD +
      CALLDATA_GAS_COST.LENGTH_SMALL +
      CALLDATA_GAS_COST.ADDRESS +
      CALLDATA_GAS_COST.AMOUNT +
      CALLDATA_GAS_COST.AMOUNT +
      CALLDATA_GAS_COST.ADDRESS +
      CALLDATA_GAS_COST.FULL_WORD
    );
  }

  // Augustus v5 path is not supported (v6-only integration).
  getAdapterParam(
    _srcToken: string,
    _destToken: string,
    _srcAmount: string,
    _destAmount: string,
    _data: WstGBPData,
    _side: SwapSide,
  ): AdapterExchangeParam {
    return {
      targetExchange: this.config.adapterAddress,
      payload: '0x',
      networkFee: '0',
    };
  }

  async getDexParam(
    srcToken: Address,
    _destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    _data: WstGBPData,
    side: SwapSide,
  ): Promise<DexExchangeParam> {
    // Direction is inferred on-chain from tokenIn; slippage is enforced by Augustus on the final
    // received amount, so the venue-level bounds are the loosest valid ones. The adapter's deadline
    // guard is satisfied with MAX_UINT (Augustus applies the order deadline).
    const exchangeData =
      side === SwapSide.SELL
        ? WstGBP.adapterIface.encodeFunctionData('swapExactInput', [
            srcToken,
            srcAmount,
            '1',
            recipient,
            MAX_UINT,
          ])
        : WstGBP.adapterIface.encodeFunctionData('swapExactOutput', [
            srcToken,
            destAmount,
            srcAmount,
            recipient,
            MAX_UINT,
          ]);

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: true,
      exchangeData,
      targetExchange: this.config.adapterAddress,
      spender: this.config.adapterAddress,
      returnAmountPos:
        side === SwapSide.SELL
          ? extractReturnAmountPosition(WstGBP.adapterIface, 'swapExactInput')
          : undefined,
    };
  }

  // Returns the single virtual pool when the token is one of the pair.
  async getTopPoolsForToken(
    tokenAddress: Address,
    _limit: number,
  ): Promise<PoolLiquidity[]> {
    const token = tokenAddress.toLowerCase();
    const { tGBPAddress, wstGBPAddress } = this.config;
    if (token !== tGBPAddress && token !== wstGBPAddress) return [];

    const blockNumber = await this.dexHelper.web3Provider.eth.getBlockNumber();
    const state = await this.getState(blockNumber);

    // Depth in tGBP terms: buys limited by remaining wstGBP capacity (valued at mintcost), sells by
    // the wrapper's tGBP reserve. Follow the PSM convention of 2x the min side; tGBP is a GBP stable,
    // so tGBP ~= USD understates liquidity slightly (conservative).
    const headroom =
      state.capacity > state.totalSupply
        ? state.capacity - state.totalSupply
        : 0n;
    const buyDepthTGBP = (headroom * state.mintcost) / WAD;
    const minSide =
      buyDepthTGBP < state.tGBPReserve ? buyDepthTGBP : state.tGBPReserve;
    const liquidityUSD = 2 * (Number(minSide) / Number(WAD));

    return [
      {
        exchange: this.dexKey,
        address: this.config.adapterAddress,
        connectorTokens: [
          {
            decimals: 18,
            address: token === tGBPAddress ? wstGBPAddress : tGBPAddress,
          },
        ],
        liquidityUSD,
      },
    ];
  }
}

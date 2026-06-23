import { Interface } from '@ethersproject/abi';
import { BytesLike } from 'ethers/lib/utils';
import {
  Address,
  DexExchangeParam,
  ExchangePrices,
  GetDexParamOptions,
  NumberAsString,
  PoolPrices,
  Token,
} from '../../types';
import { Network, SwapSide } from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getBigIntPow, getDexKeysWithNetwork, isETHAddress } from '../../utils';
import { IDexHelper } from '../../dex-helper';
import { UniswapV3 } from '../uniswap-v3/uniswap-v3';
import {
  getLocalDeadlineAsFriendlyPlaceholder,
  SimpleExchange,
} from '../simple-exchange';
import UniswapV3QuoterV2ABI from '../../abi/uniswap-v3/UniswapV3QuoterV2.abi.json';
import { extractReturnAmountPosition } from '../../executor/utils';
import { generalDecoder, uint256ToBigInt } from '../../lib/decoders';
import { MultiCallParams, MultiResult } from '../../lib/multi-wrapper';
import { Adapters, MachimaConfig } from './config';
import {
  MachimaData,
  MachimaDexParams,
  MachimaTokenInfo,
  PairClassification,
} from './types';
import {
  AGGREGATOR_QUOTER_ABI,
  AGGREGATOR_ROUTER_ABI,
  CLANK_NOW_ABI,
  MACHIMA_TOKEN_ABI,
} from './abi';
import {
  BPS_DENOMINATOR,
  MACHIMA_ANTI_SNIPER_WINDOW_S,
  MACHIMA_BASE_GAS,
  MACHIMA_CROSS_TICK_GAS,
  MACHIMA_POOL_FEE,
  MACHIMA_TOKEN_INFO_TTL_MS,
  MACHIMA_WRAPPER_GAS_OVERHEAD,
} from './constants';

const decodeTaxConfig = (
  result: MultiResult<BytesLike> | BytesLike,
): { buyTaxBps: number; sellTaxBps: number; hasTax: boolean } =>
  generalDecoder(
    result,
    [
      'uint16',
      'uint16',
      'address',
      'address',
      'uint16',
      'uint16',
      'uint16',
      'bool',
    ],
    { buyTaxBps: 0, sellTaxBps: 0, hasTax: false },
    v => ({
      buyTaxBps: Number(v[0]),
      sellTaxBps: Number(v[1]),
      hasTax: Boolean(v[7]),
    }),
  );

const decodeQuoteAmountOut = (
  result: MultiResult<BytesLike> | BytesLike,
): bigint =>
  generalDecoder(result, ['uint256', 'uint256', 'uint16'], 0n, v =>
    v[0].toBigInt(),
  );

/**
 * Machima — a Uniswap V3 fork on Base with a per-token tax layer, an
 * anti-sniper window, and a permissioned swap adapter. Trades are executed
 * through the standard-interface MachimaAggregatorRouter (immutable wrapper),
 * and pricing reuses the UniswapV3 base class for tick math while overlaying
 * Machima's tax/floor/classification rules.
 *
 * Mirrors the KyberSwap dex-lib integration (pkg/liquidity-source/machima).
 */
export class Machima extends UniswapV3 {
  // ParaSwap V6: execution flows through getDexParam, no on-chain adapters.
  readonly hasConstantPriceLargeAmounts = false;
  readonly needWrapNative = true;
  readonly isFeeOnTransferSupported = false;

  protected machimaConfig: MachimaDexParams;
  protected readonly weth: Address;
  protected readonly usdc: Address;
  protected readonly xma: Address;

  protected readonly aggregatorRouterIface = new Interface(
    AGGREGATOR_ROUTER_ABI,
  );
  protected readonly aggregatorQuoterIface = new Interface(
    AGGREGATOR_QUOTER_ABI,
  );
  protected readonly clankNowIface = new Interface(CLANK_NOW_ABI);
  protected readonly machimaTokenIface = new Interface(MACHIMA_TOKEN_ABI);

  private tokenInfoCache: Record<string, MachimaTokenInfo> = {};
  private blockTimestampCache: Record<number, number> = {};

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(MachimaConfig);

  constructor(
    protected network: Network,
    dexKey: string,
    protected dexHelper: IDexHelper,
  ) {
    super(
      network,
      dexKey,
      dexHelper,
      Adapters[network] || {},
      new Interface(UniswapV3QuoterV2ABI),
      MachimaConfig[dexKey][network],
      [],
    );

    const cfg = MachimaConfig[dexKey][network];
    this.machimaConfig = {
      ...cfg,
      clankNow: cfg.clankNow.toLowerCase(),
      swapAdapter: cfg.swapAdapter.toLowerCase(),
      aggregatorRouter: cfg.aggregatorRouter.toLowerCase(),
      aggregatorQuoter: cfg.aggregatorQuoter.toLowerCase(),
      weth: cfg.weth.toLowerCase(),
      usdc: cfg.usdc.toLowerCase(),
      xma: cfg.xma.toLowerCase(),
    };
    this.weth = this.machimaConfig.weth;
    this.usdc = this.machimaConfig.usdc;
    this.xma = this.machimaConfig.xma;
  }

  // ---- Pair classification (mirrors MachimaAggregatorRouter._classifyPair) ----

  protected isCounterAsset(token: Address): boolean {
    return token === this.weth || token === this.usdc || token === this.xma;
  }

  /**
   * Classify a lowercased token pair into (token, counterAsset, isBuy).
   * Returns null when the pair is not routable on Machima.
   * XMA is dual-role: a counter-asset for launched tokens, but the traded
   * token itself when paired with WETH/USDC.
   */
  protected classifyPair(
    tokenIn: Address,
    tokenOut: Address,
  ): PairClassification | null {
    const inIsCounter = this.isCounterAsset(tokenIn);
    const outIsCounter = this.isCounterAsset(tokenOut);

    if (inIsCounter && !outIsCounter) {
      return { token: tokenOut, counterAsset: tokenIn, isBuy: true };
    }
    if (!inIsCounter && outIsCounter) {
      return { token: tokenIn, counterAsset: tokenOut, isBuy: false };
    }
    if (inIsCounter && outIsCounter) {
      if (tokenIn === this.xma && tokenOut !== this.xma) {
        return { token: this.xma, counterAsset: tokenOut, isBuy: false };
      }
      if (tokenOut === this.xma && tokenIn !== this.xma) {
        return { token: this.xma, counterAsset: tokenIn, isBuy: true };
      }
      return null; // both external (WETH/USDC) or both XMA
    }
    return null; // neither side is a counter-asset
  }

  // ---- Per-token tax + anti-sniper state ----

  // The anti-sniper gate is evaluated on-chain against block.timestamp, so it
  // must be compared to the timestamp of the block we are pricing at — not the
  // wall clock — otherwise historical/lagging quotes mis-classify the window.
  private isInAntiSniperWindow(
    info: MachimaTokenInfo,
    blockTimestamp: number,
  ): boolean {
    if (!info.poolDeploymentTime) return false;
    return (
      blockTimestamp < info.poolDeploymentTime + MACHIMA_ANTI_SNIPER_WINDOW_S
    );
  }

  private async getBlockTimestamp(blockNumber: number): Promise<number> {
    const cached = this.blockTimestampCache[blockNumber];
    if (cached !== undefined) return cached;
    const block = await this.dexHelper.web3Provider.eth.getBlock(blockNumber);
    const ts = Number(block.timestamp);
    this.blockTimestampCache[blockNumber] = ts;
    return ts;
  }

  protected async getMachimaTokenInfo(
    token: Address,
    blockNumber: number,
  ): Promise<MachimaTokenInfo> {
    const key = token.toLowerCase();
    const cached = this.tokenInfoCache[key];
    if (cached && Date.now() - cached.fetchedAtMs < MACHIMA_TOKEN_INFO_TTL_MS) {
      return cached;
    }

    const calls: MultiCallParams<any>[] = [
      {
        target: this.machimaConfig.clankNow,
        callData: this.clankNowIface.encodeFunctionData('getTokenTax', [token]),
        decodeFunction: decodeTaxConfig,
      },
      {
        target: token,
        callData: this.machimaTokenIface.encodeFunctionData(
          'poolDeploymentTime',
          [],
        ),
        decodeFunction: uint256ToBigInt,
      },
    ];

    let buyTaxBps = 0;
    let sellTaxBps = 0;
    let hasTax = false;
    let poolDeploymentTime = 0;

    try {
      const [taxRes, deployRes] =
        await this.dexHelper.multiWrapper.tryAggregate<any>(
          false,
          calls,
          blockNumber,
        );
      if (taxRes.success) {
        buyTaxBps = taxRes.returnData.buyTaxBps;
        sellTaxBps = taxRes.returnData.sellTaxBps;
        hasTax = taxRes.returnData.hasTax;
      }
      if (deployRes.success) {
        poolDeploymentTime = Number(deployRes.returnData);
      }
    } catch (e) {
      this.logger.warn(
        `${this.dexKey}: failed to fetch token info for ${token}, defaulting to no tax`,
        e,
      );
    }

    const info: MachimaTokenInfo = {
      buyTaxBps,
      sellTaxBps,
      hasTax,
      poolDeploymentTime,
      fetchedAtMs: Date.now(),
    };
    this.tokenInfoCache[key] = info;
    return info;
  }

  // ---- Pricing ----

  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<MachimaData>> {
    try {
      // MachimaAggregatorRouter is exact-input only.
      if (side === SwapSide.BUY) return null;

      const _src = this.dexHelper.config.wrapETH(srcToken);
      const _dst = this.dexHelper.config.wrapETH(destToken);
      const srcAddr = _src.address.toLowerCase();
      const dstAddr = _dst.address.toLowerCase();
      if (srcAddr === dstAddr) return null;

      const cls = this.classifyPair(srcAddr, dstAddr);
      if (!cls) return null;

      const info = await this.getMachimaTokenInfo(cls.token, blockNumber);
      if (info.poolDeploymentTime) {
        const blockTimestamp = await this.getBlockTimestamp(blockNumber);
        if (this.isInAntiSniperWindow(info, blockTimestamp)) return null;
      }

      // XMA sells hit the on-chain sell price floor (xmaSellSqrtPriceLimit),
      // which the local tick math does not model. Route XMA sells through the
      // aggregator quoter so floor + tax are applied exactly on-chain.
      if (!cls.isBuy && cls.token === this.xma) {
        return this.getPricesFromAggregatorQuoter(
          _src,
          _dst,
          amounts,
          blockNumber,
          limitPools,
        );
      }

      if (cls.isBuy) {
        // Buy: tax is deducted from the input before it reaches the pool.
        // Feed the post-tax amounts into the V3 math so the resulting token
        // outputs already account for the buy tax. The `unit` price is the
        // output for one whole unit of tokenIn; because the pool sees the taxed
        // input, the correct unit is V3((1 - tax) * 1 unit), not a linear
        // V3(1 unit) * (1 - tax). Append the taxed one-unit input as an extra
        // query amount and read its exact pool output back as the unit.
        const buyTax = BigInt(info.hasTax ? info.buyTaxBps : 0);
        const unitVolume = getBigIntPow(_src.decimals);
        const scaledUnit = unitVolume - (unitVolume * buyTax) / BPS_DENOMINATOR;
        const scaled = amounts.map(a => a - (a * buyTax) / BPS_DENOMINATOR);
        const res = await super.getPricesVolume(
          _src,
          _dst,
          [...scaled, scaledUnit],
          side,
          blockNumber,
          limitPools,
        );
        if (!res) return res;
        return res.map(pp => {
          const unit = pp.prices[pp.prices.length - 1];
          const prices = pp.prices.slice(0, amounts.length);
          const gasCost = Array.isArray(pp.gasCost)
            ? pp.gasCost.slice(0, amounts.length)
            : pp.gasCost;
          return {
            ...pp,
            unit,
            prices,
            gasCost: this.withMachimaGas(gasCost),
            exchange: this.dexKey,
          };
        });
      }

      // Sell (non-XMA token -> counter): tax is applied to the pool output.
      const sellTax = BigInt(info.hasTax ? info.sellTaxBps : 0);
      const res = await super.getPricesVolume(
        _src,
        _dst,
        amounts,
        side,
        blockNumber,
        limitPools,
      );
      if (!res) return res;
      return res.map(pp => ({
        ...pp,
        unit: pp.unit - (pp.unit * sellTax) / BPS_DENOMINATOR,
        prices: pp.prices.map(p =>
          p === 0n ? 0n : p - (p * sellTax) / BPS_DENOMINATOR,
        ),
        gasCost: this.withMachimaGas(pp.gasCost),
        exchange: this.dexKey,
      }));
    } catch (e) {
      this.logger.error(
        `Error_getPricesVolume ${srcToken.symbol || srcToken.address}, ${
          destToken.symbol || destToken.address
        }, ${side}:`,
        e,
      );
      return null;
    }
  }

  /**
   * Exact pricing via MachimaAggregatorQuoter.quote — applies classification,
   * tax, and the XMA sell floor on-chain. One multicall, used for XMA sells.
   */
  protected async getPricesFromAggregatorQuoter(
    _src: Token,
    _dst: Token,
    amounts: bigint[],
    blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<MachimaData>> {
    const srcAddr = _src.address.toLowerCase();
    const dstAddr = _dst.address.toLowerCase();

    const pool = await this.getPool(
      srcAddr,
      dstAddr,
      MACHIMA_POOL_FEE,
      blockNumber,
    );
    if (!pool) return null;

    const identifier = this.getPoolIdentifier(
      srcAddr,
      dstAddr,
      MACHIMA_POOL_FEE,
    );
    if (limitPools && !limitPools.includes(identifier)) return null;

    const unitAmount = getBigIntPow(_src.decimals);
    const queryAmounts = [unitAmount, ...amounts.slice(1)];

    const calls: MultiCallParams<bigint>[] = queryAmounts.map(a => ({
      target: this.machimaConfig.aggregatorQuoter,
      callData: this.aggregatorQuoterIface.encodeFunctionData('quote', [
        srcAddr,
        dstAddr,
        a.toString(),
      ]),
      decodeFunction: decodeQuoteAmountOut,
    }));

    const results = await this.dexHelper.multiWrapper.tryAggregate<bigint>(
      false,
      calls,
      blockNumber,
    );

    const outs = results.map(r => (r.success ? r.returnData : 0n));
    const unit = outs[0];
    const prices = [0n, ...outs.slice(1)];

    // When the XMA sell-price floor (xmaSellSqrtPriceLimit) is binding, the
    // on-chain quote reverts (SPL) for every amount and the real swap would
    // revert too. Surface a clean no-route rather than a zero-liquidity pool so
    // the router never builds a reverting XMA-sell transaction.
    if (unit === 0n && prices.every(p => p === 0n)) return null;
    const gasCost = prices.map(p =>
      p === 0n ? 0 : MACHIMA_BASE_GAS + MACHIMA_CROSS_TICK_GAS,
    );

    return [
      {
        unit,
        prices,
        data: {
          path: [
            {
              tokenIn: srcAddr,
              tokenOut: dstAddr,
              fee: MACHIMA_POOL_FEE.toString(),
            },
          ],
        },
        poolIdentifiers: [identifier],
        exchange: this.dexKey,
        gasCost,
        poolAddresses: [pool.poolAddress],
      },
    ];
  }

  private withMachimaGas(gasCost: number | number[]): number | number[] {
    // The aggregator router + swap adapter add overhead on top of the bare
    // pool swap that the UniswapV3 base class already estimates.
    const overhead = MACHIMA_WRAPPER_GAS_OVERHEAD;
    if (Array.isArray(gasCost)) {
      return gasCost.map(g => (g === 0 ? 0 : g + overhead));
    }
    return gasCost === 0 ? 0 : gasCost + overhead;
  }

  // ---- Execution (ParaSwap V6) ----

  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    _data: MachimaData,
    side: SwapSide,
    _executorAddress?: Address,
    options?: GetDexParamOptions,
  ): DexExchangeParam {
    const wrappedNative = this.dexHelper.config.data.wrappedNativeTokenAddress;
    const tokenIn = isETHAddress(srcToken) ? wrappedNative : srcToken;
    const tokenOut = isETHAddress(destToken) ? wrappedNative : destToken;

    const deadline = getLocalDeadlineAsFriendlyPlaceholder(
      options?.nowTimestampMs,
    );

    const exchangeData = this.aggregatorRouterIface.encodeFunctionData('swap', [
      tokenIn,
      tokenOut,
      srcAmount,
      destAmount, // amountOutMinimum
      recipient,
      deadline,
    ]);

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: true,
      exchangeData,
      targetExchange: this.machimaConfig.aggregatorRouter,
      returnAmountPos:
        side === SwapSide.SELL
          ? extractReturnAmountPosition(
              this.aggregatorRouterIface,
              'swap',
              'amountOut',
            )
          : undefined,
    };
  }

  getCalldataGasCost(_poolPrices: PoolPrices<MachimaData>): number | number[] {
    // swap(address,address,uint256,uint256,address,uint256): 6 static words.
    return (
      CALLDATA_GAS_COST.DEX_OVERHEAD +
      CALLDATA_GAS_COST.LENGTH_SMALL +
      CALLDATA_GAS_COST.FULL_WORD * 6
    );
  }
}

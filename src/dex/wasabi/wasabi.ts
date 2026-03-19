import { AsyncOrSync } from 'ts-essentials';
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
import { SwapSide, Network, NULL_ADDRESS } from '../../constants';
import { getDexKeysWithNetwork, isETHAddress } from '../../utils';
import { IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import {
  WasabiData,
  DexParams,
  PoolInfo,
  PoolState,
  Sample,
  PoolSamples,
} from './types';
import { SimpleExchange } from '../simple-exchange';
import {
  WasabiConfig,
  SAMPLE_SIZE,
  DEFAULT_GAS_COST,
  SAMPLE_REFRESH_INTERVAL_MS,
  POOL_LIST_REFRESH_INTERVAL_MS,
  BASIS_POINTS,
} from './config';
import { MultiCallParams } from '../../lib/multi-wrapper';
import { uint256ToBigInt, addressDecode } from '../../lib/decoders';
import { extractReturnAmountPosition } from '../../executor/utils';
import { BI_POWS } from '../../bigint-constants';

import WasabiFactoryABI from '../../abi/wasabi/WasabiFactory.json';
import WasabiPoolABI from '../../abi/wasabi/WasabiPool.json';
import WasabiRouterABI from '../../abi/wasabi/WasabiRouter.json';

export class Wasabi extends SimpleExchange implements IDex<WasabiData> {
  readonly hasConstantPriceLargeAmounts = false;
  readonly needWrapNative = true;
  readonly isFeeOnTransferSupported = false;
  readonly isStatePollingDex = true;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(WasabiConfig);

  logger: Logger;

  private readonly factoryIface = new Interface(WasabiFactoryABI);
  private readonly poolIface = new Interface(WasabiPoolABI);
  private readonly routerIface = new Interface(WasabiRouterABI);

  private readonly config: DexParams;
  private pools: PoolInfo[] = [];
  private poolStates: Map<string, PoolState> = new Map();
  private sampleRefreshInterval?: ReturnType<typeof setInterval>;
  private poolListRefreshInterval?: ReturnType<typeof setInterval>;

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey);
    this.config = WasabiConfig[dexKey][network];
  }

  async initializePricing(blockNumber: number) {
    await this.discoverPools();
    await this.refreshAllSamples(blockNumber);

    this.sampleRefreshInterval = setInterval(async () => {
      try {
        const block = await this.dexHelper.web3Provider.eth.getBlockNumber();
        await this.refreshAllSamples(block);
      } catch (e) {
        this.logger.error(`${this.dexKey}: sample refresh failed`, e);
      }
    }, SAMPLE_REFRESH_INTERVAL_MS);

    this.poolListRefreshInterval = setInterval(async () => {
      try {
        await this.discoverPools();
      } catch (e) {
        this.logger.error(`${this.dexKey}: pool list refresh failed`, e);
      }
    }, POOL_LIST_REFRESH_INTERVAL_MS);
  }

  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return null;
  }

  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    if (side === SwapSide.BUY) return [];

    const src = this.normalizeTokenAddress(srcToken.address);
    const dest = this.normalizeTokenAddress(destToken.address);

    return this.pools
      .filter(p => {
        const base = p.baseToken.toLowerCase();
        const quote = p.quoteToken.toLowerCase();
        return (
          (src === base && dest === quote) || (src === quote && dest === base)
        );
      })
      .map(p => `${this.dexKey}_${p.address}`);
  }

  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<WasabiData>> {
    if (side === SwapSide.BUY) return null;

    const src = this.normalizeTokenAddress(srcToken.address);
    const dest = this.normalizeTokenAddress(destToken.address);

    const matchingPools = this.pools.filter(p => {
      const base = p.baseToken.toLowerCase();
      const quote = p.quoteToken.toLowerCase();
      const matches =
        (src === base && dest === quote) || (src === quote && dest === base);
      if (!matches) return false;
      if (limitPools) {
        return limitPools.includes(`${this.dexKey}_${p.address}`);
      }
      return true;
    });

    if (matchingPools.length === 0) return null;

    const results: ExchangePrices<WasabiData> = [];

    for (const pool of matchingPools) {
      const state = this.poolStates.get(pool.address);
      if (!state) continue;

      const isBaseToQuote = src === pool.baseToken.toLowerCase();
      const samples = isBaseToQuote ? state.samples[0] : state.samples[1];

      if (samples.length === 0) continue;

      const prices = amounts.map(amount => {
        if (amount === 0n) return 0n;
        return this.interpolate(samples, amount);
      });

      results.push({
        prices,
        unit: this.interpolate(
          samples,
          BI_POWS[isBaseToQuote ? pool.baseDecimals : pool.quoteDecimals],
        ),
        gasCost: DEFAULT_GAS_COST,
        exchange: this.dexKey,
        data: {
          pool: pool.address,
          tokenIn: src,
          tokenOut: dest,
        },
        poolAddresses: [pool.address],
      });
    }

    return results.length > 0 ? results : null;
  }

  getCalldataGasCost(poolPrices: PoolPrices<WasabiData>): number | number[] {
    return (
      // pool address + tokenIn + amountIn + minAmountOut + recipient + deadline
      6 * 32 * 16
    );
  }

  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: WasabiData,
    side: SwapSide,
  ): AdapterExchangeParam {
    return {
      targetExchange: this.config.routerAddress,
      payload: '0x',
      networkFee: '0',
    };
  }

  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: WasabiData,
    side: SwapSide,
  ): DexExchangeParam {
    const swapData = this.routerIface.encodeFunctionData('swapExactInput', [
      data.tokenIn,
      data.tokenOut,
      srcAmount,
      destAmount,
      recipient,
      this.getDeadline(),
    ]);

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: true,
      exchangeData: swapData,
      targetExchange: this.config.routerAddress,
      returnAmountPos: extractReturnAmountPosition(
        this.routerIface,
        'swapExactInput',
      ),
    };
  }

  async updatePoolState(): Promise<void> {
    await this.discoverPools();
    if (this.pools.length > 0) {
      const block = await this.dexHelper.provider.getBlock('latest');
      await this.refreshAllSamples(block.number);
    }
  }

  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    const token = this.normalizeTokenAddress(tokenAddress);

    const matching = this.pools.filter(
      p =>
        p.baseToken.toLowerCase() === token ||
        p.quoteToken.toLowerCase() === token,
    );

    const results: PoolLiquidity[] = [];

    for (const pool of matching.slice(0, limit)) {
      const state = this.poolStates.get(pool.address);
      if (!state) continue;

      const isBase = pool.baseToken.toLowerCase() === token;
      const otherToken = isBase ? pool.quoteToken : pool.baseToken;
      const otherDecimals = isBase ? pool.quoteDecimals : pool.baseDecimals;

      const reserveIndex = isBase ? 0 : 1;
      const reserve = state.reserves[reserveIndex];
      if (reserve === 0n) continue;

      const otherReserve = state.reserves[isBase ? 1 : 0];
      let liquidityUSD = 0;
      try {
        liquidityUSD = await this.dexHelper.getTokenUSDPrice(
          { address: otherToken, decimals: otherDecimals },
          otherReserve,
        );
      } catch (e) {
        this.logger.warn(
          `${this.dexKey}: failed to get USD price for ${otherToken}`,
        );
      }

      results.push({
        exchange: this.dexKey,
        address: pool.address,
        connectorTokens: [{ decimals: otherDecimals, address: otherToken }],
        liquidityUSD,
      });
    }

    return results;
  }

  releaseResources(): AsyncOrSync<void> {
    if (this.sampleRefreshInterval) {
      clearInterval(this.sampleRefreshInterval);
      this.sampleRefreshInterval = undefined;
    }
    if (this.poolListRefreshInterval) {
      clearInterval(this.poolListRefreshInterval);
      this.poolListRefreshInterval = undefined;
    }
  }

  // --- Internal helpers ---

  private normalizeTokenAddress(address: string): string {
    if (isETHAddress(address)) {
      return this.dexHelper.config.data.wrappedNativeTokenAddress.toLowerCase();
    }
    return address.toLowerCase();
  }

  private getDeadline(): string {
    return String(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60);
  }

  private interpolate(samples: Sample[], amountIn: bigint): bigint {
    if (samples.length === 0 || amountIn === 0n) return 0n;

    // Binary search for the smallest sample where sampleAmountIn >= amountIn
    let lo = 0;
    let hi = samples.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (samples[mid][0] < amountIn) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    // Below first sample: scale from origin to first sample.
    if (lo === 0) {
      const [firstIn, firstOut] = samples[0];
      return firstIn === 0n ? 0n : (amountIn * firstOut) / firstIn;
    }

    // Above last sample: clamp to last known output to avoid overestimation.
    if (lo >= samples.length) {
      return samples[samples.length - 1][1];
    }

    const [upperIn, upperOut] = samples[lo];
    if (upperIn === amountIn) return upperOut;

    const [lowerIn, lowerOut] = samples[lo - 1];
    const deltaIn = upperIn - lowerIn;
    if (deltaIn === 0n) return lowerOut;

    // Linear interpolation between surrounding samples.
    return lowerOut + ((upperOut - lowerOut) * (amountIn - lowerIn)) / deltaIn;
  }

  private async discoverPools(): Promise<void> {
    // Step 1: Get listed tokens from factory
    const listedTokensCalls: MultiCallParams<string[]> = {
      target: this.config.factoryAddress,
      callData: this.factoryIface.encodeFunctionData('getListedTokens'),
      decodeFunction: result => {
        const [isSuccess, toDecode] =
          typeof result === 'object' && 'success' in result
            ? [result.success, result.returnData]
            : [true, result];
        if (!isSuccess || toDecode === '0x') return [];
        const decoded = this.factoryIface.decodeFunctionResult(
          'getListedTokens',
          toDecode as string,
        );
        return (decoded[0] as string[]).map((a: string) => a.toLowerCase());
      },
    };

    const [listedResult] = await this.dexHelper.multiWrapper.tryAggregate<
      string[]
    >(true, [listedTokensCalls]);

    if (!listedResult.success || listedResult.returnData.length === 0) {
      return;
    }

    const listedTokens = listedResult.returnData;

    // Step 2: Get pool address for each token
    const poolAddrCalls: MultiCallParams<string>[] = listedTokens.map(
      token => ({
        target: this.config.factoryAddress,
        callData: this.factoryIface.encodeFunctionData('getPropPool', [token]),
        decodeFunction: addressDecode,
      }),
    );

    const poolAddrResults =
      await this.dexHelper.multiWrapper.tryAggregate<string>(
        false,
        poolAddrCalls,
      );

    // Step 3: For valid pools, get base/quote tokens
    const validEntries: { token: string; poolAddr: string }[] = [];
    for (let i = 0; i < listedTokens.length; i++) {
      if (
        poolAddrResults[i].success &&
        poolAddrResults[i].returnData !== NULL_ADDRESS
      ) {
        validEntries.push({
          token: listedTokens[i],
          poolAddr: poolAddrResults[i].returnData,
        });
      }
    }

    if (validEntries.length === 0) return;

    // Get quote token from first valid pool
    const quoteTokenCall: MultiCallParams<string> = {
      target: validEntries[0].poolAddr,
      callData: this.poolIface.encodeFunctionData('getQuoteToken'),
      decodeFunction: addressDecode,
    };

    const [quoteResult] =
      await this.dexHelper.multiWrapper.tryAggregate<string>(true, [
        quoteTokenCall,
      ]);

    if (!quoteResult.success) return;

    const quoteToken = quoteResult.returnData;

    // Step 4: Get decimals for all tokens
    const allTokenAddrs = [
      ...new Set([...validEntries.map(e => e.token), quoteToken]),
    ];

    const decimalsCalls: MultiCallParams<bigint>[] = allTokenAddrs.map(
      token => ({
        target: token,
        callData: this.erc20Interface.encodeFunctionData('decimals'),
        decodeFunction: uint256ToBigInt,
      }),
    );

    const decimalsResults =
      await this.dexHelper.multiWrapper.tryAggregate<bigint>(
        false,
        decimalsCalls,
      );

    const decimalsMap = new Map<string, number>();
    for (let i = 0; i < allTokenAddrs.length; i++) {
      if (decimalsResults[i].success) {
        decimalsMap.set(
          allTokenAddrs[i],
          Number(decimalsResults[i].returnData),
        );
      }
    }

    this.pools = validEntries
      .filter(e => decimalsMap.has(e.token) && decimalsMap.has(quoteToken))
      .map(e => ({
        address: e.poolAddr.toLowerCase(),
        baseToken: e.token,
        quoteToken,
        baseDecimals: decimalsMap.get(e.token)!,
        quoteDecimals: decimalsMap.get(quoteToken)!,
      }));
  }

  private async refreshAllSamples(blockNumber: number): Promise<void> {
    if (this.pools.length === 0) return;

    const calls: MultiCallParams<bigint>[] = [];
    const callMeta: {
      poolIndex: number;
      dirIndex: number;
      sampleIndex: number;
      amountIn: bigint;
    }[] = [];

    for (let pi = 0; pi < this.pools.length; pi++) {
      const pool = this.pools[pi];

      for (let dir = 0; dir < 2; dir++) {
        const tokenIn = dir === 0 ? pool.baseToken : pool.quoteToken;
        const decimals = dir === 0 ? pool.baseDecimals : pool.quoteDecimals;

        const start = Math.max(0, decimals - Math.floor(SAMPLE_SIZE / 2));

        for (let k = 0; k < SAMPLE_SIZE; k++) {
          const exp = start + k;
          const amountIn = BI_POWS[exp] ?? 10n ** BigInt(exp);

          calls.push({
            target: pool.address,
            callData: this.poolIface.encodeFunctionData('quoteExactInput', [
              tokenIn,
              amountIn,
            ]),
            decodeFunction: uint256ToBigInt,
          });

          callMeta.push({
            poolIndex: pi,
            dirIndex: dir,
            sampleIndex: k,
            amountIn,
          });
        }
      }
    }

    // Fetch reserves for all pools with one call per pool.
    const reserveCalls: MultiCallParams<[bigint, bigint]>[] = this.pools.map(
      pool => ({
        target: pool.address,
        callData: this.poolIface.encodeFunctionData('getReserves'),
        decodeFunction: result => {
          const toDecode =
            typeof result === 'object' && 'returnData' in result
              ? result.returnData
              : result;
          if (toDecode === '0x') return [0n, 0n];

          const decoded = this.poolIface.decodeFunctionResult(
            'getReserves',
            toDecode as string,
          );
          return [
            decoded.baseTokenReserves.toBigInt(),
            decoded.quoteTokenReserves.toBigInt(),
          ];
        },
      }),
    );

    const [sampleResults, reserveResults] = await Promise.all([
      this.dexHelper.multiWrapper.tryAggregate<bigint>(
        false,
        calls,
        blockNumber,
      ),
      this.dexHelper.multiWrapper.tryAggregate<[bigint, bigint]>(
        false,
        reserveCalls,
        blockNumber,
      ),
    ]);

    // Build per-pool sample arrays
    const poolSamplesMap = new Map<
      number,
      { samples: [Sample[], Sample[]]; reserves: [bigint, bigint] }
    >();

    for (let i = 0; i < callMeta.length; i++) {
      const meta = callMeta[i];
      if (!poolSamplesMap.has(meta.poolIndex)) {
        poolSamplesMap.set(meta.poolIndex, {
          samples: [[], []],
          reserves: [0n, 0n],
        });
      }
      const entry = poolSamplesMap.get(meta.poolIndex)!;

      if (sampleResults[i].success && sampleResults[i].returnData > 0n) {
        let amountOut = sampleResults[i].returnData;

        // Apply buffer
        if (this.config.buffer > 0) {
          amountOut = (amountOut * BigInt(this.config.buffer)) / BASIS_POINTS;
        }

        entry.samples[meta.dirIndex].push([meta.amountIn, amountOut]);
      }
    }

    // Set reserves
    for (let pi = 0; pi < this.pools.length; pi++) {
      if (!poolSamplesMap.has(pi)) {
        poolSamplesMap.set(pi, {
          samples: [[], []],
          reserves: [0n, 0n],
        });
      }
      const entry = poolSamplesMap.get(pi)!;
      if (reserveResults[pi]?.success) {
        entry.reserves = reserveResults[pi].returnData;
      }
    }

    // Update state
    for (const [poolIndex, data] of poolSamplesMap.entries()) {
      const pool = this.pools[poolIndex];
      this.poolStates.set(pool.address, {
        samples: data.samples,
        reserves: data.reserves,
      });
    }
  }
}

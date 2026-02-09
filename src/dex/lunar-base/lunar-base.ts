import { Interface, AbiCoder } from '@ethersproject/abi';
import _ from 'lodash';
import { AsyncOrSync, DeepReadonly } from 'ts-essentials';
import {
  Token,
  Address,
  ExchangePrices,
  PoolPrices,
  AdapterExchangeParam,
  PoolLiquidity,
  Logger,
  DexExchangeParam,
} from '../../types';
import { SwapSide, Network, NULL_ADDRESS } from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getDexKeysWithNetwork, getBigIntPow, isETHAddress } from '../../utils';
import { IDex } from '../idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { SimpleExchange } from '../simple-exchange';
import { NumberAsString } from '@paraswap/core';
import {
  LunarBaseData,
  LunarBasePair,
  LunarBasePoolOrderedParams,
  LunarBaseDexParams,
  BaseFeeConfig,
  LunarBaseApiResponse,
  LunarBaseApiPoolInfo,
  LunarFeeQuote,
  calculateEffectiveFee,
  apiBpsToFeeCode,
  apiWeightToInternal,
  LUNAR_BASE_FEE_DENOMINATOR,
  LUNAR_BASE_DEFAULT_FEE_CONFIG,
  LUNAR_BASE_DEFAULT_MODULE_MASK,
  LUNAR_BASE_ZERO_ADDRESS,
} from './types';
import { LunarBaseConfig, LunarBaseAdapters } from './config';
import { LunarBaseEventPool } from './lunar-base-pool';
import LunarPoolABI from '../../abi/lunar-base/lunar-pool.json';
import LunarFactoryABI from '../../abi/lunar-base/lunar-factory.json';
import LunarCoreModuleABI from '../../abi/lunar-base/lunar-core-module.json';
import LunarRouterABI from '../../abi/lunar-base/lunar-router.json';
import erc20ABI from '../../abi/erc20.json';
import { Contract } from 'web3-eth-contract';

const DefaultLunarBasePoolGasCost = 100 * 1000;

const coder = new AbiCoder();
const poolIface = new Interface(LunarPoolABI);
const routerIface = new Interface(LunarRouterABI);
const erc20Iface = new Interface(erc20ABI);
const coreModuleIface = new Interface(LunarCoreModuleABI);

export class LunarBase
  extends SimpleExchange
  implements IDex<LunarBaseData, any>
{
  pairs: { [key: string]: LunarBasePair } = {};
  feeFactor = LUNAR_BASE_FEE_DENOMINATOR;
  factory: Contract;
  coreModule: Contract;

  private poolsCache: LunarBaseApiResponse | null = null;
  private poolsCacheTimestamp: number = 0;
  private readonly POOLS_CACHE_TTL = 60 * 1000;

  readonly hasConstantPriceLargeAmounts = false;
  readonly isFeeOnTransferSupported = false;
  readonly needWrapNative = false;

  logger: Logger;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(LunarBaseConfig);

  constructor(
    protected network: Network,
    dexKey: string,
    protected dexHelper: IDexHelper,
    protected factoryAddress: Address = LunarBaseConfig[dexKey][network]
      .factoryAddress,
    protected routerAddress: Address = LunarBaseConfig[dexKey][network]
      .routerAddress,
    protected quoterAddress: Address = LunarBaseConfig[dexKey][network]
      .quoterAddress || NULL_ADDRESS,
    protected coreModuleAddress: Address = LunarBaseConfig[dexKey][network]
      .coreModuleAddress || NULL_ADDRESS,
    protected apiURL: string = LunarBaseConfig[dexKey][network].apiURL || '',
    protected poolGasCost: number = LunarBaseConfig[dexKey][network]
      .poolGasCost || DefaultLunarBasePoolGasCost,
    protected adapters = LunarBaseAdapters[network] || {},
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(`${dexKey}-${network}`);

    this.factory = new dexHelper.web3Provider.eth.Contract(
      LunarFactoryABI as any,
      factoryAddress,
    );

    this.coreModule = new dexHelper.web3Provider.eth.Contract(
      LunarCoreModuleABI as any,
      coreModuleAddress,
    );
  }

  async initializePricing(blockNumber: number) {
    this.logger.info(
      `${this.dexKey}: Initializing pricing at block ${blockNumber}`,
    );
    await this.fetchPoolsFromApi();
  }

  private async fetchPoolsFromApi(): Promise<LunarBaseApiResponse | null> {
    const now = Date.now();
    if (
      this.poolsCache &&
      now - this.poolsCacheTimestamp < this.POOLS_CACHE_TTL
    ) {
      return this.poolsCache;
    }

    if (!this.apiURL) {
      return null;
    }

    try {
      const response =
        await this.dexHelper.httpRequest.get<LunarBaseApiResponse>(
          this.apiURL,
          10000, // timeout
        );

      if (response && response.pools) {
        this.poolsCache = response;
        this.poolsCacheTimestamp = now;
        this.logger.info(
          `${this.dexKey}: Fetched ${response.pools.length} token pairs from API`,
        );
        return response;
      }
    } catch (e) {
      this.logger.warn(`${this.dexKey}: Error fetching pools from API:`, e);
    }
    return this.poolsCache;
  }

  private apiPoolToFeeConfig(pool: LunarBaseApiPoolInfo): BaseFeeConfig {
    return {
      baseFee: apiBpsToFeeCode(pool.feeConfig.baseFeeBps),
      wToken0: apiWeightToInternal(pool.feeConfig.wToken0In),
      wToken1: apiWeightToInternal(pool.feeConfig.wToken1In),
    };
  }

  private normalizeAddress(address: string): string {
    if (
      address.toLowerCase() === LUNAR_BASE_ZERO_ADDRESS.toLowerCase() ||
      address.toLowerCase() === '0x0000000000000000000000000000000000000000'
    ) {
      return this.dexHelper.config.data.wrappedNativeTokenAddress.toLowerCase();
    }
    return address.toLowerCase();
  }

  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return this.adapters[side] || null;
  }

  protected getPoolIdentifier(
    token0: string,
    token1: string,
    baseFee?: number,
  ): string {
    const [_token0, _token1] =
      token0.toLowerCase() < token1.toLowerCase()
        ? [token0, token1]
        : [token1, token0];

    const feeStr = baseFee
      ? `_${baseFee}`
      : `_${LUNAR_BASE_DEFAULT_FEE_CONFIG.baseFee}`;
    return `${this.dexKey}_${_token0}_${_token1}${feeStr}`.toLowerCase();
  }

  async getPoolIdentifiers(
    _from: Token,
    _to: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    const from = this.dexHelper.config.wrapETH(_from);
    const to = this.dexHelper.config.wrapETH(_to);

    if (from.address.toLowerCase() === to.address.toLowerCase()) {
      return [];
    }

    const apiData = await this.fetchPoolsFromApi();
    if (apiData) {
      const fromAddr = this.normalizeAddress(from.address);
      const toAddr = this.normalizeAddress(to.address);

      const identifiers: string[] = [];

      for (const tokenPair of apiData.pools) {
        const t0 = this.normalizeAddress(tokenPair.token0.address);
        const t1 = this.normalizeAddress(tokenPair.token1.address);

        if (
          (t0 === fromAddr && t1 === toAddr) ||
          (t0 === toAddr && t1 === fromAddr)
        ) {
          for (const pool of tokenPair.pools) {
            const feeConfig = this.apiPoolToFeeConfig(pool);
            identifiers.push(
              this.getPoolIdentifier(
                from.address,
                to.address,
                feeConfig.baseFee,
              ),
            );
          }
        }
      }

      if (identifiers.length > 0) {
        return identifiers;
      }
    }

    return [this.getPoolIdentifier(from.address, to.address)];
  }

  async findPair(
    from: Token,
    to: Token,
    baseFee?: number,
  ): Promise<LunarBasePair | null> {
    if (from.address.toLowerCase() === to.address.toLowerCase()) return null;

    const [token0, token1] =
      from.address.toLowerCase() < to.address.toLowerCase()
        ? [from, to]
        : [to, from];

    const key = this.getPoolIdentifier(token0.address, token1.address, baseFee);
    let pair = this.pairs[key];
    if (pair) return pair;

    const apiData = await this.fetchPoolsFromApi();
    if (apiData) {
      const t0 = this.normalizeAddress(token0.address);
      const t1 = this.normalizeAddress(token1.address);

      for (const tokenPair of apiData.pools) {
        const apiT0 = this.normalizeAddress(tokenPair.token0.address);
        const apiT1 = this.normalizeAddress(tokenPair.token1.address);

        if ((apiT0 === t0 && apiT1 === t1) || (apiT0 === t1 && apiT1 === t0)) {
          for (const pool of tokenPair.pools) {
            const feeConfig = this.apiPoolToFeeConfig(pool);

            if (baseFee !== undefined && feeConfig.baseFee !== baseFee) {
              continue;
            }

            pair = {
              token0: {
                address: this.normalizeAddress(tokenPair.token0.address),
                decimals: tokenPair.token0.decimals || 18,
              },
              token1: {
                address: this.normalizeAddress(tokenPair.token1.address),
                decimals: tokenPair.token1.decimals || 18,
              },
              exchange: pool.backend.pair_address.toLowerCase(),
              baseFeeConfig: feeConfig,
              userModule: LUNAR_BASE_ZERO_ADDRESS,
              moduleMask: LUNAR_BASE_DEFAULT_MODULE_MASK,
              hasNativeToken0:
                tokenPair.token0.address.toLowerCase() ===
                LUNAR_BASE_ZERO_ADDRESS,
              hasNativeToken1:
                tokenPair.token1.address.toLowerCase() ===
                LUNAR_BASE_ZERO_ADDRESS,
            };
            this.pairs[key] = pair;
            return pair;
          }
        }
      }
    }

    const feeConfig = baseFee
      ? { ...LUNAR_BASE_DEFAULT_FEE_CONFIG, baseFee }
      : LUNAR_BASE_DEFAULT_FEE_CONFIG;

    try {
      const exchange = await this.factory.methods
        .getPair(
          token0.address,
          token1.address,
          LUNAR_BASE_ZERO_ADDRESS, // userModule
          LUNAR_BASE_DEFAULT_MODULE_MASK, // moduleMask
          [feeConfig.baseFee, feeConfig.wToken0, feeConfig.wToken1],
        )
        .call();

      if (exchange && exchange !== NULL_ADDRESS) {
        pair = {
          token0: { address: token0.address, decimals: token0.decimals },
          token1: { address: token1.address, decimals: token1.decimals },
          exchange,
          baseFeeConfig: feeConfig,
          userModule: LUNAR_BASE_ZERO_ADDRESS,
          moduleMask: LUNAR_BASE_DEFAULT_MODULE_MASK,
        };
        this.pairs[key] = pair;
        return pair;
      }
    } catch (e) {
      this.logger.debug(
        `${this.dexKey}: Pool not found for ${token0.address}-${token1.address}`,
      );
    }

    return null;
  }

  async addPool(
    pair: LunarBasePair,
    reserves0: string,
    reserves1: string,
    blockNumber: number,
  ) {
    const baseFeeConfig = pair.baseFeeConfig || LUNAR_BASE_DEFAULT_FEE_CONFIG;

    pair.pool = new LunarBaseEventPool(
      this.dexKey,
      this.dexHelper,
      pair.exchange!,
      { address: pair.token0.address },
      { address: pair.token1.address },
      baseFeeConfig,
      this.logger,
    );

    pair.pool.addressesSubscribed.push(pair.exchange!);

    const feeCode = calculateEffectiveFee(baseFeeConfig, true);

    await pair.pool.initialize(blockNumber, {
      state: {
        reserves0,
        reserves1,
        feeCode,
        baseFeeConfig,
      },
    });
  }

  async getManyPoolReserves(
    pairs: LunarBasePair[],
    blockNumber: number,
  ): Promise<{ reserves0: string; reserves1: string }[]> {
    const apiData = this.poolsCache;
    if (apiData) {
      const results: { reserves0: string; reserves1: string }[] = [];
      for (const pair of pairs) {
        let found = false;
        const pairExchangeLower = pair.exchange?.toLowerCase();

        for (const tokenPair of apiData.pools) {
          for (const pool of tokenPair.pools) {
            const apiPairLower = pool.backend.pair_address.toLowerCase();
            if (apiPairLower === pairExchangeLower) {
              results.push({
                reserves0: pool.backend.reserve0,
                reserves1: pool.backend.reserve1,
              });
              found = true;
              break;
            }
          }
          if (found) break;
        }
        if (!found) {
          results.push({ reserves0: '0', reserves1: '0' });
        }
      }
      if (results.every(r => r.reserves0 !== '0' || r.reserves1 !== '0')) {
        return results;
      }
    }

    try {
      const weth = this.dexHelper.config.data.wrappedNativeTokenAddress;
      const calldata = pairs
        .map(pair => {
          const token0Addr =
            pair.token0.address === LUNAR_BASE_ZERO_ADDRESS
              ? weth
              : pair.token0.address;
          const token1Addr =
            pair.token1.address === LUNAR_BASE_ZERO_ADDRESS
              ? weth
              : pair.token1.address;

          return [
            {
              target: token0Addr,
              callData: erc20Iface.encodeFunctionData('balanceOf', [
                pair.exchange!,
              ]),
            },
            {
              target: token1Addr,
              callData: erc20Iface.encodeFunctionData('balanceOf', [
                pair.exchange!,
              ]),
            },
          ];
        })
        .flat();

      const data: { returnData: any[] } =
        await this.dexHelper.multiContract.methods
          .aggregate(calldata)
          .call({}, blockNumber);

      const returnData = _.chunk(data.returnData, 2);
      return pairs.map((_, i) => ({
        reserves0: coder.decode(['uint256'], returnData[i][0])[0].toString(),
        reserves1: coder.decode(['uint256'], returnData[i][1])[0].toString(),
      }));
    } catch (e) {
      this.logger.error(`${this.dexKey}: Error getting pool reserves:`, e);
      return [];
    }
  }

  async getDynamicFee(
    poolAddress: Address,
    tokenIn: Address,
    tokenOut: Address,
    reserveIn: bigint,
    reserveOut: bigint,
    blockNumber: number,
  ): Promise<LunarFeeQuote | null> {
    if (this.coreModuleAddress === NULL_ADDRESS) {
      return null;
    }

    try {
      const swapContext = {
        tokenIn,
        tokenOut,
        amountIn: '0',
        amountOut: '0',
        reserveIn: reserveIn.toString(),
        reserveOut: reserveOut.toString(),
        data: '0x',
      };

      const result = await this.coreModule.methods
        .previewFee(poolAddress, swapContext)
        .call({}, blockNumber);

      return {
        inBps: Number(result.inBps),
        outBps: Number(result.outBps),
        protocolShareBps: Number(result.protocolShareBps),
      };
    } catch (e) {
      this.logger.debug(
        `${this.dexKey}: Error getting dynamic fee for ${poolAddress}:`,
        e,
      );
      return null;
    }
  }

  async getBatchDynamicFees(
    pools: Array<{
      poolAddress: Address;
      tokenIn: Address;
      tokenOut: Address;
      reserveIn: bigint;
      reserveOut: bigint;
    }>,
    blockNumber: number,
  ): Promise<Map<Address, LunarFeeQuote>> {
    const results = new Map<Address, LunarFeeQuote>();

    if (this.coreModuleAddress === NULL_ADDRESS || pools.length === 0) {
      return results;
    }

    try {
      const calldata = pools.map(pool => ({
        target: this.coreModuleAddress,
        callData: coreModuleIface.encodeFunctionData('previewFee', [
          pool.poolAddress,
          {
            tokenIn: pool.tokenIn,
            tokenOut: pool.tokenOut,
            amountIn: '0',
            amountOut: '0',
            reserveIn: pool.reserveIn.toString(),
            reserveOut: pool.reserveOut.toString(),
            data: '0x',
          },
        ]),
      }));

      const data: { returnData: any[] } =
        await this.dexHelper.multiContract.methods
          .aggregate(calldata)
          .call({}, blockNumber);

      for (let i = 0; i < pools.length; i++) {
        try {
          const decoded = coreModuleIface.decodeFunctionResult(
            'previewFee',
            data.returnData[i],
          );
          results.set(pools[i].poolAddress.toLowerCase(), {
            inBps: Number(decoded.q.inBps),
            outBps: Number(decoded.q.outBps),
            protocolShareBps: Number(decoded.q.protocolShareBps),
          });
        } catch (e) {
          this.logger.debug(
            `${this.dexKey}: Error decoding fee for ${pools[i].poolAddress}`,
          );
        }
      }
    } catch (e) {
      this.logger.debug(`${this.dexKey}: Error in batch dynamic fee fetch:`, e);
    }

    return results;
  }

  async batchCatchUpPairs(
    pairs: [Token, Token][],
    blockNumber: number,
    baseFee?: number,
  ) {
    if (!blockNumber) return;

    const pairsToFetch: LunarBasePair[] = [];
    for (const [from, to] of pairs) {
      const pair = await this.findPair(from, to, baseFee);
      if (!(pair && pair.exchange)) continue;
      if (!pair.pool) {
        pairsToFetch.push(pair);
      } else if (!pair.pool.getState(blockNumber)) {
        pairsToFetch.push(pair);
      }
    }

    if (!pairsToFetch.length) return;

    const reserves = await this.getManyPoolReserves(pairsToFetch, blockNumber);

    for (let i = 0; i < pairsToFetch.length; i++) {
      const pairState = reserves[i];
      const pair = pairsToFetch[i];
      if (!pair.pool) {
        await this.addPool(
          pair,
          pairState.reserves0,
          pairState.reserves1,
          blockNumber,
        );
      } else {
        const baseFeeConfig =
          pair.baseFeeConfig || LUNAR_BASE_DEFAULT_FEE_CONFIG;
        pair.pool.setState(
          {
            reserves0: pairState.reserves0,
            reserves1: pairState.reserves1,
            feeCode: calculateEffectiveFee(baseFeeConfig, true),
            baseFeeConfig,
          },
          blockNumber,
        );
      }
    }
  }

  getSellAmountOutForSwap(
    params: LunarBasePoolOrderedParams,
    srcAmount: bigint,
    feeQuote?: LunarFeeQuote,
  ): bigint {
    const { reservesIn, reservesOut, baseFeeConfig, direction } = params;
    const reserveIn = BigInt(reservesIn);
    const reserveOut = BigInt(reservesOut);

    if (reserveIn <= 0n || reserveOut <= 0n) return 0n;

    const FEE_DEN = BigInt(LUNAR_BASE_FEE_DENOMINATOR);

    let inBps: bigint;
    if (feeQuote) {
      inBps = BigInt(feeQuote.inBps);
    } else {
      const baseFee = BigInt(baseFeeConfig.baseFee);
      const wToken0 = BigInt(baseFeeConfig.wToken0);
      const wToken1 = BigInt(baseFeeConfig.wToken1);
      const weightSum = wToken0 + wToken1;
      const wTokenIn = direction ? wToken0 : wToken1;
      inBps = weightSum > 0n ? (baseFee * wTokenIn) / weightSum : 0n;
    }

    const feeIn = (srcAmount * inBps) / FEE_DEN;
    const effectiveInput = srcAmount - feeIn;

    const numerator = effectiveInput * reserveOut;
    const denominator = reserveIn + effectiveInput;

    if (denominator === 0n) return 0n;

    return numerator / denominator;
  }

  getSellPrice(
    params: LunarBasePoolOrderedParams,
    srcAmount: bigint,
    feeQuote?: LunarFeeQuote,
  ): bigint {
    const { reservesIn, reservesOut, fee } = params;
    const reserveIn = BigInt(reservesIn);
    const reserveOut = BigInt(reservesOut);

    if (reserveIn <= 0n || reserveOut <= 0n) return 0n;

    const FEE_DEN = BigInt(LUNAR_BASE_FEE_DENOMINATOR);

    if (feeQuote) {
      const inBps = BigInt(feeQuote.inBps);
      const outBps = BigInt(feeQuote.outBps);

      const feeIn = (srcAmount * inBps) / FEE_DEN;
      const effectiveInput = srcAmount - feeIn;

      const numerator = effectiveInput * reserveOut;
      const denominator = reserveIn + effectiveInput;
      const amountOut = numerator / denominator;

      const feeOut = (amountOut * outBps) / FEE_DEN;
      return amountOut - feeOut;
    }

    const feeCode = BigInt(fee);
    const feeFactor = FEE_DEN - feeCode;
    const amountInWithFee = srcAmount * feeFactor;
    const numerator = amountInWithFee * reserveOut;
    const denominator = reserveIn * FEE_DEN + amountInWithFee;

    return numerator / denominator;
  }

  getBuyPrice(
    params: LunarBasePoolOrderedParams,
    destAmount: bigint,
    feeQuote?: LunarFeeQuote,
  ): bigint {
    if (destAmount === 0n) return 0n;

    const { reservesIn, reservesOut, fee } = params;
    const reserveIn = BigInt(reservesIn);
    const reserveOut = BigInt(reservesOut);

    if (reserveIn <= 0n || reserveOut <= 0n || destAmount >= reserveOut)
      return 0n;

    const FEE_DEN = BigInt(LUNAR_BASE_FEE_DENOMINATOR);

    if (feeQuote) {
      const inBps = BigInt(feeQuote.inBps);
      const outBps = BigInt(feeQuote.outBps);

      const amountOutBeforeFee =
        (destAmount * FEE_DEN + FEE_DEN - 1n) / (FEE_DEN - outBps);

      const effectiveInputNeeded =
        (reserveIn * amountOutBeforeFee +
          reserveOut -
          amountOutBeforeFee -
          1n) /
        (reserveOut - amountOutBeforeFee);

      const amountIn =
        (effectiveInputNeeded * FEE_DEN + FEE_DEN - 1n) / (FEE_DEN - inBps);

      return amountIn;
    }

    const feeCode = BigInt(fee);
    const feeFactor = FEE_DEN - feeCode;
    const numerator = reserveIn * destAmount * FEE_DEN;
    const denominator = (reserveOut - destAmount) * feeFactor;

    return numerator / denominator + 1n;
  }

  async getPairOrderedParams(
    from: Token,
    to: Token,
    blockNumber: number,
    baseFee?: number,
  ): Promise<LunarBasePoolOrderedParams | null> {
    const pair = await this.findPair(from, to, baseFee);
    if (!(pair && pair.pool && pair.exchange)) return null;

    const pairState = pair.pool.getState(blockNumber);
    if (!pairState) {
      this.logger.error(
        `${this.dexKey}: No state for pool ${from.address}-${to.address}`,
      );
      return null;
    }

    const baseFeeConfig =
      pairState.baseFeeConfig || LUNAR_BASE_DEFAULT_FEE_CONFIG;

    const pairToken1Normalized = this.normalizeAddress(pair.token1.address);
    const fromNormalized = this.normalizeAddress(from.address);
    const pairReversed = pairToken1Normalized === fromNormalized;

    const fee = calculateEffectiveFee(baseFeeConfig, !pairReversed);

    if (pairReversed) {
      return {
        tokenIn: from.address,
        tokenOut: to.address,
        reservesIn: pairState.reserves1,
        reservesOut: pairState.reserves0,
        fee: fee.toString(),
        direction: false,
        exchange: pair.exchange,
        baseFeeConfig,
        userModule: pair.userModule || LUNAR_BASE_ZERO_ADDRESS,
        moduleMask: pair.moduleMask || LUNAR_BASE_DEFAULT_MODULE_MASK,
      };
    }

    return {
      tokenIn: from.address,
      tokenOut: to.address,
      reservesIn: pairState.reserves0,
      reservesOut: pairState.reserves1,
      fee: fee.toString(),
      direction: true,
      exchange: pair.exchange,
      baseFeeConfig,
      userModule: pair.userModule || LUNAR_BASE_ZERO_ADDRESS,
      moduleMask: pair.moduleMask || LUNAR_BASE_DEFAULT_MODULE_MASK,
    };
  }

  async getPricesVolume(
    _from: Token,
    _to: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<ExchangePrices<LunarBaseData> | null> {
    try {
      const from = this.dexHelper.config.wrapETH(_from);
      const to = this.dexHelper.config.wrapETH(_to);

      if (from.address.toLowerCase() === to.address.toLowerCase()) {
        return null;
      }

      const wethAddr =
        this.dexHelper.config.data.wrappedNativeTokenAddress.toLowerCase();
      const destIsWETH =
        !isETHAddress(_to.address) && to.address.toLowerCase() === wethAddr;

      const allPoolIdentifiers = await this.getPoolIdentifiers(
        from,
        to,
        side,
        blockNumber,
      );

      const poolIdentifiers = limitPools
        ? allPoolIdentifiers.filter(id => limitPools.includes(id))
        : allPoolIdentifiers;

      if (poolIdentifiers.length === 0) {
        return null;
      }

      const isSell = side === SwapSide.SELL;
      const unitAmount = getBigIntPow(isSell ? from.decimals : to.decimals);

      const pairParams: Array<{
        poolIdentifier: string;
        pair: LunarBasePair;
        pairParam: LunarBasePoolOrderedParams;
      }> = [];

      for (const poolIdentifier of poolIdentifiers) {
        const parts = poolIdentifier.split('_');
        const baseFee = parts.length >= 4 ? parseInt(parts[3]) : undefined;

        const pair = await this.findPair(from, to, baseFee);
        if (!pair || !pair.exchange) continue;

        await this.batchCatchUpPairs([[from, to]], blockNumber, baseFee);

        const pairParam = await this.getPairOrderedParams(
          from,
          to,
          blockNumber,
          baseFee,
        );
        if (!pairParam) continue;

        pairParams.push({ poolIdentifier, pair, pairParam });
      }

      if (pairParams.length === 0) {
        return null;
      }

      let feeQuotes = new Map<Address, LunarFeeQuote>();
      if (this.coreModuleAddress !== NULL_ADDRESS) {
        const poolsForFees = pairParams.map(({ pairParam }) => ({
          poolAddress: pairParam.exchange,
          tokenIn: pairParam.tokenIn,
          tokenOut: pairParam.tokenOut,
          reserveIn: BigInt(pairParam.reservesIn),
          reserveOut: BigInt(pairParam.reservesOut),
        }));
        feeQuotes = await this.getBatchDynamicFees(poolsForFees, blockNumber);
      }

      const results: ExchangePrices<LunarBaseData> = [];

      for (const { poolIdentifier, pair, pairParam } of pairParams) {
        const isNativeInput = pairParam.direction
          ? pair.hasNativeToken0
          : pair.hasNativeToken1;
        const isNativeOutput = pairParam.direction
          ? pair.hasNativeToken1
          : pair.hasNativeToken0;

        if (isNativeOutput && destIsWETH) {
          continue;
        }

        const feeQuote = feeQuotes.get(pairParam.exchange.toLowerCase());

        const unit = isSell
          ? this.getSellPrice(pairParam, unitAmount, feeQuote)
          : this.getBuyPrice(pairParam, unitAmount, feeQuote);

        const prices = isSell
          ? amounts.map(amount =>
              this.getSellPrice(pairParam, amount, feeQuote),
            )
          : amounts.map(amount =>
              this.getBuyPrice(pairParam, amount, feeQuote),
            );

        results.push({
          prices,
          unit,
          data: {
            router: this.routerAddress,
            pools: [
              {
                address: pairParam.exchange,
                fee: parseInt(pairParam.fee),
                direction: pairParam.direction,
                baseFeeConfig: pairParam.baseFeeConfig,
                userModule: pairParam.userModule,
                moduleMask: pairParam.moduleMask,
                reservesIn: pairParam.reservesIn,
                reservesOut: pairParam.reservesOut,
                dynamicFeeQuote: feeQuote,
                isNativeInput: !!isNativeInput,
                isNativeOutput: !!isNativeOutput,
              },
            ],
            weth: this.dexHelper.config.data.wrappedNativeTokenAddress,
          },
          exchange: this.dexKey,
          poolIdentifiers: [poolIdentifier],
          gasCost: this.poolGasCost,
          poolAddresses: [pairParam.exchange],
        });
      }

      return results.length > 0 ? results : null;
    } catch (e) {
      this.logger.error(`${this.dexKey}: Error in getPricesVolume:`, e);
      return null;
    }
  }

  getCalldataGasCost(poolPrices: PoolPrices<LunarBaseData>): number | number[] {
    return (
      CALLDATA_GAS_COST.DEX_OVERHEAD +
      CALLDATA_GAS_COST.LENGTH_SMALL +
      CALLDATA_GAS_COST.OFFSET_SMALL +
      CALLDATA_GAS_COST.ADDRESS +
      CALLDATA_GAS_COST.OFFSET_SMALL +
      CALLDATA_GAS_COST.LENGTH_SMALL +
      CALLDATA_GAS_COST.wordNonZeroBytes(32)
    );
  }

  getAdapterParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    data: LunarBaseData,
    side: SwapSide,
  ): AdapterExchangeParam {
    const payload = this.abiCoder.encodeParameter(
      {
        ParentStruct: {
          weth: 'address',
          pools: 'uint256[]',
        },
      },
      {
        weth: data.weth || this.dexHelper.config.data.wrappedNativeTokenAddress,
        pools: data.pools.map(pool => {
          return (
            (BigInt(LUNAR_BASE_FEE_DENOMINATOR - pool.fee) << 161n) +
            ((pool.direction ? 0n : 1n) << 160n) +
            BigInt(pool.address)
          ).toString();
        }),
      },
    );

    return {
      targetExchange: data.router,
      payload,
      networkFee: '0',
    };
  }

  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: LunarBaseData,
    side: SwapSide,
  ): DexExchangeParam {
    const pool = data.pools[0];
    if (!pool) {
      throw new Error(`${this.dexKey}: No pool data available`);
    }

    const wethAddr =
      this.dexHelper.config.data.wrappedNativeTokenAddress.toLowerCase();
    const srcIsNative =
      isETHAddress(srcToken) || srcToken.toLowerCase() === wethAddr;

    if (pool.isNativeInput || pool.isNativeOutput) {
      return this.getDexParamViaRouter(
        srcToken,
        destToken,
        srcAmount,
        recipient,
        pool,
        srcIsNative,
      );
    }

    return this.getDexParamDirect(
      srcToken,
      destToken,
      srcAmount,
      destAmount,
      recipient,
      pool,
      side,
    );
  }

  private getDexParamViaRouter(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    recipient: Address,
    pool: LunarBaseData['pools'][0],
    srcIsNative: boolean,
  ): DexExchangeParam {
    const tokenInForRouter = pool.isNativeInput
      ? LUNAR_BASE_ZERO_ADDRESS
      : srcToken;
    const tokenOutForRouter = pool.isNativeOutput
      ? LUNAR_BASE_ZERO_ADDRESS
      : destToken;

    const swapData = routerIface.encodeFunctionData('swapExactInputSingle', [
      {
        tokenIn: tokenInForRouter,
        tokenOut: tokenOutForRouter,
        amountIn: srcAmount,
        amountOutMinimum: '0',
        to: recipient,
        userModule: pool.userModule,
        moduleMask: pool.moduleMask,
        baseFeeConfig: {
          baseFee: pool.baseFeeConfig.baseFee,
          wToken0: pool.baseFeeConfig.wToken0,
          wToken1: pool.baseFeeConfig.wToken1,
        },
        data: '0x',
      },
    ]);

    return {
      needWrapNative: this.needWrapNative,
      sendEthButSupportsInsertFromAmount: true,
      dexFuncHasRecipient: true,
      exchangeData: swapData,
      targetExchange: this.routerAddress,
      spender: srcIsNative ? undefined : this.routerAddress,
      returnAmountPos: undefined,
    };
  }

  private getDexParamDirect(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    pool: LunarBaseData['pools'][0],
    side: SwapSide,
  ): DexExchangeParam {
    let outputAmount: bigint;
    if (side === SwapSide.SELL) {
      const pairParam: LunarBasePoolOrderedParams = {
        tokenIn: srcToken,
        tokenOut: destToken,
        reservesIn: pool.reservesIn,
        reservesOut: pool.reservesOut,
        fee: pool.fee.toString(),
        direction: pool.direction,
        exchange: pool.address,
        baseFeeConfig: pool.baseFeeConfig,
        userModule: pool.userModule,
        moduleMask: pool.moduleMask,
      };
      outputAmount = this.getSellAmountOutForSwap(
        pairParam,
        BigInt(srcAmount),
        pool.dynamicFeeQuote,
      );
    } else {
      outputAmount = BigInt(destAmount);
    }

    const swapData = poolIface.encodeFunctionData('swap', [
      pool.direction ? 0 : outputAmount.toString(),
      pool.direction ? outputAmount.toString() : 0,
      recipient,
      '0x',
    ]);

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: true,
      exchangeData: swapData,
      targetExchange: pool.address,
      transferSrcTokenBeforeSwap: pool.address,
      returnAmountPos: undefined,
    };
  }

  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    const apiData = await this.fetchPoolsFromApi();
    if (!apiData) {
      return [];
    }

    const normalizedToken = this.normalizeAddress(tokenAddress);
    const pools: PoolLiquidity[] = [];

    for (const tokenPair of apiData.pools) {
      const t0 = this.normalizeAddress(tokenPair.token0.address);
      const t1 = this.normalizeAddress(tokenPair.token1.address);

      if (t0 !== normalizedToken && t1 !== normalizedToken) {
        continue;
      }

      const connectorToken = t0 === normalizedToken ? t1 : t0;
      const connectorDecimals =
        t0 === normalizedToken
          ? tokenPair.token1.decimals || 18
          : tokenPair.token0.decimals || 18;

      for (const pool of tokenPair.pools) {
        const tvl = parseFloat(pool.backend.tvl || '0');

        pools.push({
          exchange: this.dexKey,
          address: pool.backend.pair_address.toLowerCase(),
          connectorTokens: [
            {
              address: connectorToken,
              decimals: connectorDecimals,
            },
          ],
          liquidityUSD: tvl,
        });
      }
    }

    return pools
      .sort((a, b) => b.liquidityUSD - a.liquidityUSD)
      .slice(0, limit);
  }
}

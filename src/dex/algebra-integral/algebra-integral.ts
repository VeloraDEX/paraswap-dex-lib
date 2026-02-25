import { pack } from '@ethersproject/solidity';
import { DeepReadonly } from 'ts-essentials';
import {
  Token,
  Address,
  ExchangePrices,
  PoolPrices,
  AdapterExchangeParam,
  PoolLiquidity,
  TransferFeeParams,
  Logger,
  DexExchangeParam,
  NumberAsString,
} from '../../types';
import {
  SwapSide,
  Network,
  DEST_TOKEN_DEX_TRANSFERS,
  SRC_TOKEN_DEX_TRANSFERS,
  SUBGRAPH_TIMEOUT,
} from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { Interface } from 'ethers/lib/utils';
import SwapRouter from '../../abi/algebra-integral/SwapRouter.abi.json';
import AlgebraQuoterABI from '../../abi/algebra-integral/Quoter.abi.json';
import {
  _require,
  getBigIntPow,
  getDexKeysWithNetwork,
  interpolate,
  isDestTokenTransferFeeToBeExchanged,
  isSrcTokenTransferFeeToBeExchanged,
} from '../../utils';
import { IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import {
  AlgebraIntegralData,
  AlgebraIntegralPoolState,
  Pool,
  SubgraphPoolData,
  AlgebraIntegralFunctions,
} from './types';
import {
  SimpleExchange,
  getLocalDeadlineAsFriendlyPlaceholder,
} from '../simple-exchange';
import { applyTransferFee } from '../../lib/token-transfer-fee';
import { AlgebraIntegralConfig } from './config';
import { extractReturnAmountPosition } from '../../executor/utils';
import { AlgebraIntegralFactory } from './algebra-integral-factory';
import { AlgebraIntegralEventPool } from './algebra-integral-pool';
import {
  ALGEBRA_GAS_COST,
  ALGEBRA_EFFICIENCY_FACTOR,
  POOL_TVL_UPDATE_INTERVAL,
  MIN_USD_TVL_FOR_PRICING,
  FEE_UPDATE_INTERVAL_MS,
  ALGEBRA_QUOTE_GASLIMIT,
} from './constants';
import { uint256ToBigInt } from '../../lib/decoders';
import { AlgebraMath } from '../algebra/lib/AlgebraMath';
import { PoolStateV1_1 } from '../algebra/types';
import { OutputResult } from '../uniswap-v3/types';
import AlgebraIntegralStateMulticallABI from '../../abi/algebra-integral/AlgebraIntegralStateMulticall.abi.json';
import { buildFeeCallData } from './utils';

export class AlgebraIntegral
  extends SimpleExchange
  implements IDex<AlgebraIntegralData>
{
  readonly hasConstantPriceLargeAmounts = false;
  readonly needWrapNative = true;
  readonly isFeeOnTransferSupported = true;

  private readonly factory: AlgebraIntegralFactory;
  private updatePoolsTvlTimer?: NodeJS.Timeout;
  private feeUpdateIntervalTask?: NodeJS.Timeout;
  protected eventPools: Record<string, AlgebraIntegralEventPool | null> = {};
  private topPoolsCache: SubgraphPoolData[] = [];
  protected stateMulticallIface: Interface = new Interface(
    AlgebraIntegralStateMulticallABI,
  );

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(AlgebraIntegralConfig);

  logger: Logger;

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
    readonly routerIface = new Interface(SwapRouter),
    readonly quoterIface = new Interface(AlgebraQuoterABI),
    readonly config = AlgebraIntegralConfig[dexKey][network],
    readonly EventPoolImplementation = AlgebraIntegralEventPool,
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey);

    this.factory = new AlgebraIntegralFactory(
      dexKey,
      this.network,
      dexHelper,
      this.logger,
      this.config.factory,
      this.config.subgraphURL,
    );
  }

  async initializePricing(blockNumber: number) {
    await this.factory.initialize(blockNumber);
    await this.initializeEventPools(blockNumber);

    if (this.dexHelper.config.isSlave) {
      if (!this.updatePoolsTvlTimer) {
        try {
          await this.factory.updatePoolsTvl();
        } catch (error) {
          this.logger.error(
            `${this.dexKey}: Failed to update pool TVL on initialize:`,
            error,
          );
        }

        this.updatePoolsTvlTimer = setInterval(async () => {
          try {
            await this.factory.updatePoolsTvl();
          } catch (error) {
            this.logger.error(
              `${this.dexKey}: Failed to update pool TVL:`,
              error,
            );
          }
        }, POOL_TVL_UPDATE_INTERVAL * 1000);
      }

      if (!this.feeUpdateIntervalTask) {
        void this.updateAllPoolFees();
        this.feeUpdateIntervalTask = setInterval(
          this.updateAllPoolFees.bind(this),
          FEE_UPDATE_INTERVAL_MS,
        );
      }
    }
  }

  async initializeEventPools(
    blockNumber: number,
    subscribe = true,
    pools?: Pool[],
  ): Promise<void> {
    const allPools = pools ?? this.factory.getAllPools();

    await Promise.all(
      allPools.map(async pool => {
        const [token0, token1] = this._sortTokens(pool.token0, pool.token1);
        const key = this.getPoolIdentifier(token0, token1, pool.deployer);

        if (this.eventPools[key] !== undefined) return;

        const eventPool = new this.EventPoolImplementation(
          this.dexHelper,
          this.dexKey,
          this.stateMulticallIface,
          this.config.stateMulticall,
          this.erc20Interface,
          token0,
          token1,
          this.logger,
          this.cacheStateKey,
          pool.poolAddress,
        );

        try {
          if (subscribe) {
            await eventPool.initialize(blockNumber);
          } else {
            const state = await eventPool.generateState(blockNumber);
            eventPool.setState(state, blockNumber);
          }
          this.eventPools[key] = eventPool;
        } catch (e) {
          this.logger.warn(
            `${this.dexKey}: Failed to initialize event pool ${pool.poolAddress}`,
            e,
          );
          this.eventPools[key] = null;
        }
      }),
    );
  }

  protected async updateAllPoolFees(): Promise<void> {
    try {
      const activePools = Object.values(this.eventPools).filter(
        (p): p is AlgebraIntegralEventPool => p !== null,
      );
      if (!activePools.length) return;

      const [results, blockNumber] = await Promise.all([
        this.dexHelper.multiWrapper.tryAggregate<bigint>(
          false,
          buildFeeCallData(activePools),
        ),
        this.dexHelper.blockManager.getLatestBlockNumber(),
      ]);

      activePools.forEach((pool, i) => {
        const result = results[i];
        if (!result.success) {
          this.logger.warn(
            `${this.dexKey}: Failed to fetch fee for pool ${pool.poolAddress}`,
          );
          return;
        }

        const state = pool.getStaleState();
        if (!state) return;

        const newFee = result.returnData;
        if (state.globalState.fee === newFee) return;

        pool.setState(
          {
            ...state,
            globalState: { ...state.globalState, fee: newFee },
          },
          blockNumber,
        );
      });
    } catch (error) {
      this.logger.error(`${this.dexKey}: Error updating pool fees:`, error);
    }
  }

  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return null;
  }

  getPoolIdentifier(
    srcAddress: Address,
    destAddress: Address,
    deployerAddress: Address,
  ) {
    const tokenAddresses = this._sortTokens(srcAddress, destAddress).join('_');
    return `${this.dexKey}_${tokenAddresses}_${deployerAddress}`;
  }

  // Returns list of pool identifiers that can be used
  // for a given swap. poolIdentifiers must be unique
  // across DEXes. It is recommended to use
  // ${dexKey}_${poolAddress} as a poolIdentifier
  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    const _srcToken = this.dexHelper.config.wrapETH(srcToken);
    const _destToken = this.dexHelper.config.wrapETH(destToken);

    const [_srcAddress, _destAddress] = [
      _srcToken.address.toLowerCase(),
      _destToken.address.toLowerCase(),
    ];

    if (_srcAddress === _destAddress) return [];

    const pools = this.factory.getAvailablePoolsForPair(
      _srcAddress,
      _destAddress,
    );

    if (pools.length === 0) return [];

    return pools.map(pool =>
      this.getPoolIdentifier(_srcAddress, _destAddress, pool.deployer),
    );
  }

  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
    transferFees: TransferFeeParams = {
      srcFee: 0,
      destFee: 0,
      srcDexFee: 0,
      destDexFee: 0,
    },
  ): Promise<null | ExchangePrices<AlgebraIntegralData>> {
    try {
      if (
        isSrcTokenTransferFeeToBeExchanged(transferFees) &&
        side === SwapSide.BUY
      ) {
        return null;
      }

      const _srcToken = this.dexHelper.config.wrapETH(srcToken);
      const _destToken = this.dexHelper.config.wrapETH(destToken);

      const [_srcAddress, _destAddress] = [
        _srcToken.address.toLowerCase(),
        _destToken.address.toLowerCase(),
      ];

      if (_srcAddress === _destAddress) return null;

      let pools = this.factory.getAvailablePoolsForPair(
        _srcAddress,
        _destAddress,
      );

      if (limitPools && limitPools.length > 0) {
        const limitPoolsSet = new Set(limitPools);
        pools = pools.filter(pool =>
          limitPoolsSet.has(
            this.getPoolIdentifier(_srcAddress, _destAddress, pool.deployer),
          ),
        );
      }

      if (pools.length === 0) return null;

      const [token0] = this._sortTokens(_srcAddress, _destAddress);
      const zeroForOne = token0 === _srcAddress;

      const pricingResults = await Promise.all(
        pools.map(pool =>
          this.getPoolPricing(
            pool,
            _srcToken,
            _destToken,
            amounts,
            side,
            zeroForOne,
            transferFees,
            blockNumber,
          ),
        ),
      );

      const _isFeeOnTransfer = isSrcTokenTransferFeeToBeExchanged(transferFees);
      const unit = getBigIntPow(
        side === SwapSide.SELL ? _destToken.decimals : _srcToken.decimals,
      );

      const results: ExchangePrices<AlgebraIntegralData> = [];

      for (const result of pricingResults) {
        if (!result) continue;

        results.push({
          unit,
          prices: result.prices,
          data: {
            feeOnTransfer: _isFeeOnTransfer,
            path: [
              {
                tokenIn: _srcAddress,
                tokenOut: _destAddress,
                deployer: result.pool.deployer,
              },
            ],
          },
          poolIdentifiers: [
            this.getPoolIdentifier(
              result.pool.token0,
              result.pool.token1,
              result.pool.deployer,
            ),
          ],
          exchange: this.dexKey,
          gasCost: result.gasCost,
          poolAddresses: [result.pool.poolAddress],
        });
      }

      return results.length > 0 ? results : null;
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

  private _getOutputs(
    state: DeepReadonly<AlgebraIntegralPoolState>,
    amounts: bigint[],
    zeroForOne: boolean,
    side: SwapSide,
    destTokenBalance: bigint,
  ): OutputResult | null {
    try {
      const outputsResult = AlgebraMath.queryOutputs(
        this.network,
        state as unknown as DeepReadonly<PoolStateV1_1>,
        amounts,
        zeroForOne,
        side,
      );

      if (side === SwapSide.SELL) {
        if (outputsResult.outputs[0] > destTokenBalance) {
          return null;
        }

        for (let i = 0; i < outputsResult.outputs.length; i++) {
          if (outputsResult.outputs[i] > destTokenBalance) {
            outputsResult.outputs[i] = 0n;
            outputsResult.tickCounts[i] = 0;
          }
        }
      } else {
        if (amounts[0] > destTokenBalance) {
          return null;
        }

        for (let i = 0; i < amounts.length; i++) {
          if (amounts[i] > destTokenBalance) {
            outputsResult.outputs[i] = 0n;
            outputsResult.tickCounts[i] = 0;
          }
        }
      }

      return outputsResult;
    } catch (e) {
      this.logger.debug(
        `${this.dexKey}: received error in _getOutputs while calculating outputs`,
        e,
      );
      return null;
    }
  }

  private async getPoolPricing(
    pool: Pool,
    from: Token,
    to: Token,
    amounts: bigint[],
    side: SwapSide,
    zeroForOne: boolean,
    transferFees: TransferFeeParams,
    blockNumber: number,
  ): Promise<{
    prices: bigint[];
    gasCost: number | number[];
    pool: Pool;
  } | null> {
    const srcAddress = from.address.toLowerCase();
    const destAddress = to.address.toLowerCase();
    const key = this.getPoolIdentifier(srcAddress, destAddress, pool.deployer);
    const eventPool = this.eventPools[key];
    const state = eventPool?.getState(blockNumber) ?? null;

    if (state && state.isValid && state.liquidity > 0n) {
      const destTokenBalance =
        destAddress === eventPool!.token0 ? state.balance0 : state.balance1;

      const _isSrcFee = isSrcTokenTransferFeeToBeExchanged(transferFees);
      const _isDestFee = isDestTokenTransferFeeToBeExchanged(transferFees);

      const amountsExcludingZero = amounts.slice(1);
      const amountsWithFee = _isSrcFee
        ? applyTransferFee(
            amountsExcludingZero,
            side,
            transferFees.srcDexFee,
            SRC_TOKEN_DEX_TRANSFERS,
          )
        : amountsExcludingZero;

      const result = this._getOutputs(
        state,
        amountsWithFee,
        zeroForOne,
        side,
        destTokenBalance,
      );

      if (!result) return null;

      const outputsWithFee = _isDestFee
        ? applyTransferFee(
            result.outputs,
            side,
            transferFees.destDexFee,
            DEST_TOKEN_DEX_TRANSFERS,
          )
        : result.outputs;

      return {
        prices: [0n, ...outputsWithFee],
        gasCost: [
          0,
          ...outputsWithFee.map(p => (p === 0n ? 0 : ALGEBRA_GAS_COST)),
        ],
        pool,
      };
    }

    return this.getPricingFromRpc(from, to, amounts, side, pool, transferFees);
  }

  protected async getPricingFromRpc(
    from: Token,
    to: Token,
    amounts: bigint[],
    side: SwapSide,
    pool: Pool,
    transferFees: TransferFeeParams,
  ): Promise<{
    prices: bigint[];
    gasCost: number | number[];
    pool: Pool;
  } | null> {
    this.logger.warn(`fallback to rpc for pool ${pool.poolAddress}`);

    const isSELL = side === SwapSide.SELL;

    const _isSrcFee = isSrcTokenTransferFeeToBeExchanged(transferFees);
    const _isDestFee = isDestTokenTransferFeeToBeExchanged(transferFees);

    const chunks = amounts.length - 1;
    const _width = Math.floor(chunks / this.config.chunksCount);
    const chunkedAmounts = Array.from(
      Array(this.config.chunksCount).keys(),
    ).map(i => amounts[(i + 1) * _width]);

    const amountsForQuote = _isSrcFee
      ? applyTransferFee(
          chunkedAmounts,
          side,
          transferFees.srcDexFee,
          SRC_TOKEN_DEX_TRANSFERS,
        )
      : chunkedAmounts;

    const calldata = amountsForQuote.map(amount =>
      this.buildQuoteCallData(
        from.address,
        to.address,
        pool.deployer,
        amount,
        isSELL,
      ),
    );

    const results = await this.dexHelper.multiWrapper.tryAggregate(
      false,
      calldata,
    );

    const _rates = chunkedAmounts.map((_, i) => {
      const res = results[i];
      return res.success ? res.returnData : 0n;
    });

    const _ratesWithFee = _isDestFee
      ? applyTransferFee(
          _rates,
          side,
          transferFees.destDexFee,
          DEST_TOKEN_DEX_TRANSFERS,
        )
      : _rates;

    const prices = interpolate(chunkedAmounts, _ratesWithFee, amounts, side);

    return { prices, gasCost: ALGEBRA_GAS_COST, pool };
  }

  buildQuoteCallData(
    from: string,
    to: string,
    deployer: string,
    amount: bigint,
    isSELL: boolean,
  ) {
    return {
      target: this.config.quoter,
      gasLimit: ALGEBRA_QUOTE_GASLIMIT,
      callData: this.quoterIface.encodeFunctionData(
        isSELL ? 'quoteExactInputSingle' : 'quoteExactOutputSingle',
        [from, to, deployer, amount.toString(), 0],
      ),
      decodeFunction: uint256ToBigInt,
    };
  }

  // Returns estimated gas cost of calldata for this DEX in multiSwap
  getCalldataGasCost(
    poolPrices: PoolPrices<AlgebraIntegralData>,
  ): number | number[] {
    return (
      CALLDATA_GAS_COST.FUNCTION_SELECTOR +
      // path offset
      CALLDATA_GAS_COST.OFFSET_SMALL +
      // receipient
      CALLDATA_GAS_COST.ADDRESS +
      // deadline
      CALLDATA_GAS_COST.TIMESTAMP +
      // amountIn
      CALLDATA_GAS_COST.AMOUNT +
      // amountOut
      CALLDATA_GAS_COST.AMOUNT +
      // path bytes (tokenIn, tokenOut, and deployer)
      60 * CALLDATA_GAS_COST.NONZERO_BYTE +
      // path padding
      4 * CALLDATA_GAS_COST.ZERO_BYTE
    );
  }

  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: AlgebraIntegralData,
    side: SwapSide,
  ): DexExchangeParam {
    let swapFunction;
    let swapFunctionParams;

    if (data.feeOnTransfer) {
      _require(
        data.path.length === 1,
        `LOGIC ERROR: multihop is not supported for feeOnTransfer token, passed: ${data.path
          .map(p => `${p?.tokenIn}->${p?.tokenOut}`)
          .join(' ')}`,
      );
      swapFunction = AlgebraIntegralFunctions.exactInputWithFeeToken;
      swapFunctionParams = {
        limitSqrtPrice: '0',
        recipient: recipient,
        deadline: getLocalDeadlineAsFriendlyPlaceholder(),
        amountIn: srcAmount,
        amountOutMinimum: destAmount,
        tokenIn: data.path[0].tokenIn,
        tokenOut: data.path[0].tokenOut,
        deployer: data.path[0].deployer,
      };
    } else {
      swapFunction =
        side === SwapSide.SELL
          ? AlgebraIntegralFunctions.exactInput
          : AlgebraIntegralFunctions.exactOutput;
      const path = this._encodePath(data.path, side);
      swapFunctionParams =
        side === SwapSide.SELL
          ? {
              recipient: recipient,
              deadline: getLocalDeadlineAsFriendlyPlaceholder(),
              amountIn: srcAmount,
              amountOutMinimum: destAmount,
              path,
            }
          : {
              recipient: recipient,
              deadline: getLocalDeadlineAsFriendlyPlaceholder(),
              amountOut: destAmount,
              amountInMaximum: srcAmount,
              path,
            };
    }

    const exchangeData = this.routerIface.encodeFunctionData(swapFunction, [
      swapFunctionParams,
    ]);

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: true,
      exchangeData,
      targetExchange: this.config.router,
      returnAmountPos:
        side === SwapSide.SELL
          ? extractReturnAmountPosition(
              this.routerIface,
              swapFunction,
              'amountOut',
            )
          : undefined,
    };
  }

  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: AlgebraIntegralData,
    side: SwapSide,
  ): AdapterExchangeParam {
    // Encode here the payload for adapter
    const payload = '';

    return {
      targetExchange: this.config.router,
      payload,
      networkFee: '0',
    };
  }

  async updatePoolState(): Promise<void> {
    const blockNumber = await this.dexHelper.provider.getBlockNumber();
    this.topPoolsCache = await this.querySubgraphPools();

    const pools: Pool[] = this.topPoolsCache.map(p => ({
      poolAddress: p.poolAddress,
      token0: p.token0.address,
      token1: p.token1.address,
      deployer: p.deployer,
      tvlUSD: 0,
    }));

    await this.initializeEventPools(blockNumber, false, pools);
  }

  private async querySubgraphPools(): Promise<SubgraphPoolData[]> {
    const query = `query ($first: Int!) {
      pools(
        orderBy: totalValueLockedUSD
        orderDirection: desc
        first: $first
      ) {
        id
        deployer
        token0 {
          id
          decimals
        }
        token1 {
          id
          decimals
        }
      }
    }`;

    const res = await this.dexHelper.httpRequest.querySubgraph<{
      data: {
        pools: Array<{
          id: string;
          deployer: string;
          token0: { id: string; decimals: string };
          token1: { id: string; decimals: string };
        }>;
      };
    }>(
      this.config.subgraphURL,
      { query, variables: { first: 1000 } },
      { timeout: SUBGRAPH_TIMEOUT },
    );

    return res.data.pools.map(pool => ({
      poolAddress: pool.id.toLowerCase(),
      token0: {
        address: pool.token0.id.toLowerCase(),
        decimals: parseInt(pool.token0.decimals, 10),
      },
      token1: {
        address: pool.token1.id.toLowerCase(),
        decimals: parseInt(pool.token1.decimals, 10),
      },
      deployer: pool.deployer.toLowerCase(),
    }));
  }

  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    const _tokenAddress = tokenAddress.toLowerCase();

    const relevantPools = this.topPoolsCache.filter(
      pool =>
        pool.token0.address === _tokenAddress ||
        pool.token1.address === _tokenAddress,
    );

    if (relevantPools.length === 0) return [];

    const tokenAmounts: [string, bigint][] = [];
    const poolsWithBalances: {
      pool: SubgraphPoolData;
      balance0: bigint;
      balance1: bigint;
    }[] = [];

    for (const pool of relevantPools) {
      const [token0, token1] = this._sortTokens(
        pool.token0.address,
        pool.token1.address,
      );

      const key = this.getPoolIdentifier(token0, token1, pool.deployer);
      const eventPool = this.eventPools[key];
      const state = eventPool?.getStaleState();

      if (!state) continue;

      poolsWithBalances.push({
        pool,
        balance0: state.balance0,
        balance1: state.balance1,
      });

      tokenAmounts.push([pool.token0.address, state.balance0]);
      tokenAmounts.push([pool.token1.address, state.balance1]);
    }

    if (poolsWithBalances.length === 0) return [];

    const usdValues = await this.dexHelper.getUsdTokenAmounts(tokenAmounts);

    const liquidityPools: PoolLiquidity[] = [];

    for (let i = 0; i < poolsWithBalances.length; i++) {
      const {
        pool: { poolAddress, token0, token1 },
      } = poolsWithBalances[i];

      const isToken0 = token0.address === _tokenAddress;

      const token0Usd = usdValues[i * 2] || 0;
      const token1Usd = usdValues[i * 2 + 1] || 0;

      const tokenUsd = isToken0 ? token0Usd : token1Usd;
      const connectorUsd = isToken0 ? token1Usd : token0Usd;
      const liquidityUSD =
        (tokenUsd + connectorUsd) * ALGEBRA_EFFICIENCY_FACTOR;

      if (liquidityUSD / ALGEBRA_EFFICIENCY_FACTOR < MIN_USD_TVL_FOR_PRICING) {
        continue;
      }

      liquidityPools.push({
        exchange: this.dexKey,
        address: poolAddress,
        connectorTokens: [
          {
            address: isToken0 ? token1.address : token0.address,
            decimals: isToken0 ? token1.decimals : token0.decimals,
            liquidityUSD: connectorUsd * ALGEBRA_EFFICIENCY_FACTOR,
          },
        ],
        liquidityUSD,
      });
    }

    return liquidityPools
      .sort((a, b) => b.liquidityUSD - a.liquidityUSD)
      .slice(0, limit);
  }

  private _encodePath(
    path: {
      tokenIn: Address;
      tokenOut: Address;
      deployer: Address;
    }[],
    side: SwapSide,
  ): string {
    if (path.length === 0) {
      return '0x';
    }

    const { _path, types } = path.reduce(
      (
        { _path, types }: { _path: string[]; types: string[] },
        curr,
        index,
      ): { _path: string[]; types: string[] } => {
        if (index === 0) {
          return {
            types: ['address', 'address', 'address'],
            _path: [curr.tokenIn, curr.deployer, curr.tokenOut],
          };
        } else {
          return {
            types: [...types, 'address', 'address'],
            _path: [..._path, curr.deployer, curr.tokenOut],
          };
        }
      },
      { _path: [], types: [] },
    );

    return side === SwapSide.BUY
      ? pack(types.reverse(), _path.reverse())
      : pack(types, _path);
  }

  private _sortTokens(srcAddress: Address, destAddress: Address) {
    return [srcAddress, destAddress].sort((a, b) => (a < b ? -1 : 1));
  }

  releaseResources(): void {
    if (this.updatePoolsTvlTimer) {
      clearInterval(this.updatePoolsTvlTimer);
      this.updatePoolsTvlTimer = undefined;
      this.logger.info(`${this.dexKey}: cleared updatePoolsTvlTimer`);
    }

    if (this.feeUpdateIntervalTask) {
      clearInterval(this.feeUpdateIntervalTask);
      this.feeUpdateIntervalTask = undefined;
      this.logger.info(`${this.dexKey}: cleared feeUpdateIntervalTask`);
    }
  }
}

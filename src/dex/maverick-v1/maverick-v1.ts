import { Interface } from '@ethersproject/abi';
import _ from 'lodash';
import {
  Token,
  Address,
  ExchangePrices,
  PoolPrices,
  AdapterExchangeParam,
  SimpleExchangeParam,
  PoolLiquidity,
  Logger,
  DexExchangeParam,
} from '../../types';
import { SwapSide, Network } from '../../constants';
import { getDexKeysWithNetwork, getBigIntPow, isTruthy } from '../../utils';
import { IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import {
  MaverickV1Data,
  MaverickV1Functions,
  MaverickV1Param,
  SubgraphPoolBase,
} from './types';
import {
  getLocalDeadlineAsFriendlyPlaceholder,
  SimpleExchange,
} from '../simple-exchange';
import {
  MaverickV1Config,
  Adapters,
  MAV_V1_BASE_GAS_COST,
  MAV_V1_TICK_GAS_COST,
  MAV_V1_KIND_GAS_COST,
} from './config';
import { MaverickV1EventPool } from './maverick-v1-pool';
import {
  fetchAllPools,
  fetchPoolsSortedByBalanceUsd,
} from './subgraph-queries';
import { SUBGRAPH_TIMEOUT } from '../../constants';
import RouterABI from '../../abi/maverick-v1/router.json';
import { NumberAsString } from '@paraswap/core';
import { extractReturnAmountPosition } from '../../executor/utils';
import { uint256ToBigInt } from '../../lib/decoders';
import { MultiCallParams } from '../../lib/multi-wrapper';

const MAX_POOL_CNT = 1000;

const EFFICIENCY_FACTOR = 3;
export class MaverickV1
  extends SimpleExchange
  implements IDex<MaverickV1Data, MaverickV1Param>
{
  pools: { [key: string]: MaverickV1EventPool } = {};

  readonly isFeeOnTransferSupported: boolean = false;
  readonly hasConstantPriceLargeAmounts = false;
  readonly needWrapNative = true;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(MaverickV1Config);

  logger: Logger;

  routerAddress: string;

  constructor(
    protected network: Network,
    dexKey: string,
    protected dexHelper: IDexHelper,
    protected adapters = Adapters[network] || {}, // TODO: add any additional optional params to support other fork DEXes
    readonly routerIface = new Interface(RouterABI),
    protected config = MaverickV1Config[dexKey][network],
    protected subgraphURL: string = MaverickV1Config[dexKey][network]
      .subgraphURL,
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey);
    this.routerAddress =
      MaverickV1Config[this.dexKey][this.network].routerAddress;
  }

  async setupEventPools(blockNumber: number) {
    const pools = await this.fetchAllSubgraphPools();

    await Promise.all(
      pools.map(async (pool: any) => {
        const eventPool = new MaverickV1EventPool(
          this.dexKey,
          this.network,
          this.dexHelper,
          {
            address: pool.tokenA.id,
            symbol: pool.tokenA.symbol,
            decimals: pool.tokenA.decimals,
          },
          {
            address: pool.tokenB.id,
            symbol: pool.tokenB.symbol,
            decimals: pool.tokenB.decimals,
          },
          pool.fee,
          pool.tickSpacing,
          pool.protocolFeeRatio,
          pool.lookback,
          pool.id,
          MaverickV1Config[this.dexKey][this.network].poolInspectorAddress,
          this.logger,
        );
        const onChainState = await eventPool.generateState(blockNumber);
        if (blockNumber) {
          eventPool.setState(onChainState, blockNumber);
          this.dexHelper.blockManager.subscribeToLogs(
            eventPool,
            eventPool.addressesSubscribed,
            blockNumber,
          );
        }
        this.pools[eventPool.address] = eventPool;
      }),
    );
  }

  // Initialize pricing is called once in the start of
  // pricing service. It is intended to setup the integration
  // for pricing requests. It is optional for a DEX to
  // implement this function
  async initializePricing(blockNumber: number) {
    await this.setupEventPools(blockNumber);
  }

  // Returns the list of contract adapters (name and index)
  // for a buy/sell. Return null if there are no adapters.
  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return this.adapters[side] ? this.adapters[side] : null;
  }

  async fetchAllSubgraphPools(): Promise<SubgraphPoolBase[]> {
    this.logger.info(
      `Fetching ${this.dexKey}_${this.network} Pools from subgraph`,
    );
    const { data } = await this.dexHelper.httpRequest.querySubgraph(
      this.subgraphURL,
      { query: fetchAllPools, variables: { count: MAX_POOL_CNT } },
      { timeout: SUBGRAPH_TIMEOUT },
    );
    return data.pools;
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
    const from = this.dexHelper.config.wrapETH(srcToken);
    const to = this.dexHelper.config.wrapETH(destToken);

    if (from.address.toLowerCase() === to.address.toLowerCase()) {
      return [];
    }

    const pools = await this.getPools(from, to);
    return pools.map(
      (pool: any) => `${this.dexKey}_${pool.address.toLowerCase()}`,
    );
  }

  async getPools(srcToken: Token, destToken: Token) {
    return Object.values(this.pools).filter((pool: MaverickV1EventPool) => {
      return (
        (pool.tokenA.address.toLowerCase() == srcToken.address.toLowerCase() ||
          pool.tokenA.address.toLowerCase() ==
            destToken.address.toLowerCase()) &&
        (pool.tokenB.address.toLowerCase() == srcToken.address.toLowerCase() ||
          pool.tokenB.address.toLowerCase() == destToken.address.toLowerCase())
      );
    });
  }

  // Returns estimated gas cost of calldata for this DEX in multiSwap
  getCalldataGasCost(
    poolPrices: PoolPrices<MaverickV1Data>,
  ): number | number[] {
    const gasCost = CALLDATA_GAS_COST.DEX_NO_PAYLOAD;

    const arr = new Array(poolPrices.prices.length);
    poolPrices.prices.forEach((p, index) => {
      if (p == 0n) {
        arr[index] = 0;
      } else {
        arr[index] = gasCost;
      }
    });
    return arr;
  }

  // Returns pool prices for amounts.
  // If limitPools is defined only pools in limitPools
  // should be used. If limitPools is undefined then
  // any pools can be used.
  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<MaverickV1Data>> {
    try {
      const from = this.dexHelper.config.wrapETH(srcToken);
      const to = this.dexHelper.config.wrapETH(destToken);

      if (from.address.toLowerCase() === to.address.toLowerCase()) {
        return null;
      }

      const allPools = await this.getPools(from, to);

      const allowedPools = limitPools
        ? allPools.filter(pool =>
            limitPools.includes(`${this.dexKey}_${pool.address.toLowerCase()}`),
          )
        : allPools;
      if (!allowedPools.length) return null;

      const unitAmount = getBigIntPow(
        side == SwapSide.BUY ? to.decimals : from.decimals,
      );

      return (
        await Promise.all(
          allowedPools.map(async (pool: MaverickV1EventPool) => {
            try {
              let state = pool.getState(blockNumber);
              if (state === null) {
                state = await pool.generateState(blockNumber);
                pool.setState(state, blockNumber);
              }
              if (state === null) {
                this.logger.debug(
                  `Received null state for pool ${pool.address}`,
                );
                return null;
              }

              const [unit] = pool.swap(
                unitAmount,
                from,
                to,
                side == SwapSide.BUY,
              );
              // We stop iterating if it becomes 0n at some point
              let lastOutput = 1n;
              let dataList: [bigint, number][] = await Promise.all(
                amounts.map(amount => {
                  if (amount === 0n) {
                    return [0n, 0];
                  }
                  // We don't want to proceed with calculations if lower amount was not fillable
                  if (lastOutput === 0n) {
                    return [0n, 0];
                  }
                  const output = pool.swap(
                    amount,
                    from,
                    to,
                    side == SwapSide.BUY,
                  );
                  lastOutput = output[0];
                  return output;
                }),
              );

              let prices = dataList.map(d => d[0]);
              let gasCosts: number[] = dataList.map(
                ([d, t]: [BigInt, number]) => {
                  if (d == 0n) return 0;
                  // I think it is reasonable estimation assuming "kind" gas cost is almost everytime around 1
                  return (
                    MAV_V1_BASE_GAS_COST +
                    (MAV_V1_TICK_GAS_COST + MAV_V1_KIND_GAS_COST) * t
                  );
                },
              );
              return {
                prices: prices,
                unit: BigInt(unit),
                data: {
                  fee: pool.fee,
                  exchange: this.routerAddress,
                  pool: pool.address,
                  tokenA: pool.tokenA.address,
                  tokenB: pool.tokenB.address,
                  tickSpacing: pool.tickSpacing,
                  protocolFeeRatio: pool.protocolFeeRatio,
                  lookback: pool.lookback,
                },
                exchange: this.dexKey,
                poolIdentifiers: [
                  `${this.dexKey}_${pool.address.toLowerCase()}`,
                ],
                gasCost: gasCosts,
                poolAddresses: [pool.address],
              };
            } catch (e) {
              this.logger.debug(
                `Failed to get prices for pool ${pool.address}, from=${from.address}, to=${to.address}`,
                e,
              );
              return null;
            }
          }),
        )
      ).filter(isTruthy);
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

  // Encode params required by the exchange adapter
  // Used for multiSwap, buy & megaSwap
  // Hint: abiCoder.encodeParameter() could be useful
  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: MaverickV1Data,
    side: SwapSide,
  ): AdapterExchangeParam {
    const { pool } = data;
    const payload = this.abiCoder.encodeParameter(
      {
        ParentStruct: {
          pool: 'address',
          deadline: 'uint256',
        },
      },
      {
        pool,
        deadline: getLocalDeadlineAsFriendlyPlaceholder(), // FIXME: more gas efficient to pass block.timestamp in adapter
      },
    );

    return {
      targetExchange: this.routerAddress,
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
    data: MaverickV1Data,
    side: SwapSide,
  ): DexExchangeParam {
    const swapFunction =
      side === SwapSide.SELL
        ? MaverickV1Functions.exactInputSingle
        : MaverickV1Functions.exactOutputSingle;

    const swapFunctionParams: MaverickV1Param =
      side === SwapSide.SELL
        ? {
            recipient,
            deadline: getLocalDeadlineAsFriendlyPlaceholder(),
            amountIn: srcAmount,
            amountOutMinimum: destAmount,
            tokenIn: srcToken,
            tokenOut: destToken,
            pool: data.pool,
            sqrtPriceLimitD18: '0',
          }
        : {
            recipient,
            deadline: getLocalDeadlineAsFriendlyPlaceholder(),
            amountOut: destAmount,
            amountInMaximum: srcAmount,
            tokenIn: srcToken,
            tokenOut: destToken,
            pool: data.pool,
            sqrtPriceLimitD18: '0',
          };

    const exchangeData = this.routerIface.encodeFunctionData(swapFunction, [
      swapFunctionParams,
    ]);

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: true,
      exchangeData,
      targetExchange: this.config.routerAddress,
      returnAmountPos:
        side === SwapSide.SELL
          ? extractReturnAmountPosition(
              this.routerIface,
              MaverickV1Functions.exactInputSingle,
              'amountOut',
            )
          : undefined,
    };
  }

  async getSimpleParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: MaverickV1Data,
    side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    const swapFunction =
      side === SwapSide.SELL
        ? MaverickV1Functions.exactInputSingle
        : MaverickV1Functions.exactOutputSingle;

    const swapFunctionParams: MaverickV1Param =
      side === SwapSide.SELL
        ? {
            recipient: this.augustusAddress,
            deadline: getLocalDeadlineAsFriendlyPlaceholder(),
            amountIn: srcAmount,
            amountOutMinimum: destAmount,
            tokenIn: srcToken,
            tokenOut: destToken,
            pool: data.pool,
            sqrtPriceLimitD18: '0',
          }
        : {
            recipient: this.augustusAddress,
            deadline: getLocalDeadlineAsFriendlyPlaceholder(),
            amountOut: destAmount,
            amountInMaximum: srcAmount,
            tokenIn: srcToken,
            tokenOut: destToken,
            pool: data.pool,
            sqrtPriceLimitD18: '0',
          };

    const swapData = this.routerIface.encodeFunctionData(swapFunction, [
      swapFunctionParams,
    ]);

    return this.buildSimpleParamWithoutWETHConversion(
      srcToken,
      srcAmount,
      destToken,
      destAmount,
      swapData,
      this.config.routerAddress,
    );
  }

  // shoot duplication
  private async _querySubgraph(
    query: string,
    variables: Object,
    timeout = 30000,
  ) {
    try {
      const res = await this.dexHelper.httpRequest.querySubgraph(
        this.subgraphURL,
        { query, variables },
        { timeout },
      );
      return res.data;
    } catch (e) {
      this.logger.error(`${this.dexKey}: can not query subgraph: `, e);
      return {};
    }
  }

  // Fixme: duplicate of UniswapV3
  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    const _tokenAddress = tokenAddress.toLowerCase();

    const res = await this._querySubgraph(fetchPoolsSortedByBalanceUsd, {
      token: _tokenAddress,
      count: limit,
    });

    if (!(res && res.pools0 && res.pools1)) {
      this.logger.error(
        `Error_${this.dexKey}_Subgraph: couldn't fetch the pools from the subgraph`,
      );
      return [];
    }

    const pools0: PoolLiquidity[] = _.map(res.pools0, pool => ({
      exchange: this.dexKey,
      address: pool.id.toLowerCase(),
      connectorTokens: [
        {
          address: pool.tokenB.id.toLowerCase(),
          decimals: parseInt(pool.tokenB.decimals),
        },
      ],
      liquidityUSD: parseFloat(pool.balanceUSD),
    }));

    const pools1: PoolLiquidity[] = _.map(res.pools1, pool => ({
      exchange: this.dexKey,
      address: pool.id.toLowerCase(),
      connectorTokens: [
        {
          address: pool.tokenA.id.toLowerCase(),
          decimals: parseInt(pool.tokenA.decimals),
        },
      ],
      liquidityUSD: parseFloat(pool.balanceUSD),
    }));

    const allPools = pools0.concat(pools1);

    if (allPools.length === 0) {
      return [];
    }

    const poolBalances = await this._getPoolBalances(
      allPools.map(p => [
        p.address,
        tokenAddress,
        p.connectorTokens[0].address,
      ]),
    );

    const tokensAmounts = allPools
      .map((p, i) => {
        return [
          [tokenAddress, poolBalances[i][0]],
          [p.connectorTokens[0].address, poolBalances[i][1]],
        ] as [string, bigint | null][];
      })
      .flat();

    const poolUsdBalances = await this.dexHelper.getUsdTokenAmounts(
      tokensAmounts,
    );

    const pools = allPools.map((pool, i) => {
      const tokenUsdBalance = poolUsdBalances[i * 2];
      const connectorTokenUsdBalance = poolUsdBalances[i * 2 + 1];

      let tokenUsdLiquidity = null;

      if (tokenUsdBalance) {
        tokenUsdLiquidity = tokenUsdBalance * EFFICIENCY_FACTOR;
      }

      let connectorTokenUsdLiquidity = null;

      if (connectorTokenUsdBalance) {
        connectorTokenUsdLiquidity =
          connectorTokenUsdBalance * EFFICIENCY_FACTOR;
      }

      if (tokenUsdLiquidity) {
        pool.connectorTokens[0] = {
          ...pool.connectorTokens[0],
          liquidityUSD: tokenUsdLiquidity,
        };
      }

      const liquidityUSD = connectorTokenUsdLiquidity || tokenUsdLiquidity || 0;

      return {
        ...pool,
        liquidityUSD,
      };
    });

    return pools
      .sort((a, b) => b.liquidityUSD - a.liquidityUSD)
      .slice(0, limit);
  }

  private async _getPoolBalances(
    pools: [pool: string, token0: string, token1: string][],
  ): Promise<[balanceToken0: bigint | null, balanceToken1: bigint | null][]> {
    const callData: MultiCallParams<bigint>[] = pools
      .map(pool => [
        {
          target: pool[1],
          callData: this.erc20Interface.encodeFunctionData('balanceOf', [
            pool[0],
          ]),
          decodeFunction: uint256ToBigInt,
        },
        {
          target: pool[2],
          callData: this.erc20Interface.encodeFunctionData('balanceOf', [
            pool[0],
          ]),
          decodeFunction: uint256ToBigInt,
        },
      ])
      .flat();

    const balanceOfCalls =
      await this.dexHelper.multiWrapper.tryAggregate<bigint>(false, callData);

    const balances: [bigint | null, bigint | null][] = [];
    for (let i = 0; i < balanceOfCalls.length; i += 2) {
      const balanceToken0 = balanceOfCalls[i];
      const balanceToken1 = balanceOfCalls[i + 1];
      balances.push([
        balanceToken0.success ? balanceToken0.returnData : null,
        balanceToken1.success ? balanceToken1.returnData : null,
      ]);
    }
    return balances;
  }
}

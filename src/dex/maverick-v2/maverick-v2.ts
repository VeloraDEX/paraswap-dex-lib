import _ from 'lodash';
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
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getBigIntPow, getDexKeysWithNetwork, isTruthy } from '../../utils';
import { IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { MaverickV2Data, PoolAPIResponse } from './types';
import { SimpleExchange } from '../simple-exchange';
import {
  MaverickV2Config,
  MAV_V2_BASE_GAS_COST,
  MAV_V2_TICK_GAS_COST,
  MAVERICK_API_URL,
} from './config';
import { MaverickV2EventPool } from './maverick-v2-pool';
import { SUBGRAPH_TIMEOUT } from '../../constants';
import { Interface } from 'ethers';
import MaverickV2PoolABI from '../../abi/maverick-v2/MaverickV2Pool.json';
import MaverickV2RouterABI from '../../abi/maverick-v2/MaverickV2Router.json';
import ERC20ABI from '../../abi/erc20.json';
import { extractReturnAmountPosition } from '../../executor/utils';

const POOL_LIST_CACHE_KEY = 'maverickv2-pool-list';
const POOL_LIST_TTL_SECONDS = 60;

export class MaverickV2 extends SimpleExchange implements IDex<MaverickV2Data> {
  pools: { [key: string]: MaverickV2EventPool } = {};
  readonly hasConstantPriceLargeAmounts = false;
  readonly needWrapNative = true;

  readonly isFeeOnTransferSupported = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(MaverickV2Config);

  logger: Logger;

  public static erc20Interface = new Interface(ERC20ABI);

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
    protected adapters = {},
    protected config = MaverickV2Config[dexKey][network],
    protected maverickV2Iface = new Interface(MaverickV2PoolABI),
    protected maverickV2RouterIface = new Interface(MaverickV2RouterABI),
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey);
  }

  async initializePricing(blockNumber: number) {
    const pools = await this._queryPoolsAPI();

    await Promise.all(
      pools.map(async pool => {
        const eventPool = new MaverickV2EventPool(
          this.dexKey,
          this.network,
          this.dexHelper,
          this.logger,
          {
            address: pool.tokenA.address,
            symbol: pool.tokenA.symbol,
            decimals: pool.tokenA.decimals,
          },
          {
            address: pool.tokenB.address,
            symbol: pool.tokenB.symbol,
            decimals: pool.tokenB.decimals,
          },
          BigInt(pool.fee * 1e18),
          BigInt(pool.feeB * 1e18),
          BigInt(pool.tickSpacing),
          BigInt(0),
          BigInt(pool.lookback),
          BigInt(pool.lowerTick),
          pool.id,
          this.config.poolLensAddress,
        );

        await eventPool.initialize(blockNumber);
        this.pools[eventPool.address] = eventPool;
      }),
    );
  }

  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return null;
  }

  async getEventPools(srcToken: Token, destToken: Token) {
    const fromToken = this.dexHelper.config.wrapETH(srcToken);
    const toToken = this.dexHelper.config.wrapETH(destToken);

    return Object.values(this.pools).filter((pool: MaverickV2EventPool) => {
      const tokenA = pool.tokenA.address.toLowerCase();
      const tokenB = pool.tokenB.address.toLowerCase();

      const fromAddress = fromToken.address.toLowerCase();
      const toAddress = toToken.address.toLowerCase();

      return (
        (tokenA === fromAddress && tokenB === toAddress) ||
        (tokenA === toAddress && tokenB === fromAddress)
      );
    });
  }

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

    const pools = await this.getEventPools(from, to);
    return pools.map(pool => pool.name);
  }

  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<MaverickV2Data>> {
    try {
      const from = this.dexHelper.config.wrapETH(srcToken);
      const to = this.dexHelper.config.wrapETH(destToken);

      if (from.address.toLowerCase() === to.address.toLowerCase()) {
        return null;
      }

      const allPools = await this.getEventPools(from, to);

      const allowedPools = limitPools
        ? allPools.filter(pool => limitPools.includes(pool.name))
        : allPools;

      if (!allowedPools.length) return null;

      const unitAmount = getBigIntPow(
        side === SwapSide.BUY ? to.decimals : from.decimals,
      );

      const tasks = allowedPools.map(async (pool: MaverickV2EventPool) => {
        try {
          const state = await pool.getOrGenerateState(blockNumber);
          if (!state) {
            this.logger.debug(`Received null state for pool ${pool.address}`);
            return null;
          }

          const [unit] = pool.swap(unitAmount, from, to, side === SwapSide.BUY);
          let lastOutput = 1n;

          const dataList: [bigint, bigint][] = amounts.map(amount => {
            if (amount === 0n || lastOutput === 0n) {
              return [0n, 0n];
            }

            const output = pool.swap(amount, from, to, side === SwapSide.BUY);
            lastOutput = output[0];
            return output;
          });

          const gasCosts: number[] = dataList.map(([d, t]) => {
            if (d === 0n) return 0;
            return MAV_V2_BASE_GAS_COST + MAV_V2_TICK_GAS_COST * Number(t);
          });

          return {
            prices: dataList.map(d => d[0]),
            unit: BigInt(unit),
            data: {
              pool: pool.address,
              tokenA: pool.tokenA.address,
              tokenB: pool.tokenB.address,
              activeTick: state.activeTick.toString(),
            },
            exchange: this.dexKey,
            poolIdentifier: pool.name,
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
      });

      return Promise.all(tasks).then(tasks => tasks.filter(isTruthy));
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

  getCalldataGasCost(
    poolPrices: PoolPrices<MaverickV2Data>,
  ): number | number[] {
    return poolPrices.prices.map(p =>
      p !== 0n ? CALLDATA_GAS_COST.DEX_NO_PAYLOAD : 0,
    );
  }

  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: MaverickV2Data,
    side: SwapSide,
  ): AdapterExchangeParam {
    return {
      targetExchange: NULL_ADDRESS,
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
    data: MaverickV2Data,
    side: SwapSide,
  ): DexExchangeParam {
    const { pool } = data;

    const from = this.dexHelper.config.wrapETH(srcToken);
    const tokenAIn = data.tokenA.toLowerCase() === from.toLowerCase();
    const tickLimit = tokenAIn
      ? BigInt(data.activeTick) + 100n
      : BigInt(data.activeTick) - 100n;

    if (side === SwapSide.SELL) {
      // Perform direct swap for SELL side

      const exchangeData = this.maverickV2Iface.encodeFunctionData('swap', [
        recipient,
        {
          amount: srcAmount,
          tokenAIn,
          exactOutput: false,
          tickLimit,
        },
        '0x',
      ]);

      return {
        needWrapNative: this.needWrapNative,
        transferSrcTokenBeforeSwap: pool,
        skipApproval: true,
        targetExchange: pool,
        dexFuncHasRecipient: true,
        exchangeData,
        returnAmountPos: extractReturnAmountPosition(
          this.maverickV2Iface,
          'swap',
          'amountOut',
        ),
      };
    }

    // perform "exactOutputSingleMinimal" via MaverickV2's Router
    const exchangeData = this.maverickV2RouterIface.encodeFunctionData(
      'exactOutputSingleMinimal',
      [recipient, pool, tokenAIn, destAmount, tickLimit],
    );

    return {
      needWrapNative: this.needWrapNative,
      targetExchange: this.config.routerAddress,
      dexFuncHasRecipient: true,
      exchangeData,
      returnAmountPos: extractReturnAmountPosition(
        this.maverickV2RouterIface,
        'exactOutputSingleMinimal',
        'amountOut_',
      ),
    };
  }

  // This is called once before getTopPoolsForToken is
  // called for multiple tokens. This can be helpful to
  // update common state required for calculating
  // getTopPoolsForToken. It is optional for a DEX
  // to implement this
  async updatePoolState(): Promise<void> {
    return Promise.resolve();
  }

  // Returns list of top pools based on liquidity. Max
  // limit number pools should be returned.
  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    const _tokenAddress = this.dexHelper.config
      .wrapETH(tokenAddress)
      .toLowerCase();

    const pools = await this._queryPoolsAPI();

    if (!pools.length) {
      this.logger.error(
        `Error_${this.dexKey}_Subgraph: couldn't fetch the pools from the subgraph`,
      );
      return [];
    }

    const filteredPools = pools.filter(pool => {
      return (
        pool.tokenA.address.toLowerCase() === _tokenAddress ||
        pool.tokenB.address.toLowerCase() === _tokenAddress
      );
    });

    const labeledPools = _.map(filteredPools, pool => {
      let token =
        pool.tokenA.address.toLowerCase() === _tokenAddress
          ? pool.tokenB
          : pool.tokenA;

      return {
        exchange: this.dexKey,
        address: pool.id.toLowerCase(),
        connectorTokens: [
          {
            address: token.address.toLowerCase(),
            decimals: token.decimals,
          },
        ],
        liquidityUSD: pool.tvl.amount,
      };
    });

    const sortedPools = _.sortBy(labeledPools, [
      pool => -1 * pool.liquidityUSD,
    ]);

    return _.slice(sortedPools, 0, limit);
  }

  private async _queryPoolsAPI(): Promise<PoolAPIResponse['pools'] | []> {
    let cachedPoolsJson = await this.dexHelper.cache.getAndCacheLocally(
      this.dexKey,
      this.network,
      POOL_LIST_CACHE_KEY,
      POOL_LIST_TTL_SECONDS,
    );

    if (cachedPoolsJson) return JSON.parse(cachedPoolsJson);

    try {
      const res = await this.dexHelper.httpRequest.get<PoolAPIResponse>(
        `${MAVERICK_API_URL}/api/v5/poolsNoBins/${this.network}`,
        SUBGRAPH_TIMEOUT,
      );

      const pools = res.pools || [];

      await this.dexHelper.cache.setex(
        this.dexKey,
        this.network,
        POOL_LIST_CACHE_KEY,
        POOL_LIST_TTL_SECONDS,
        JSON.stringify(pools),
      );

      return pools;
    } catch (e) {
      this.logger.error(`${this.dexKey}: can not query subgraph: `, e);
      return [];
    }
  }
}

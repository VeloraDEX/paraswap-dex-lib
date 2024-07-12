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
import { Context, IDex } from '../../dex/idex';
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
import { Interface } from '@ethersproject/abi';
import MaverickV2PoolABI from '../../abi/maverick-v2/MaverickV2Pool.json';
import ERC20ABI from '../../abi/erc20.json';
import { extractReturnAmountPosition } from '../../executor/utils';
const EFFICIENCY_FACTOR = 3;

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
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey);
  }

  async initializePricing(blockNumber: number) {
    const pools = await this._queryPoolsAPI(SUBGRAPH_TIMEOUT);

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
          BigInt(pool.fee * 1e6) * BigInt(1e12),
          BigInt(pool.feeB * 1e6) * BigInt(1e12),
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

  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    // TODO:
    if (side === SwapSide.BUY) return [];

    const from = this.dexHelper.config.wrapETH(srcToken);
    const to = this.dexHelper.config.wrapETH(destToken);

    if (from.address.toLowerCase() === to.address.toLowerCase()) {
      return [];
    }

    const pools = await this.getPools(from, to);
    return pools.map(pool => pool.name);
  }

  async getPools(srcToken: Token, destToken: Token) {
    srcToken = this.dexHelper.config.wrapETH(srcToken);
    destToken = this.dexHelper.config.wrapETH(destToken);

    return Object.values(this.pools).filter((pool: MaverickV2EventPool) => {
      return (
        (pool.tokenA.address.toLowerCase() === srcToken.address.toLowerCase() ||
          pool.tokenA.address.toLowerCase() ===
            destToken.address.toLowerCase()) &&
        (pool.tokenB.address.toLowerCase() === srcToken.address.toLowerCase() ||
          pool.tokenB.address.toLowerCase() === destToken.address.toLowerCase())
      );
    });
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

      // TODO:
      if (side === SwapSide.BUY) return null;

      const allPools = await this.getPools(from, to);

      const allowedPools = limitPools
        ? allPools.filter(pool => limitPools.includes(pool.name))
        : allPools;

      if (!allowedPools.length) return null;

      // const unitAmount = getBigIntPow(
      //   side === SwapSide.BUY ? to.decimals : from.decimals,
      // );

      const unitAmount = getBigIntPow(from.decimals);

      const tasks = allowedPools.map(async (pool: MaverickV2EventPool) => {
        try {
          const state = await pool.getOrGenerateState(blockNumber);
          if (!state) {
            this.logger.debug(`Received null state for pool ${pool.address}`);
            return null;
          }

          // const [unit] = pool.swap(unitAmount, from, to, side === SwapSide.BUY);
          const [unit] = pool.swap(unitAmount, from, to, false);
          let lastOutput = 1n;

          const dataList: [bigint, bigint][] = amounts.map(amount => {
            if (amount === 0n || lastOutput === 0n) {
              return [0n, 0n];
            }

            // const output = pool.swap(amount, from, to, side === SwapSide.BUY);
            const output = pool.swap(amount, from, to, false);
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
    _: Context,
    executorAddress: Address,
  ): DexExchangeParam {
    // TODO:
    if (side === SwapSide.BUY) throw new Error(`Buy not supported`);

    const { pool } = data;

    srcToken = this.dexHelper.config.wrapETH(srcToken);
    destToken = this.dexHelper.config.wrapETH(destToken);

    const exchangeData = this.maverickV2Iface.encodeFunctionData('swap', [
      recipient,
      {
        amount: side === SwapSide.SELL ? srcAmount : destAmount,
        tokenAIn: data.tokenA.toLowerCase() === srcToken.toLowerCase(),
        // exactOutput: side === SwapSide.BUY,
        exactOutput: false,
        tickLimit:
          data.tokenA.toLowerCase() === srcToken.toLowerCase()
            ? BigInt(data.activeTick) + 100n
            : BigInt(data.activeTick) - 100n,
      },
      '0x',
    ]);

    return {
      needWrapNative: this.needWrapNative,
      transferSrcTokenBeforeSwap: pool,
      // skipApproval: true,
      targetExchange: pool,
      dexFuncHasRecipient: true,
      exchangeData,
      returnAmountPos:
        side === SwapSide.SELL
          ? extractReturnAmountPosition(
              this.maverickV2Iface,
              'swap',
              'amountOut',
            )
          : undefined,
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
    const _tokenAddress = this.dexHelper.config.wrapETH(tokenAddress);

    const pools = await this._queryPoolsAPI(SUBGRAPH_TIMEOUT);

    if (!pools.length) {
      this.logger.error(
        `Error_${this.dexKey}_Subgraph: couldn't fetch the pools from the subgraph`,
      );
      return [];
    }

    const filteredPools = _.filter(pools, pool => {
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
        liquidityUSD: pool.tvl.amount * EFFICIENCY_FACTOR,
      };
    });

    return _.slice(
      _.sortBy(labeledPools, [pool => -1 * pool.liquidityUSD]),
      0,
      limit,
    );
  }

  private async _queryPoolsAPI(
    timeout = 30000,
  ): Promise<PoolAPIResponse['pools'] | []> {
    try {
      const res = await this.dexHelper.httpRequest.get<PoolAPIResponse>(
        `${MAVERICK_API_URL}/api/v5/poolsNoBins/${this.network}`,
        timeout,
      );
      return res.pools || [];
    } catch (e) {
      this.logger.error(`${this.dexKey}: can not query subgraph: `, e);
      return [];
    }
  }
}

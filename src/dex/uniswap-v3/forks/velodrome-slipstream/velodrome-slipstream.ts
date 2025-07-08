import {
  UniswapV3,
  UNISWAPV3_CLEAN_NOT_EXISTING_POOL_TTL_MS,
  UNISWAPV3_CLEAN_NOT_EXISTING_POOL_INTERVAL_MS,
} from '../../uniswap-v3';
import { Network, SwapSide } from '../../../../constants';
import { IDexHelper } from '../../../../dex-helper';
import { Adapters, UniswapV3Config } from '../../config';
import { Interface } from '@ethersproject/abi';
import UniswapV3QuoterV2ABI from '../../../../abi/uniswap-v3/UniswapV3QuoterV2.abi.json';
import { getDexKeysWithNetwork } from '../../../../utils';
import _ from 'lodash';
import { Address, NumberAsString, Token } from '../../../../types';
import { pack } from '@ethersproject/solidity';
import { PoolState } from '../../types';
import { VelodromeSlipstreamEventPool } from './velodrome-slipstream-pool';
import { UniswapV3EventPool } from '../../uniswap-v3-pool';
import { OnPoolCreatedCallback } from '../../uniswap-v3-factory';

type VelodromeSlipstreamData = {
  path: {
    tokenIn: Address;
    tokenOut: Address;
    fee: NumberAsString;
    currentFee?: NumberAsString;
    tickSpacing?: NumberAsString;
  }[];
  isApproved?: boolean;
};

export class VelodromeSlipstream extends UniswapV3 {
  readonly eventPools: Record<string, VelodromeSlipstreamEventPool | null> = {};

  constructor(
    protected network: Network,
    dexKey: string,
    protected dexHelper: IDexHelper,
    protected adapters = Adapters[network] || {},
    readonly quoterIface = new Interface(UniswapV3QuoterV2ABI),
    protected config = UniswapV3Config[dexKey][network],
    protected poolsToPreload = [],
  ) {
    super(
      network,
      dexKey,
      dexHelper,
      adapters,
      quoterIface,
      config,
      poolsToPreload,
    );
  }

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(
      _.pick(UniswapV3Config, [
        'VelodromeSlipstream',
        'VelodromeSlipstreamNewFactory',
        'AerodromeSlipstream',
      ]),
    );

  async initializePricing(blockNumber: number) {
    // Init listening to new pools creation
    await this.factory.initialize(blockNumber);

    if (!this.dexHelper.config.isSlave) {
      const cleanExpiredNotExistingPoolsKeys = async () => {
        const maxTimestamp =
          Date.now() - UNISWAPV3_CLEAN_NOT_EXISTING_POOL_TTL_MS;
        await this.dexHelper.cache.zremrangebyscore(
          this.notExistingPoolSetKey,
          0,
          maxTimestamp,
        );
      };

      void cleanExpiredNotExistingPoolsKeys();

      this.intervalTask = setInterval(
        cleanExpiredNotExistingPoolsKeys.bind(this),
        UNISWAPV3_CLEAN_NOT_EXISTING_POOL_INTERVAL_MS,
      );
    }
  }

  async getPoolsForIdentifiers(
    srcAddress: string,
    destAddress: string,
    blockNumber: number,
  ): Promise<(UniswapV3EventPool | null)[]> {
    return Promise.all(
      this.config.tickSpacings!.map(async tickSpacing =>
        this.getPool(
          srcAddress,
          destAddress,
          this.config.tickSpacingsToFees![tickSpacing.toString()],
          blockNumber,
          tickSpacing,
        ),
      ),
    );
  }

  protected async getSelectedPools(
    srcAddress: string,
    destAddress: string,
    blockNumber: number,
  ): Promise<(UniswapV3EventPool | null)[]> {
    return Promise.all(
      this.config.tickSpacings!.map(async tickSpacing => {
        const fee = this.config.tickSpacingsToFees![tickSpacing.toString()];
        const locallyFoundPool =
          this.eventPools[
            this.getPoolIdentifier(srcAddress, destAddress, fee, tickSpacing)
          ];

        if (locallyFoundPool) return locallyFoundPool;

        const newlyFetchedPool = await this.getPool(
          srcAddress,
          destAddress,
          fee,
          blockNumber,
          tickSpacing,
        );
        return newlyFetchedPool;
      }),
    );
  }

  protected _encodePath(
    path: {
      tokenIn: Address;
      tokenOut: Address;
      tickSpacing: NumberAsString;
      fee: NumberAsString;
    }[],
    side: SwapSide,
  ): string {
    if (path.length === 0) {
      this.logger.error(
        `${this.dexKey}: Received invalid path=${path} for side=${side} to encode`,
      );
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
            types: ['address', 'uint24', 'address'],
            _path: [curr.tokenIn, curr.tickSpacing, curr.tokenOut],
          };
        } else {
          return {
            types: [...types, 'uint24', 'address'],
            _path: [..._path, curr.tickSpacing, curr.tokenOut],
          };
        }
      },
      { _path: [], types: [] },
    );

    return side === SwapSide.BUY
      ? pack(types.reverse(), _path.reverse())
      : pack(types, _path);
  }

  protected prepareData(
    srcAddress: string,
    destAddress: string,
    pool: UniswapV3EventPool,
    state: PoolState,
  ): VelodromeSlipstreamData {
    return {
      path: [
        {
          tokenIn: srcAddress,
          tokenOut: destAddress,
          fee: pool.feeCode.toString(),
          currentFee: state.fee.toString(),
          tickSpacing: state.tickSpacing!.toString(),
        },
      ],
    };
  }

  /*
   * When a non existing pool is queried, it's blacklisted for an arbitrary long period in order to prevent issuing too many rpc calls
   * Once the pool is created, it gets immediately flagged
   */
  protected onPoolCreatedDeleteFromNonExistingSet(): OnPoolCreatedCallback {
    return async ({
      token0,
      token1,
      fee, // actually this is a tickSpacing in this case
    }) => {
      const tickSpacing = fee;
      const actualFee = this.config.tickSpacingsToFees![tickSpacing.toString()];

      const logPrefix = '[onPoolCreatedDeleteFromNonExistingSet]';
      const [_token0, _token1] = this._sortTokens(token0, token1);
      const poolKey = `${_token0}_${_token1}_${actualFee}_${tickSpacing}`;

      // consider doing it only from master pool for less calls to distant cache

      // delete entry locally to let local instance discover the pool
      delete this.eventPools[
        this.getPoolIdentifier(_token0, _token1, actualFee, tickSpacing)
      ];

      try {
        this.logger.info(
          `${logPrefix} delete pool from not existing set=${this.notExistingPoolSetKey}; key=${poolKey}`,
        );
        // delete pool record from set
        const result = await this.dexHelper.cache.zrem(
          this.notExistingPoolSetKey,
          [poolKey],
        );
        this.logger.info(
          `${logPrefix} delete pool from not existing set=${this.notExistingPoolSetKey}; key=${poolKey}; result: ${result}`,
        );
      } catch (error) {
        this.logger.error(
          `${logPrefix} ERROR: failed to delete pool from set: set=${this.notExistingPoolSetKey}; key=${poolKey}`,
          error,
        );
      }
    };
  }
}

import { Logger } from '../../types';
import { bigIntify, Utils } from '../../utils';
import { IDexHelper } from '../../dex-helper/idex-helper';
import {
  CommonAddresses,
  FluidDexLiquidityProxyState,
  PoolReserve,
  PoolReserveResponse,
} from './types';
import { Contract } from 'ethers';
import ResolverABI from '../../abi/fluid-dex/resolver.abi.json';

const STATE_CACHE_KEY = 'liquidity_proxy_state';
const STATE_TTL_SECONDS = 600; // 10 minutes
const LOCAL_CACHE_TTL_SECONDS = 5; // 5 seconds

export class FluidDexLiquidityProxy {
  readonly resolverContract: Contract;

  constructor(
    readonly dexKey: string,
    readonly commonAddresses: CommonAddresses,
    protected network: number,
    readonly dexHelper: IDexHelper,
    readonly logger: Logger,
  ) {
    this.resolverContract = new Contract(
      this.commonAddresses.resolver,
      ResolverABI,
      this.dexHelper.provider,
    );
  }

  async fetchAndSetState(blockNumber: number): Promise<void> {
    const rawResult =
      await this.resolverContract.callStatic.getAllPoolsReservesAdjusted({
        blockTag: blockNumber,
      });

    const state = this.convertToFluidDexPoolState(rawResult);

    await this.dexHelper.cache.setex(
      this.dexKey,
      this.network,
      STATE_CACHE_KEY,
      STATE_TTL_SECONDS,
      Utils.Serialize(state),
    );
  }

  async getState(): Promise<FluidDexLiquidityProxyState | null> {
    const cached = await this.dexHelper.cache.getAndCacheLocally(
      this.dexKey,
      this.network,
      STATE_CACHE_KEY,
      LOCAL_CACHE_TTL_SECONDS,
    );

    if (cached) {
      return Utils.Parse(cached) as FluidDexLiquidityProxyState;
    }

    return null;
  }

  private convertToFluidDexPoolState(
    poolReserves: PoolReserveResponse[],
  ): FluidDexLiquidityProxyState {
    const result: PoolReserve[] = poolReserves.map(poolReserve => {
      const [
        pool,
        token0,
        token1,
        feeHex,
        centerPriceHex,
        collateralReservesHex,
        debtReservesHex,
        dexLimitsHex,
      ] = poolReserve;

      const fee = Number(feeHex.toString());
      const centerPrice = Number(centerPriceHex.toString());

      const collateralReserves = {
        token0RealReserves: bigIntify(collateralReservesHex[0]),
        token1RealReserves: bigIntify(collateralReservesHex[1]),
        token0ImaginaryReserves: bigIntify(collateralReservesHex[2]),
        token1ImaginaryReserves: bigIntify(collateralReservesHex[3]),
      };

      const debtReserves = {
        token0Debt: bigIntify(debtReservesHex[0]),
        token1Debt: bigIntify(debtReservesHex[1]),
        token0RealReserves: bigIntify(debtReservesHex[2]),
        token1RealReserves: bigIntify(debtReservesHex[3]),
        token0ImaginaryReserves: bigIntify(debtReservesHex[4]),
        token1ImaginaryReserves: bigIntify(debtReservesHex[5]),
      };

      const withdrawableToken0 = {
        available: bigIntify(dexLimitsHex[0][0]),
        expandsTo: bigIntify(dexLimitsHex[0][1]),
        expandsDuration: bigIntify(dexLimitsHex[0][2]),
      };

      const withdrawableToken1 = {
        available: bigIntify(dexLimitsHex[1][0]),
        expandsTo: bigIntify(dexLimitsHex[1][1]),
        expandsDuration: bigIntify(dexLimitsHex[1][2]),
      };

      const borrowableToken0 = {
        available: bigIntify(dexLimitsHex[2][0]),
        expandsTo: bigIntify(dexLimitsHex[2][1]),
        expandsDuration: bigIntify(dexLimitsHex[2][2]),
      };

      const borrowableToken1 = {
        available: bigIntify(dexLimitsHex[3][0]),
        expandsTo: bigIntify(dexLimitsHex[3][1]),
        expandsDuration: bigIntify(dexLimitsHex[3][2]),
      };

      const dexLimits = {
        withdrawableToken0,
        withdrawableToken1,
        borrowableToken0,
        borrowableToken1,
      };

      return {
        pool,
        token0,
        token1,
        fee,
        centerPrice,
        collateralReserves,
        debtReserves,
        dexLimits,
      };
    });

    return { poolsReserves: result };
  }
}

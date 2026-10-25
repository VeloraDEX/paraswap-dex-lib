import _ from 'lodash';
import { Interface } from 'ethers/lib/utils';
import { Network } from '../../../constants';
import { getDexKeysWithNetwork } from '../../../utils';
import { IDexHelper } from '../../../dex-helper/idex-helper';
import SwapRouter from '../../../abi/algebra-integral/SwapRouter.abi.json';
import AlgebraQuoterABI from '../../../abi/algebra-integral/Quoter.abi.json';
import { AlgebraIntegralConfig } from '../config';
import { AlgebraIntegral } from '../algebra-integral';
import { SubgraphHeaders } from '../utils';
import {
  NamiV4Pool,
  NamiV4PoolState,
  buildSwapFeeCallData,
} from './nami-v4-pool';

export class NamiV4 extends AlgebraIntegral {
  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
    readonly routerIface = new Interface(SwapRouter),
    readonly quoterIface = new Interface(AlgebraQuoterABI),
    readonly config = AlgebraIntegralConfig[dexKey][network],
    readonly EventPoolImplementation = NamiV4Pool,
  ) {
    super(
      network,
      dexKey,
      dexHelper,
      routerIface,
      quoterIface,
      config,
      EventPoolImplementation,
    );
  }

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(_.pick(AlgebraIntegralConfig, ['NamiV4']));

  protected getSubgraphHeaders(): SubgraphHeaders {
    const apiKey = this.dexHelper.config.data.namiV4SubgraphApiKey;
    if (!apiKey) {
      this.logger.error(
        `${this.dexKey}: API_KEY_NAMI_V4_SUBGRAPH is not set, subgraph requests will be rejected`,
      );
    }
    return { 'x-api-key': apiKey ?? '' };
  }

  // Polls the plugin's directional swap fee instead of `pool.fee()`. A failed
  // call keeps the previous fees: the plugin reverts on purpose when its fee
  // source is unavailable, and a stale fee is safer than a zero one.
  protected async updateAllPoolFees(): Promise<void> {
    try {
      const activePools = Object.values(this.eventPools).filter(
        (p): p is NamiV4Pool => p !== null && p instanceof NamiV4Pool,
      );
      const poolsWithPlugin = activePools
        .map(pool => ({ pool, state: pool.getNamiState() }))
        .filter(({ state }) => state !== null && !!state.plugin);
      if (!poolsWithPlugin.length) return;

      const results = await this.dexHelper.multiWrapper.tryAggregate<bigint>(
        false,
        poolsWithPlugin.flatMap(({ state }) =>
          buildSwapFeeCallData(state!.plugin),
        ),
      );

      poolsWithPlugin.forEach(({ pool }, i) => {
        const resZto = results[i * 2];
        const resOtz = results[i * 2 + 1];
        if (!resZto.success || !resOtz.success) {
          this.logger.warn(
            `${this.dexKey}: Failed to fetch swapFee for pool ${pool.poolAddress}`,
          );
          return;
        }

        const state = pool.getNamiState();
        if (!state) return;

        const { feeZto, feeOtz } = state.globalState;
        if (feeZto === resZto.returnData && feeOtz === resOtz.returnData) {
          return;
        }

        const newState = {
          ...state,
          globalState: {
            ...state.globalState,
            feeZto: resZto.returnData,
            feeOtz: resOtz.returnData,
          },
        } as NamiV4PoolState;
        pool.setState(newState, pool.getStateBlockNumber());
      });
    } catch (error) {
      this.logger.error(`${this.dexKey}: Error updating pool fees:`, error);
    }
  }
}

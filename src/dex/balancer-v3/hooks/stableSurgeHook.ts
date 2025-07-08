import _ from 'lodash';
import { Log } from '../../../types';
import { DeepReadonly } from 'ts-essentials';
import { HookStateMap } from './balancer-hook-event-subscriber';
import { Interface } from '@ethersproject/abi';
import { Contract } from 'ethers';
import { IDexHelper } from '../../../dex-helper';
import { callData, decodeThrowError } from '../getOnChainState';
import { Logger } from 'log4js';

export const StableSurge = {
  type: 'StableSurge' as const,
  apiName: 'STABLE_SURGE' as const,
};

export type StableSurgeConfig = {
  type: typeof StableSurge.type;
  apiName: typeof StableSurge.apiName;
  factoryAddress: string;
  factoryDeploymentBlock: number;
  hookAddress: string;
};

export type StableSurgePoolSetting = {
  surgeThresholdPercentage?: bigint;
  maxSurgeFeePercentage?: bigint;
};

export type StableSurgeHookState = Record<string, StableSurgePoolSetting>;

/**
 * Retrieve any initial hook state required.
 * @returns
 */
export async function getStableSurgeHookState(
  hookInterface: Interface,
  hookAddress: string,
  factoryAddress: string,
  factoryDeploymentBlock: number,
  dexHelper: IDexHelper,
  blockNumber: number,
): Promise<StableSurgeHookState> {
  if (blockNumber < factoryDeploymentBlock) {
    return {};
  }
  // Find all pools with hook
  const resolverContract = new Contract(
    factoryAddress,
    ['function getPools() external view returns (address[])'],
    dexHelper.provider,
  );
  const pools = (await resolverContract.callStatic.getPools({
    blockTag: blockNumber,
  })) as string[];
  const surgeThresholdCallData: callData[] = pools.flatMap(pool => {
    return [
      {
        target: hookAddress,
        callData: hookInterface.encodeFunctionData(
          'getSurgeThresholdPercentage',
          [pool],
        ),
      },
      {
        target: hookAddress,
        callData: hookInterface.encodeFunctionData('getMaxSurgeFeePercentage', [
          pool,
        ]),
      },
    ];
  });

  // 500 is an arbitrary number chosen based on the blockGasLimit
  const slicedMultiCallData = _.chunk(surgeThresholdCallData, 500);

  const multicallDataResult = (
    await Promise.all(
      slicedMultiCallData.map(async _multiCallData =>
        dexHelper.multiContract.methods
          .tryAggregate(false, _multiCallData)
          .call({}, blockNumber),
      ),
    )
  ).flat();

  return mapPoolsToDecodedData(hookInterface, pools, multicallDataResult);
}

function mapPoolsToDecodedData(
  hookInterface: Interface,
  pools: string[],
  data: any[],
): StableSurgeHookState {
  return pools.reduce((acc, pool, index) => {
    const dataIndex = index * 2;

    // Ensure we have enough data
    if (dataIndex + 1 >= data.length) {
      throw new Error(`Insufficient data for pool ${pool}`);
    }

    // Decode the corresponding data pairs
    const decodedX = decodeThrowError(
      hookInterface,
      'getSurgeThresholdPercentage',
      data[dataIndex],
      pool,
    );
    const decodedY = decodeThrowError(
      hookInterface,
      'getMaxSurgeFeePercentage',
      data[dataIndex + 1],
      pool,
    );
    // Add to accumulator
    acc[pool.toLowerCase()] = {
      surgeThresholdPercentage: decodedX[0].toBigInt(),
      maxSurgeFeePercentage: decodedY[0].toBigInt(),
    };

    return acc;
  }, {} as StableSurgeHookState);
}

/**
 * Handles the event emitted when threshold surge percentage changed.
 * @param event
 * @param state
 * @param log
 * @returns
 */
export function thresholdSurgePercentageChangedEvent(
  event: any,
  state: DeepReadonly<HookStateMap>,
  log: Readonly<Log>,
  logger: Logger,
): DeepReadonly<HookStateMap> | null {
  // ThresholdSurgePercentageChanged(pool, newSurgeThresholdPercentage)
  const hookAddress = log.address.toLowerCase();

  if (!state[hookAddress]) {
    logger.info(`State for hook ${hookAddress} was not found...`);
    return state;
  }

  const newState = _.cloneDeep(state) as HookStateMap;

  if (
    newState[hookAddress] &&
    !(newState[hookAddress] as StableSurgeHookState)[
      event.args.pool.toLowerCase()
    ]
  ) {
    (newState[hookAddress] as StableSurgeHookState)[
      event.args.pool.toLowerCase()
    ] = {
      surgeThresholdPercentage: BigInt(event.args.newSurgeThresholdPercentage),
    };
  } else {
    (newState[hookAddress] as StableSurgeHookState)[
      event.args.pool.toLowerCase()
    ].surgeThresholdPercentage = BigInt(event.args.newSurgeThresholdPercentage);
  }

  return newState;
}

/**
 * Handles the event emitted when max surge fee percentage changed.
 * @param event
 * @param state
 * @param log
 * @returns
 */
export function maxSurgeFeePercentageChangedEvent(
  event: any,
  state: DeepReadonly<HookStateMap>,
  log: Readonly<Log>,
): DeepReadonly<HookStateMap> | null {
  // MaxSurgeFeePercentageChanged(pool, newMaxSurgeFeePercentage)
  const hookAddress = log.address.toLowerCase();
  if (!state[hookAddress]) {
    return null;
  }
  const newState = _.cloneDeep(state) as HookStateMap;

  if (
    newState[hookAddress] &&
    !(newState[hookAddress] as StableSurgeHookState)[
      event.args.pool.toLowerCase() as string
    ]
  ) {
    (newState[hookAddress] as StableSurgeHookState)[
      event.args.pool.toLowerCase()
    ] = {
      maxSurgeFeePercentage: BigInt(event.args.newMaxSurgeFeePercentage),
    };
  } else {
    (newState[hookAddress] as StableSurgeHookState)[
      event.args.pool.toLowerCase()
    ].maxSurgeFeePercentage = BigInt(event.args.newMaxSurgeFeePercentage);
  }

  return newState;
}

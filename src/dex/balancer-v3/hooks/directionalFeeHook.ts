/**
 * Each supported hook should implement its own version of this file making it easy to retrieve required onchain state.
 */
import _ from 'lodash';
import { Log } from '../../../types';
import { DeepReadonly } from 'ts-essentials';
import { HookStateMap } from './balancer-hook-event-subscriber';

export const DirectionalFee = {
  type: 'DirectionalFee' as const,
  apiName: 'DIRECTIONAL_FEE' as const,
};

export type DirectionalFeeConfig = {
  type: typeof DirectionalFee.type;
  apiName: typeof DirectionalFee.apiName;
  address: string;
};

export type DirectionalFeeHookState = {
  test: string; // Note - this is just a dummy example as this specific test hook doesn't have any required state but is used to prove concept
};

/**
 * Retrieve any initial hook state required.
 * @returns
 */
export async function getDirectionalFeeHookState(): Promise<DirectionalFeeHookState> {
  // Note - for other hooks this function would retrieve any initial state using onchain calls
  return { test: 'initial' };
}

/**
 * Handles the event emitted when a new hook is registered.
 * @param event
 * @param state
 * @param log
 * @returns
 */
export function exitFeeHookExampleRegisteredEvent(
  event: any,
  state: DeepReadonly<HookStateMap>,
  log: Readonly<Log>,
): DeepReadonly<HookStateMap> | null {
  // Note - This is a non-important event but demos the use case. Other hooks would implement this for any state changes required for swap maths.
  const hookAddress = event.args.hooksContract.toLowerCase();
  if (!state[hookAddress]) {
    return null;
  }
  const newState = _.cloneDeep(state) as HookStateMap;
  newState[hookAddress] = { test: event.args.pool };
  return newState;
}

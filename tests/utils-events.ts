import _ from 'lodash';
import fs from 'fs';
import path from 'path';
import { Log, BlockHeader, Address } from '../src/types';
import { StatefulEventSubscriber } from '../src/stateful-event-subscriber';
import { Provider } from '@ethersproject/providers';
import { DeepReadonly } from 'ts-essentials';

const configPath = './configs.json';
const absConfigPath = path.join(__dirname, configPath);
let configs: { [k: string]: any } = {};
if (fs.existsSync(absConfigPath)) configs = require(configPath);

const statePath = './states.json';
const absStatePath = path.join(__dirname, statePath);
let states: { [k: string]: any } = {};
if (fs.existsSync(absStatePath)) states = require(statePath);

const logPath = './logs.json';
const absLogPath = path.join(__dirname, logPath);
let logs: { [k: string]: BlockInfo } = {};
if (fs.existsSync(absLogPath)) logs = require(logPath);

const bigintify = (val: string) => BigInt(val);
const stringify = (val: bigint) => val.toString();

export interface BlockInfo {
  logs: Log[];
  blockHeaders: { [blockNumber: number]: BlockHeader };
}

export async function testEventSubscriber<SubscriberState>(
  eventSubscriber: StatefulEventSubscriber<SubscriberState>,
  subscribedAddress: Address[],
  fetchState: (blocknumber: number) => Promise<SubscriberState>,
  blockNumber: number,
  cacheKey: string,
  provider: Provider,
  stateCompare?: (
    state: SubscriberState,
    expectedState: SubscriberState,
  ) => void,
) {
  // Get state of the subscriber block before the event was released
  const poolState = await getOrFetchState(
    blockNumber - 1,
    cacheKey,
    fetchState,
  );

  // Set subscriber state before the event block
  eventSubscriber.setState(
    poolState as DeepReadonly<SubscriberState>,
    blockNumber - 1,
  );
  eventSubscriber.isTracking = () => true;

  // Get logs and blockHeader of the block when the event was emitted
  const blockInfo = await getOrFetchBlockInfo(
    blockNumber,
    cacheKey,
    subscribedAddress,
    provider,
  );

  // Update subscriber with event logs
  await eventSubscriber.update(blockInfo.logs, blockInfo.blockHeaders);

  // Get the expected state of the subscriber after the event
  const expectedNewPoolState = await getOrFetchState(
    blockNumber,
    cacheKey,
    fetchState,
  );

  // Get the updated state of the subscriber
  const newPoolState = eventSubscriber.getState(blockNumber);

  // Expect the updated state to be same as the expected state
  if (stateCompare) {
    expect(newPoolState).not.toBeNull();
    stateCompare(
      newPoolState as SubscriberState,
      expectedNewPoolState as SubscriberState,
    );
  } else {
    expect(newPoolState).toEqual(expectedNewPoolState);
  }
}

export function deepTypecast<T>(
  obj: any,
  checker: (val: any) => boolean,
  caster: (val: T) => any,
): any {
  return _.forEach(obj, (val: any, key: any, obj: any) => {
    obj[key] = checker(val)
      ? caster(val)
      : _.isObject(val)
      ? deepTypecast(val, checker, caster)
      : val;
  });
}

export function getSavedConfig<Config>(
  blockNumber: number,
  cacheKey: string,
): Config | undefined {
  const _config = configs[`${cacheKey}_${blockNumber}`];
  if (_config) {
    const checker = (obj: any) => _.isString(obj) && obj.includes('bi@');
    const caster = (obj: string) => bigintify(obj.slice(3));
    return deepTypecast<string>(_.cloneDeep(_config), checker, caster);
  }
  return undefined;
}

export function saveConfig<Config>(
  blockNumber: number,
  cacheKey: string,
  config: Config,
) {
  const checker = (obj: any) => typeof obj === 'bigint';
  const caster = (obj: bigint) => 'bi@'.concat(stringify(obj));
  const _config = deepTypecast<bigint>(_.cloneDeep(config), checker, caster);
  configs[`${cacheKey}_${blockNumber}`] = _config;
  fs.writeFileSync(absConfigPath, JSON.stringify(configs, null, 2));
}

export function getSavedState<SubscriberState>(
  blockNumber: number,
  cacheKey: string,
): SubscriberState | undefined {
  const _state = states[`${cacheKey}_${blockNumber}`];
  if (_state) {
    const checker = (obj: any) => _.isString(obj) && obj.includes('bi@');
    const caster = (obj: string) => bigintify(obj.slice(3));
    return deepTypecast<string>(_.cloneDeep(_state), checker, caster);
  }
  return undefined;
}

function saveState<SubscriberState>(
  blockNumber: number,
  cacheKey: string,
  state: SubscriberState,
) {
  const checker = (obj: any) => typeof obj === 'bigint';
  const caster = (obj: bigint) => 'bi@'.concat(stringify(obj));
  const _state = deepTypecast<bigint>(_.cloneDeep(state), checker, caster);
  states[`${cacheKey}_${blockNumber}`] = _state;
  fs.writeFileSync(absStatePath, JSON.stringify(states, null, 2));
}

function getSavedBlockInfo(blockNumber: number, cacheKey: string): BlockInfo {
  return logs[`${cacheKey}_${blockNumber}`];
}

function saveBlockInfo(
  blockNumber: number,
  cacheKey: string,
  blockInfo: BlockInfo,
) {
  logs[`${cacheKey}_${blockNumber}`] = blockInfo;
  fs.writeFileSync(absLogPath, JSON.stringify(logs, null, 2));
}

export async function getOrFetchBlockInfo(
  blockNumber: number,
  cacheKey: string,
  subscribedAddress: Address[],
  provider: Provider,
): Promise<BlockInfo> {
  let blockInfo = getSavedBlockInfo(blockNumber, cacheKey);
  if (blockInfo) {
    return blockInfo;
  }

  const logs = (
    await Promise.all(
      subscribedAddress.map(address =>
        provider.getLogs({
          fromBlock: blockNumber,
          toBlock: blockNumber,
          address,
        }),
      ),
    )
  )
    .flat()
    .sort((a, b) => a.logIndex - b.logIndex);

  blockInfo = {
    logs,
    blockHeaders: {
      [blockNumber]: <BlockHeader>(
        (<unknown>await provider.getBlock(blockNumber))
      ),
    },
  };
  saveBlockInfo(blockNumber, cacheKey, blockInfo);

  return blockInfo;
}

export async function getOrFetchState<SubscriberState>(
  blockNumber: number,
  cacheKey: string,
  fetchState: (blockNumber: number) => Promise<SubscriberState>,
): Promise<SubscriberState> {
  let state = getSavedState<SubscriberState>(blockNumber, cacheKey);
  if (state) {
    return state;
  }

  state = await fetchState(blockNumber);
  saveState(blockNumber, cacheKey, state);
  return state;
}

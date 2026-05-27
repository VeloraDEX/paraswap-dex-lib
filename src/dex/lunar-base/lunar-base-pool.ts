import { Interface, JsonFragment } from '@ethersproject/abi';
import { AsyncOrSync, DeepReadonly } from 'ts-essentials';
import { Contract } from 'web3-eth-contract';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { Address, Log, Logger } from '../../types';
import { catchParseLogError } from '../../utils';
import PoolABI from '../../abi/lunar-base/pool.json';
import { LunarBasePoolState } from './types';

const poolIface = new Interface(PoolABI as JsonFragment[]);

function toBigInt(value: any): bigint {
  return BigInt(value.toString());
}

function toNumber(value: any): number {
  return Number(value.toString());
}

export async function getOnChainState(
  multiContract: Contract,
  pool: Address,
  blockNumber: number | 'latest',
): Promise<LunarBasePoolState> {
  const calls = [
    'state',
    'concentrationK',
    'blockDelay',
    'blacklistFeeMultiplier',
    'getXReserve',
    'getYReserve',
    'paused',
  ].map(method => ({
    target: pool,
    callData: poolIface.encodeFunctionData(method, []),
  }));

  const response: { returnData: string[] } = await multiContract.methods
    .aggregate(calls)
    .call({}, blockNumber);

  let offset = 0;
  const state = poolIface.decodeFunctionResult(
    'state',
    response.returnData[offset++],
  );
  const concentrationK = poolIface.decodeFunctionResult(
    'concentrationK',
    response.returnData[offset++],
  )[0];
  const blockDelay = poolIface.decodeFunctionResult(
    'blockDelay',
    response.returnData[offset++],
  )[0];
  const blacklistFeeMultiplier = poolIface.decodeFunctionResult(
    'blacklistFeeMultiplier',
    response.returnData[offset++],
  )[0];
  const reserveX = poolIface.decodeFunctionResult(
    'getXReserve',
    response.returnData[offset++],
  )[0];
  const reserveY = poolIface.decodeFunctionResult(
    'getYReserve',
    response.returnData[offset++],
  )[0];
  const paused = poolIface.decodeFunctionResult(
    'paused',
    response.returnData[offset++],
  )[0];

  return {
    anchorPrice: toBigInt(state[0]),
    feeAskX24: toNumber(state[1]),
    feeBidX24: toNumber(state[2]),
    latestUpdateBlock: toNumber(state[3]),
    concentrationK: toNumber(concentrationK),
    blockDelay: toNumber(blockDelay),
    blacklistFeeMultiplier: toBigInt(blacklistFeeMultiplier),
    reserveX: toBigInt(reserveX),
    reserveY: toBigInt(reserveY),
    paused,
  };
}

export class LunarBaseEventPool extends StatefulEventSubscriber<LunarBasePoolState> {
  private readonly handlers: Record<
    string,
    (
      log: Readonly<Log>,
      state: DeepReadonly<LunarBasePoolState>,
    ) => DeepReadonly<LunarBasePoolState>
  >;

  constructor(
    parentName: string,
    protected dexHelper: IDexHelper,
    public readonly pool: Address,
    logger: Logger,
  ) {
    super(parentName, pool, dexHelper, logger);
    this.addressesSubscribed = [pool];
    this.handlers = {
      [poolIface.getEventTopic('StateUpdated')]:
        this.handleStateUpdated.bind(this),
      [poolIface.getEventTopic('Sync')]: this.handleSync.bind(this),
      [poolIface.getEventTopic('ConcentrationKSet')]:
        this.handleConcentrationKSet.bind(this),
      [poolIface.getEventTopic('BlockDelaySet')]:
        this.handleBlockDelaySet.bind(this),
      [poolIface.getEventTopic('BlacklistFeeMultiplierSet')]:
        this.handleBlacklistFeeMultiplierSet.bind(this),
      [poolIface.getEventTopic('Paused')]: this.handlePaused.bind(this),
      [poolIface.getEventTopic('Unpaused')]: this.handleUnpaused.bind(this),
    };
  }

  getIdentifier(): string {
    return `${this.parentName}_${this.pool}`.toLowerCase();
  }

  async generateState(
    blockNumber: number | 'latest' = 'latest',
  ): Promise<DeepReadonly<LunarBasePoolState>> {
    return getOnChainState(
      this.dexHelper.multiContract,
      this.pool,
      blockNumber,
    );
  }

  async getOrGenerateState(
    blockNumber: number,
  ): Promise<DeepReadonly<LunarBasePoolState> | null> {
    const state = this.getState(blockNumber);
    if (state) return state;

    try {
      const newState = await this.generateState(blockNumber);
      this.setState(newState, blockNumber);
      return newState;
    } catch (e) {
      this.logger.error(`${this.parentName}: failed to generate state`, e);
      return null;
    }
  }

  protected processLog(
    state: DeepReadonly<LunarBasePoolState>,
    log: Readonly<Log>,
  ): AsyncOrSync<DeepReadonly<LunarBasePoolState> | null> {
    const handler = this.handlers[log.topics[0]];
    if (!handler) return null;

    try {
      return handler(log, state);
    } catch (e) {
      catchParseLogError(e, this.logger);
      return null;
    }
  }

  private handleStateUpdated(
    log: Readonly<Log>,
    state: DeepReadonly<LunarBasePoolState>,
  ): DeepReadonly<LunarBasePoolState> {
    const event = poolIface.parseLog(log);
    return {
      ...state,
      anchorPrice: toBigInt(event.args.anchorPrice),
      feeAskX24: toNumber(event.args.feeAskX24),
      feeBidX24: toNumber(event.args.feeBidX24),
      latestUpdateBlock: log.blockNumber,
    };
  }

  private handleSync(
    log: Readonly<Log>,
    state: DeepReadonly<LunarBasePoolState>,
  ): DeepReadonly<LunarBasePoolState> {
    const event = poolIface.parseLog(log);
    return {
      ...state,
      reserveX: toBigInt(event.args.reserveX),
      reserveY: toBigInt(event.args.reserveY),
    };
  }

  private handleConcentrationKSet(
    log: Readonly<Log>,
    state: DeepReadonly<LunarBasePoolState>,
  ): DeepReadonly<LunarBasePoolState> {
    const event = poolIface.parseLog(log);
    return {
      ...state,
      concentrationK: toNumber(event.args.concentrationK),
    };
  }

  private handleBlockDelaySet(
    log: Readonly<Log>,
    state: DeepReadonly<LunarBasePoolState>,
  ): DeepReadonly<LunarBasePoolState> {
    const event = poolIface.parseLog(log);
    return {
      ...state,
      blockDelay: toNumber(event.args.blockDelay),
    };
  }

  private handleBlacklistFeeMultiplierSet(
    log: Readonly<Log>,
    state: DeepReadonly<LunarBasePoolState>,
  ): DeepReadonly<LunarBasePoolState> {
    const event = poolIface.parseLog(log);
    return {
      ...state,
      blacklistFeeMultiplier: toBigInt(event.args.multiplier),
    };
  }

  private handlePaused(
    _log: Readonly<Log>,
    state: DeepReadonly<LunarBasePoolState>,
  ): DeepReadonly<LunarBasePoolState> {
    return { ...state, paused: true };
  }

  private handleUnpaused(
    _log: Readonly<Log>,
    state: DeepReadonly<LunarBasePoolState>,
  ): DeepReadonly<LunarBasePoolState> {
    return { ...state, paused: false };
  }
}

export { poolIface as LunarBasePoolIface };

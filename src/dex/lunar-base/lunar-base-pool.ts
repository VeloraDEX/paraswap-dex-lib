import { Interface, JsonFragment } from '@ethersproject/abi';
import { DeepReadonly } from 'ts-essentials';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { Address, Log, Logger } from '../../types';
import { catchParseLogError } from '../../utils';
import { MultiCallParams, MultiResult } from '../../lib/multi-wrapper';
import { getTopicLogDecoder } from '../../lib/topic-log-decoder';
import PoolABI from '../../abi/lunar-base/pool.json';
import { LunarBasePoolState } from './types';

const poolIface = new Interface(PoolABI as JsonFragment[]);

const toBigInt = (value: any): bigint => BigInt(value.toString());
const toNumber = (value: any): number => Number(value.toString());

const decodeWith =
  (method: string) =>
  (result: MultiResult<any> | any): any => {
    const data = result?.returnData ?? result;
    return poolIface.decodeFunctionResult(method, data);
  };

const GETTERS = [
  'state',
  'maxPunishmentX24',
  'concentrationK',
  'blockDelay',
  'blacklistFeeMultiplier',
  'getXReserve',
  'getYReserve',
  'paused',
] as const;

export async function getOnChainState(
  dexHelper: IDexHelper,
  pool: Address,
  executors: Address[],
  blockNumber: number | 'latest',
): Promise<LunarBasePoolState> {
  const calls: MultiCallParams<any>[] = [
    ...GETTERS.map(method => ({
      target: pool,
      callData: poolIface.encodeFunctionData(method, []),
      decodeFunction: decodeWith(method),
    })),
    ...executors.map(executor => ({
      target: pool,
      callData: poolIface.encodeFunctionData('isWhitelisted', [executor]),
      decodeFunction: decodeWith('isWhitelisted'),
    })),
  ];

  // `maxPunishmentX24` exists only on punishment-model pools and
  // `concentrationK` only on legacy ones, so one of them always reverts.
  const results = await dexHelper.multiWrapper.tryAggregate(
    false,
    calls,
    blockNumber,
    dexHelper.multiWrapper.defaultBatchSize,
    false,
  );
  const [
    state,
    maxPunishment,
    concentrationK,
    blockDelay,
    blacklistFeeMultiplier,
    reserveX,
    reserveY,
    paused,
    ...whitelist
  ] = results;

  const required = [
    state,
    blockDelay,
    blacklistFeeMultiplier,
    reserveX,
    reserveY,
    paused,
    ...whitelist,
  ];
  if (required.some(r => !r.success)) {
    throw new Error(`LunarBase: failed to read state of pool ${pool}`);
  }
  if (!maxPunishment.success && !concentrationK.success) {
    throw new Error(`LunarBase: unknown pricing model of pool ${pool}`);
  }

  return {
    model: maxPunishment.success ? 'punishment' : 'concentration',
    anchorPrice: toBigInt(state.returnData[0]),
    feeAskX24: toNumber(state.returnData[1]),
    feeBidX24: toNumber(state.returnData[2]),
    latestUpdateBlock: toNumber(state.returnData[3]),
    reserveX: toBigInt(reserveX.returnData[0]),
    reserveY: toBigInt(reserveY.returnData[0]),
    blockDelay: toNumber(blockDelay.returnData[0]),
    maxPunishmentX24: maxPunishment.success
      ? toNumber(maxPunishment.returnData[0])
      : 0,
    concentrationK:
      !maxPunishment.success && concentrationK.success
        ? toNumber(concentrationK.returnData[0])
        : 0,
    blacklistFeeMultiplier: toBigInt(blacklistFeeMultiplier.returnData[0]),
    executorsWhitelist: Object.fromEntries(
      executors.map((executor, i) => [
        executor.toLowerCase(),
        Boolean(whitelist[i].returnData[0]),
      ]),
    ),
    paused: Boolean(paused.returnData[0]),
  };
}

export class LunarBaseEventPool extends StatefulEventSubscriber<LunarBasePoolState> {
  private readonly handlers: Record<
    string,
    (
      event: any,
      log: Readonly<Log>,
      state: DeepReadonly<LunarBasePoolState>,
    ) => DeepReadonly<LunarBasePoolState>
  >;

  constructor(
    parentName: string,
    protected dexHelper: IDexHelper,
    public readonly pool: Address,
    protected readonly executors: Address[],
    logger: Logger,
  ) {
    super(parentName, pool, dexHelper, logger);
    this.addressesSubscribed = [pool];
    this.handlers = {
      StateUpdated: (event, log, state) => ({
        ...state,
        anchorPrice: toBigInt(event.args.anchorPrice),
        feeAskX24: toNumber(event.args.feeAskX24),
        feeBidX24: toNumber(event.args.feeBidX24),
        latestUpdateBlock: log.blockNumber,
      }),
      // A swap stores its punished directional fee for the following swaps.
      PunishmentApplied: (event, _log, state) => ({
        ...state,
        feeAskX24: toNumber(event.args.feeAskX24),
        feeBidX24: toNumber(event.args.feeBidX24),
      }),
      Sync: (event, _log, state) => ({
        ...state,
        reserveX: toBigInt(event.args.reserveX),
        reserveY: toBigInt(event.args.reserveY),
      }),
      MaxPunishmentX24Set: (event, _log, state) => ({
        ...state,
        maxPunishmentX24: toNumber(event.args.maxPunishmentX24),
      }),
      ConcentrationKSet: (event, _log, state) => ({
        ...state,
        concentrationK: toNumber(event.args.concentrationK),
      }),
      BlockDelaySet: (event, _log, state) => ({
        ...state,
        blockDelay: toNumber(event.args.blockDelay),
      }),
      BlacklistFeeMultiplierSet: (event, _log, state) => ({
        ...state,
        blacklistFeeMultiplier: toBigInt(event.args.multiplier),
      }),
      WhitelistSet: (event, _log, state) => {
        const account = event.args.account.toLowerCase();
        if (!(account in state.executorsWhitelist)) return state;
        return {
          ...state,
          executorsWhitelist: {
            ...state.executorsWhitelist,
            [account]: Boolean(event.args.whitelisted),
          },
        };
      },
      Paused: (_event, _log, state) => ({ ...state, paused: true }),
      Unpaused: (_event, _log, state) => ({ ...state, paused: false }),
    };
  }

  getIdentifier(): string {
    return `${this.parentName}_${this.pool}`.toLowerCase();
  }

  async generateState(
    blockNumber: number | 'latest' = 'latest',
  ): Promise<DeepReadonly<LunarBasePoolState>> {
    return getOnChainState(
      this.dexHelper,
      this.pool,
      this.executors,
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

  protected async processLog(
    state: DeepReadonly<LunarBasePoolState>,
    log: Readonly<Log>,
  ): Promise<DeepReadonly<LunarBasePoolState> | null> {
    try {
      const event = getTopicLogDecoder(poolIface).decode(log);
      // An implementation upgrade can change the pricing model and the
      // storage behind every getter: re-read the whole state.
      if (event.name === 'Upgraded') {
        return await this.generateState(log.blockNumber);
      }
      const handler = this.handlers[event.name];
      return handler ? handler(event, log, state) : null;
    } catch (e) {
      catchParseLogError(e, this.logger);
      return null;
    }
  }
}

export { poolIface as LunarBasePoolIface };

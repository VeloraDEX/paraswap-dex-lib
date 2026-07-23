import { Contract } from 'ethers';
import { Interface } from 'ethers/lib/utils';
import {
  InitializeStateOptions,
  StatefulEventSubscriber,
} from '../../../../stateful-event-subscriber';
import { IDexHelper } from '../../../../dex-helper';
import { Logger, Log, Address } from '../../../../types';
import ArenaFeeHelperABI from '../../../../abi/uniswap-v4/hooks/arena/arena-fee-helper.abi.json';
import { DeepReadonly } from 'ts-essentials';
import { ArenaHookConfig } from './config';
import { catchParseLogError } from '../../../../utils';
import { MultiCallParams } from '../../../../lib/multi-wrapper';
import { uint256ToBigInt } from '../../../../lib/decoders';

type Fee = {
  recipient: Address;
  feePpm: number;
};

type ProtocolFeeSettings = {
  recipient: Address;
  protocolFeePpm: number;
  referralFeePpm: number;
};

export type ArenaFeeHelperState = {
  protocolFeePpm: ProtocolFeeSettings['protocolFeePpm'];
  poolIdToTotalFeePpm: Record<string, bigint>; // mapping(PoolId => uint256)
};

export class ArenaFeeHelper extends StatefulEventSubscriber<ArenaFeeHelperState> {
  handlers: {
    [event: string]: (
      event: any,
      state: DeepReadonly<ArenaFeeHelperState>,
      log: Readonly<Log>,
    ) => DeepReadonly<ArenaFeeHelperState> | null;
  } = {};

  logDecoder: (log: Log) => any;

  private readonly feeHelperAddress: string;

  private readonly feeHelper: Contract;

  protected poolIds: Set<string> = new Set();

  constructor(
    readonly parentName: string,
    protected network: number,
    protected dexHelper: IDexHelper,
    logger: Logger,
    protected ArenaFeeHelperIface = new Interface(ArenaFeeHelperABI),
  ) {
    super(parentName, 'ArenaFeeHelper', dexHelper, logger, false);

    this.feeHelperAddress =
      ArenaHookConfig[this.network].feeHelperAddress.toLowerCase();
    this.feeHelper = new Contract(
      this.feeHelperAddress,
      ArenaFeeHelperABI,
      dexHelper.provider,
    );

    this.logDecoder = (log: Log) => this.ArenaFeeHelperIface.parseLog(log);
    this.addressesSubscribed = [this.feeHelperAddress];

    this.handlers['FeeArraySet'] = this.handleFeeArraySet.bind(this);
    this.handlers['ProtocolFeeSettingsSet'] =
      this.handleProtocolFeeSettingsSet.bind(this);
  }

  async initialize(
    blockNumber: number,
    options?: InitializeStateOptions<ArenaFeeHelperState>,
  ) {
    return super.initialize(blockNumber, options);
  }

  protected processLog(
    state: DeepReadonly<ArenaFeeHelperState>,
    log: Readonly<Log>,
  ): DeepReadonly<ArenaFeeHelperState> | null {
    try {
      const event = this.logDecoder(log);
      if (event.name in this.handlers) {
        return this.handlers[event.name](event, state, log);
      }
    } catch (e) {
      catchParseLogError(e, this.logger);
    }

    return null;
  }

  async generateState(
    blockNumber?: number | 'latest',
  ): Promise<DeepReadonly<ArenaFeeHelperState>> {
    const protocolFeeSettings: ProtocolFeeSettings =
      await this.feeHelper.protocolFeeSettings();

    const poolIdToTotalFeePpm: Record<string, bigint> = {};
    const calls: MultiCallParams<bigint>[] = [];
    const poolIds = Array.from(this.poolIds);

    for (const poolId of poolIds) {
      calls.push({
        target: this.feeHelperAddress,
        callData: this.feeHelper.interface.encodeFunctionData(
          'poolIdToTotalFeePpm',
          [poolId],
        ),
        decodeFunction: uint256ToBigInt,
      });
    }

    const data = await this.dexHelper.multiWrapper.tryAggregate(false, calls);

    data.forEach((result, index) => {
      poolIdToTotalFeePpm[poolIds[index]] = result.success
        ? result.returnData
        : 0n;
    });

    return {
      protocolFeePpm: protocolFeeSettings.protocolFeePpm,
      poolIdToTotalFeePpm,
    };
  }

  addPoolId(poolId: string) {
    if (this.poolIds.has(poolId)) return;
    this.poolIds.add(poolId);

    const state = this.getStaleState();
    if (state) {
      const poolIdToTotalFeePpm = { ...state.poolIdToTotalFeePpm };
      if (!(poolId in poolIdToTotalFeePpm)) {
        poolIdToTotalFeePpm[poolId] = 0n;
      }

      this.setState(
        {
          ...state,
          poolIdToTotalFeePpm,
        },
        this.stateBlockNumber,
      );
    }
  }

  async getOrGenerateState(blockNumber: number): Promise<ArenaFeeHelperState> {
    let state = this.getState(blockNumber);
    if (!state) {
      state = await this.generateState(blockNumber);
      this.setState(state, blockNumber);
    }
    return state;
  }

  handleFeeArraySet(
    event: any,
    state: DeepReadonly<ArenaFeeHelperState>,
    log: Readonly<Log>,
  ): DeepReadonly<ArenaFeeHelperState> | null {
    const poolId: string = event.args.poolId.toLowerCase();
    const fees: Fee[] = event.args.fees;

    let total = 0n;
    for (const fee of fees) {
      total += BigInt(fee.feePpm.toString());
    }

    return {
      protocolFeePpm: state.protocolFeePpm,
      poolIdToTotalFeePpm: {
        ...state.poolIdToTotalFeePpm,
        [poolId]: total,
      },
    };
  }

  handleProtocolFeeSettingsSet(
    event: any,
    state: DeepReadonly<ArenaFeeHelperState>,
    log: Readonly<Log>,
  ): DeepReadonly<ArenaFeeHelperState> | null {
    const settings: ProtocolFeeSettings = event.args.settings;

    return {
      protocolFeePpm: Number(settings.protocolFeePpm),
      poolIdToTotalFeePpm: { ...state.poolIdToTotalFeePpm },
    };
  }
}

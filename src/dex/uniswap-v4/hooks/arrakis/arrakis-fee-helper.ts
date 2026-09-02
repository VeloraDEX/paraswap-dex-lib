import { Interface } from 'ethers/lib/utils';
import { BytesLike } from 'ethers';
import {
  InitializeStateOptions,
  StatefulEventSubscriber,
} from '../../../../stateful-event-subscriber';
import { IDexHelper } from '../../../../dex-helper';
import { Logger, Log } from '../../../../types';
import ArrakisPrivateHookABI from '../../../../abi/uniswap-v4/hooks/arrakis/arrakis-private-hook.abi.json';
import { DeepReadonly } from 'ts-essentials';
import { ArrakisPrivateHookConfig } from './config';
import { PoolFeesData } from './types';
import { catchParseLogError } from '../../../../utils';
import { MultiCallParams, MultiResult } from '../../../../lib/multi-wrapper';
import { generalDecoder } from '../../../../lib/decoders';
import { NULL_ADDRESS } from '../../../../constants';

export type ArrakisFeeHelperState = {
  poolIdToFeesData: Record<string, PoolFeesData>; // mapping(PoolId => FeesData)
};

const feesDataDecoder = (
  result: MultiResult<BytesLike> | BytesLike,
): PoolFeesData =>
  generalDecoder(
    result,
    ['address', 'uint24', 'uint24'],
    {
      module: NULL_ADDRESS,
      zeroForOneFee: 0n,
      oneForZeroFee: 0n,
    },
    value => ({
      module: value[0].toLowerCase(),
      zeroForOneFee: BigInt(value[1]),
      oneForZeroFee: BigInt(value[2]),
    }),
  );

export class ArrakisFeeHelper extends StatefulEventSubscriber<ArrakisFeeHelperState> {
  handlers: {
    [event: string]: (
      event: any,
      state: DeepReadonly<ArrakisFeeHelperState>,
      log: Readonly<Log>,
    ) => DeepReadonly<ArrakisFeeHelperState> | null;
  } = {};

  logDecoder: (log: Log) => any;

  private readonly hookAddress: string;

  protected poolIds: Set<string> = new Set();

  constructor(
    readonly parentName: string,
    protected network: number,
    protected dexHelper: IDexHelper,
    logger: Logger,
    protected hookIface = new Interface(ArrakisPrivateHookABI),
  ) {
    super(parentName, 'ArrakisFeeHelper', dexHelper, logger, false);

    this.hookAddress =
      ArrakisPrivateHookConfig[this.network].hookAddress.toLowerCase();

    this.logDecoder = (log: Log) => this.hookIface.parseLog(log);
    this.addressesSubscribed = [this.hookAddress];

    this.handlers['SetFees'] = this.handleSetFees.bind(this);
  }

  async initialize(
    blockNumber: number,
    options?: InitializeStateOptions<ArrakisFeeHelperState>,
  ) {
    return super.initialize(blockNumber, options);
  }

  protected processLog(
    state: DeepReadonly<ArrakisFeeHelperState>,
    log: Readonly<Log>,
  ): DeepReadonly<ArrakisFeeHelperState> | null {
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
  ): Promise<DeepReadonly<ArrakisFeeHelperState>> {
    const poolIdToFeesData: Record<string, PoolFeesData> = {};
    const poolIds = Array.from(this.poolIds);

    const calls: MultiCallParams<PoolFeesData>[] = poolIds.map(poolId => ({
      target: this.hookAddress,
      callData: this.hookIface.encodeFunctionData('getFeesData', [poolId]),
      decodeFunction: feesDataDecoder,
    }));

    const data = await this.dexHelper.multiWrapper.tryAggregate(
      false,
      calls,
      typeof blockNumber === 'number' ? blockNumber : undefined,
    );

    data.forEach((result, index) => {
      poolIdToFeesData[poolIds[index]] = result.success
        ? result.returnData
        : {
            module: NULL_ADDRESS,
            zeroForOneFee: 0n,
            oneForZeroFee: 0n,
          };
    });

    return { poolIdToFeesData };
  }

  addPoolId(poolId: string) {
    if (this.poolIds.has(poolId)) return;
    this.poolIds.add(poolId);

    const state = this.getStaleState();
    if (state && !(poolId in state.poolIdToFeesData)) {
      this.setState(
        {
          poolIdToFeesData: {
            ...state.poolIdToFeesData,
            [poolId]: {
              module: NULL_ADDRESS,
              zeroForOneFee: 0n,
              oneForZeroFee: 0n,
            },
          },
        },
        this.stateBlockNumber,
      );
    }
  }

  handleSetFees(
    event: any,
    state: DeepReadonly<ArrakisFeeHelperState>,
  ): DeepReadonly<ArrakisFeeHelperState> | null {
    const poolId: string = event.args.id.toLowerCase();

    return {
      poolIdToFeesData: {
        ...state.poolIdToFeesData,
        [poolId]: {
          module: event.args.module.toLowerCase(),
          zeroForOneFee: BigInt(event.args.zeroForOneFee.toString()),
          oneForZeroFee: BigInt(event.args.oneForZeroFee.toString()),
        },
      },
    };
  }
}

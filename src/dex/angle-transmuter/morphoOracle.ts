import { Interface } from '@ethersproject/abi';
import type { DeepReadonly } from 'ts-essentials';
import type {
  BlockHeader,
  Log,
  Logger,
  MultiCallInput,
  MultiCallOutput,
} from '../../types';
import { bigIntify, catchParseLogError } from '../../utils';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import type { IDexHelper } from '../../dex-helper/idex-helper';
import type { MorphoOracleState } from './types';
import MorphoOracleABI from '../../abi/angle-transmuter/MorphoOracle.json';
import ERC20ABI from '../../abi/erc20.json';
import { getTopicLogDecoder } from '../../lib/topic-log-decoder';

export class MorphoOracleEventPool extends StatefulEventSubscriber<MorphoOracleState> {
  handlers: {
    [event: string]: (
      event: any,
      state: DeepReadonly<MorphoOracleState>,
      log: Readonly<Log>,
      blockHeader: Readonly<BlockHeader>,
    ) => DeepReadonly<MorphoOracleState> | null;
  } = {};

  static morphoOracleIface = new Interface(MorphoOracleABI);
  static erc20Iface = new Interface(ERC20ABI);

  logDecoder: (log: Log) => any;

  addressesSubscribed: string[];

  constructor(
    readonly parentName: string,
    protected network: number,
    protected dexHelper: IDexHelper,
    public morphoOracle: string,
    logger: Logger,
  ) {
    super(parentName, 'Morpho_Oracle', dexHelper, logger);

    this.logDecoder = (log: Log) =>
      getTopicLogDecoder(MorphoOracleEventPool.morphoOracleIface).decode(log);
    this.addressesSubscribed = [morphoOracle];
  }

  /**
   * The function is called every time any of the subscribed
   * addresses release log. The function accepts the current
   * state, updates the state according to the log, and returns
   * the updated state.
   * @param state - Current state of event subscriber
   * @param log - Log released by one of the subscribed addresses
   * @returns Updates state of the event subscriber after the log
   */
  protected processLog(
    state: DeepReadonly<MorphoOracleState>,
    log: Readonly<Log>,
    blockHeader: Readonly<BlockHeader>,
  ): DeepReadonly<MorphoOracleState> | null {
    try {
      const event = this.logDecoder(log);
      if (event.name in this.handlers) {
        return this.handlers[event.name](event, state, log, blockHeader);
      }
    } catch (e) {
      catchParseLogError(e, this.logger);
    }

    return null;
  }

  /**
   * The function generates state using on-chain calls. This
   * function is called to regenerate state if the event based
   * system fails to fetch events and the local state is no
   * more correct.
   * @param blockNumber - Blocknumber for which the state should
   * should be generated
   * @returns state of the event subscriber at blocknumber
   */
  public async generateState(
    blockNumber: number,
  ): Promise<DeepReadonly<MorphoOracleState>> {
    const poolState = {} as MorphoOracleState;

    const multicall = [
      {
        target: this.morphoOracle,
        callData:
          MorphoOracleEventPool.morphoOracleIface.encodeFunctionData(
            'BASE_VAULT',
          ),
      },
      {
        target: this.morphoOracle,
        callData: MorphoOracleEventPool.morphoOracleIface.encodeFunctionData(
          'BASE_VAULT_CONVERSION_SAMPLE',
        ),
      },
      {
        target: this.morphoOracle,
        callData:
          MorphoOracleEventPool.morphoOracleIface.encodeFunctionData(
            'QUOTE_VAULT',
          ),
      },
      {
        target: this.morphoOracle,
        callData: MorphoOracleEventPool.morphoOracleIface.encodeFunctionData(
          'QUOTE_VAULT_CONVERSION_SAMPLE',
        ),
      },
      {
        target: this.morphoOracle,
        callData:
          MorphoOracleEventPool.morphoOracleIface.encodeFunctionData(
            'BASE_FEED_1',
          ),
      },
      {
        target: this.morphoOracle,
        callData:
          MorphoOracleEventPool.morphoOracleIface.encodeFunctionData(
            'BASE_FEED_2',
          ),
      },
      {
        target: this.morphoOracle,
        callData:
          MorphoOracleEventPool.morphoOracleIface.encodeFunctionData(
            'QUOTE_FEED_1',
          ),
      },
      {
        target: this.morphoOracle,
        callData:
          MorphoOracleEventPool.morphoOracleIface.encodeFunctionData(
            'QUOTE_FEED_1',
          ),
      },
      {
        target: this.morphoOracle,
        callData:
          MorphoOracleEventPool.morphoOracleIface.encodeFunctionData(
            'SCALE_FACTOR',
          ),
      },
    ];

    // on chain call
    const returnData = (
      await this.dexHelper.multiContract.methods
        .aggregate(multicall)
        .call({}, blockNumber)
    ).returnData;

    // Decode
    poolState.baseVault =
      MorphoOracleEventPool.morphoOracleIface.decodeFunctionResult(
        'BASE_VAULT',
        returnData[0],
      )[0] as string;
    poolState.baseVaultConversion = bigIntify(
      MorphoOracleEventPool.morphoOracleIface.decodeFunctionResult(
        'BASE_VAULT_CONVERSION_SAMPLE',
        returnData[1],
      )[0],
    );
    poolState.quoteVault =
      MorphoOracleEventPool.morphoOracleIface.decodeFunctionResult(
        'QUOTE_VAULT',
        returnData[2],
      )[0] as string;
    poolState.quoteVaultConversion = bigIntify(
      MorphoOracleEventPool.morphoOracleIface.decodeFunctionResult(
        'QUOTE_VAULT_CONVERSION_SAMPLE',
        returnData[3],
      )[0],
    );
    poolState.baseFeed1 =
      MorphoOracleEventPool.morphoOracleIface.decodeFunctionResult(
        'BASE_FEED_1',
        returnData[4],
      )[0] as string;
    poolState.baseFeed2 =
      MorphoOracleEventPool.morphoOracleIface.decodeFunctionResult(
        'BASE_FEED_2',
        returnData[5],
      )[0] as string;
    poolState.quoteFeed1 =
      MorphoOracleEventPool.morphoOracleIface.decodeFunctionResult(
        'QUOTE_FEED_1',
        returnData[6],
      )[0] as string;
    poolState.quoteFeed2 =
      MorphoOracleEventPool.morphoOracleIface.decodeFunctionResult(
        'QUOTE_FEED_2',
        returnData[7],
      )[0] as string;
    poolState.scaleFactor = bigIntify(
      MorphoOracleEventPool.morphoOracleIface.decodeFunctionResult(
        'SCALE_FACTOR',
        returnData[8],
      )[0],
    );

    return poolState;
  }

  static getGenerateInfoMultiCallInput(morphoOracle: string): MultiCallInput[] {
    return [
      {
        target: morphoOracle,
        callData:
          MorphoOracleEventPool.morphoOracleIface.encodeFunctionData(
            'BASE_VAULT',
          ),
      },
      {
        target: morphoOracle,
        callData: MorphoOracleEventPool.morphoOracleIface.encodeFunctionData(
          'BASE_VAULT_CONVERSION_SAMPLE',
        ),
      },
      {
        target: morphoOracle,
        callData:
          MorphoOracleEventPool.morphoOracleIface.encodeFunctionData(
            'QUOTE_VAULT',
          ),
      },
      {
        target: morphoOracle,
        callData: MorphoOracleEventPool.morphoOracleIface.encodeFunctionData(
          'QUOTE_VAULT_CONVERSION_SAMPLE',
        ),
      },
      {
        target: morphoOracle,
        callData:
          MorphoOracleEventPool.morphoOracleIface.encodeFunctionData(
            'BASE_FEED_1',
          ),
      },
      {
        target: morphoOracle,
        callData:
          MorphoOracleEventPool.morphoOracleIface.encodeFunctionData(
            'BASE_FEED_2',
          ),
      },
      {
        target: morphoOracle,
        callData:
          MorphoOracleEventPool.morphoOracleIface.encodeFunctionData(
            'QUOTE_FEED_1',
          ),
      },
      {
        target: morphoOracle,
        callData:
          MorphoOracleEventPool.morphoOracleIface.encodeFunctionData(
            'QUOTE_FEED_1',
          ),
      },
      {
        target: morphoOracle,
        callData:
          MorphoOracleEventPool.morphoOracleIface.encodeFunctionData(
            'SCALE_FACTOR',
          ),
      },
    ];
  }

  static generateInfo(
    multicallOutputs: MultiCallOutput[],
  ): DeepReadonly<MorphoOracleState> {
    const poolState = {} as MorphoOracleState;

    // Decode
    poolState.baseVault =
      MorphoOracleEventPool.morphoOracleIface.decodeFunctionResult(
        'BASE_VAULT',
        multicallOutputs[0],
      )[0] as string;
    poolState.baseVaultConversion = bigIntify(
      MorphoOracleEventPool.morphoOracleIface.decodeFunctionResult(
        'BASE_VAULT_CONVERSION_SAMPLE',
        multicallOutputs[1],
      )[0],
    );
    poolState.quoteVault =
      MorphoOracleEventPool.morphoOracleIface.decodeFunctionResult(
        'QUOTE_VAULT',
        multicallOutputs[2],
      )[0] as string;
    poolState.quoteVaultConversion = bigIntify(
      MorphoOracleEventPool.morphoOracleIface.decodeFunctionResult(
        'QUOTE_VAULT_CONVERSION_SAMPLE',
        multicallOutputs[3],
      )[0],
    );
    poolState.baseFeed1 =
      MorphoOracleEventPool.morphoOracleIface.decodeFunctionResult(
        'BASE_FEED_1',
        multicallOutputs[4],
      )[0] as string;
    poolState.baseFeed2 =
      MorphoOracleEventPool.morphoOracleIface.decodeFunctionResult(
        'BASE_FEED_2',
        multicallOutputs[5],
      )[0] as string;
    poolState.quoteFeed1 =
      MorphoOracleEventPool.morphoOracleIface.decodeFunctionResult(
        'QUOTE_FEED_1',
        multicallOutputs[6],
      )[0] as string;
    poolState.quoteFeed2 =
      MorphoOracleEventPool.morphoOracleIface.decodeFunctionResult(
        'QUOTE_FEED_2',
        multicallOutputs[7],
      )[0] as string;
    poolState.scaleFactor = bigIntify(
      MorphoOracleEventPool.morphoOracleIface.decodeFunctionResult(
        'SCALE_FACTOR',
        multicallOutputs[8],
      )[0],
    );

    return poolState;
  }
}

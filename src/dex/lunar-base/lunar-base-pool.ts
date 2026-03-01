import { Interface } from '@ethersproject/abi';
import { DeepReadonly } from 'ts-essentials';
import { Log, Logger } from '../../types';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { IDexHelper } from '../../dex-helper/idex-helper';
import {
  LunarBasePoolState,
  BaseFeeConfig,
  calculateEffectiveFee,
} from './types';
import LunarPoolABI from '../../abi/lunar-base/lunar-pool.json';

const SYNC_TOPIC =
  '0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1';

export class LunarBaseEventPool extends StatefulEventSubscriber<LunarBasePoolState> {
  private poolIface: Interface;

  decoder = (log: Log) => this.poolIface.parseLog(log);

  constructor(
    parentName: string,
    protected dexHelper: IDexHelper,
    private poolAddress: string,
    private token0: { address: string; symbol?: string },
    private token1: { address: string; symbol?: string },
    private baseFeeConfig: BaseFeeConfig,
    logger: Logger,
  ) {
    super(
      parentName,
      `${token0.symbol || token0.address}-${token1.symbol || token1.address}`,
      dexHelper,
      logger,
    );
    this.poolIface = new Interface(LunarPoolABI);
  }

  protected processLog(
    state: DeepReadonly<LunarBasePoolState>,
    log: Readonly<Log>,
  ): DeepReadonly<LunarBasePoolState> | null {
    if (log.topics[0] !== SYNC_TOPIC) return null;

    try {
      const event = this.decoder(log);
      if (event.name === 'Sync') {
        return {
          reserves0: event.args.reserve0.toString(),
          reserves1: event.args.reserve1.toString(),
          feeCode: state.feeCode,
          baseFeeConfig: state.baseFeeConfig,
        };
      }
    } catch (e) {
      this.logger.error(`Error processing log for ${this.poolAddress}:`, e);
    }
    return null;
  }

  async generateState(
    blockNumber: number | 'latest' = 'latest',
  ): Promise<DeepReadonly<LunarBasePoolState>> {
    const calldata = [
      {
        target: this.poolAddress,
        callData: this.poolIface.encodeFunctionData('getReserves', []),
      },
    ];

    const data: { returnData: any[] } =
      await this.dexHelper.multiContract.methods
        .aggregate(calldata)
        .call({}, blockNumber);

    const decodedData = this.poolIface.decodeFunctionResult(
      'getReserves',
      data.returnData[0],
    );

    const feeCode = calculateEffectiveFee(this.baseFeeConfig, true);

    return {
      reserves0: decodedData[0].toString(),
      reserves1: decodedData[1].toString(),
      feeCode,
      baseFeeConfig: this.baseFeeConfig,
    };
  }

  getBaseFeeConfig(): BaseFeeConfig {
    return this.baseFeeConfig;
  }
}

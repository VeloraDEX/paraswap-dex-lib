import { AbiCoder, Interface } from 'ethers';
import { IDexHelper } from '../../dex-helper';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { Address, Log, Logger } from '../../types';
import { AsyncOrSync, DeepReadonly } from 'ts-essentials';
import { FxProtocolPoolState } from './types';
import { BI_POWS } from '../../bigint-constants';
import { getOnChainState } from './utils';

const ANSWER_UPDATED_TOPICHASH = `0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f`;
const UPDATE_REDEEM_FEE_TOPICHASH = `0xb3d49e95905d108ea668ffe62a85ee16bdc4ff9f122a7137964327ea8e0585ff`;

export class FxProtocolRusdEvent extends StatefulEventSubscriber<FxProtocolPoolState> {
  constructor(
    parentName: string,
    protected dexHelper: IDexHelper,
    private marketAddress: Address,
    private marketInterface: Interface,
    private weETHOracleAddress: Address,
    private weETHOracleIface: Interface,
    logger: Logger,
  ) {
    super(parentName, 'fxProtocolRusd', dexHelper, logger);
    this.addressesSubscribed = [marketAddress, weETHOracleAddress];
  }

  protected processLog(
    state: DeepReadonly<FxProtocolPoolState>,
    log: Readonly<Log>,
  ): AsyncOrSync<DeepReadonly<FxProtocolPoolState> | null> {
    if (log.topics[0] === UPDATE_REDEEM_FEE_TOPICHASH) {
      const [defaultFeeRatio] = AbiCoder.defaultAbiCoder().decode(
        ['uint256', 'int256'],
        log.data,
      );

      return {
        ...state,
        redeemFee: BigInt(defaultFeeRatio).toString(),
      };
    }

    if (log.topics[0] === ANSWER_UPDATED_TOPICHASH) {
      return {
        ...state,
        weETHPrice: BigInt(log.topics[1]).toString(),
      };
    }

    return null;
  }

  async generateState(
    blockNumber: number | 'latest' = 'latest',
  ): Promise<DeepReadonly<FxProtocolPoolState>> {
    const state = await getOnChainState(
      this.dexHelper.multiContract,
      this.marketAddress,
      this.marketInterface,
      this.weETHOracleAddress,
      this.weETHOracleIface,
      blockNumber,
    );
    return state;
  }

  async getPrice(
    blockNumber: number,
    amount: bigint,
    isRedeem: boolean,
  ): Promise<bigint> {
    const state = await this.getOrGenerateState(blockNumber);
    if (!state) throw new Error('Cannot compute price');

    const { nav, redeemFee, weETHPrice } = state;
    const baseTokenPrice = BigInt(weETHPrice) * BI_POWS[10];

    if (isRedeem) {
      return BigInt(
        (amount * BigInt(nav) * (BI_POWS[18] - BigInt(redeemFee))) /
          BI_POWS[18] /
          baseTokenPrice,
      );
    } else {
      return BigInt((baseTokenPrice * amount) / BigInt(nav));
    }
  }

  async getOrGenerateState(
    blockNumber: number,
  ): Promise<DeepReadonly<FxProtocolPoolState> | null> {
    const state = this.getState(blockNumber);
    if (state) {
      return state;
    }

    this.logger.debug(
      `No state found for ${this.addressesSubscribed[0]}, generating new one`,
    );
    const newState = await this.generateState(blockNumber);

    if (!newState) {
      this.logger.debug(
        `Could not regenerate state for ${this.addressesSubscribed[0]}`,
      );
      return null;
    }
    this.setState(newState, blockNumber);
    return newState;
  }
}

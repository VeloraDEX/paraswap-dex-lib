import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { Interface } from '@ethersproject/abi';

import type { IDexHelper } from '../../dex-helper';
import type { DeepReadonly } from 'ts-essentials';
import type { Address, BlockHeader, Log, Logger } from '../../types';
import type { ERC4626PoolState } from './types';
import { uint24ToBigInt, uint256ToBigInt } from '../../lib/decoders';
import { Network } from '../../constants';

export class ERC4626EventPool extends StatefulEventSubscriber<ERC4626PoolState> {
  logDecoder: (log: Log) => any;

  constructor(
    parentName: string,
    network: Network,
    poolName: string,
    protected dexHelper: IDexHelper,
    private vault: Address,
    private asset: Address,
    private wrapperInterface: Interface,
    logger: Logger,
    private depositTopic: string,
    private withdrawTopic: string,
    private transferTopic: string,
    private cooldownEnabled: boolean = false,
  ) {
    super(parentName, poolName, dexHelper, logger);
    this.addressesSubscribed = [vault, asset];
    this.vault = vault.toLowerCase();
    this.asset = asset.toLowerCase();
    this.logDecoder = (log: Log) => this.wrapperInterface.parseLog(log);
  }

  protected async processLog(
    state: DeepReadonly<ERC4626PoolState>,
    log: Readonly<Log>,
    blockHeader: Readonly<BlockHeader>,
  ): Promise<DeepReadonly<ERC4626PoolState> | null> {
    const topic0 = log.topics[0];

    try {
      if (topic0 === this.transferTopic) {
        if (log.address.toLowerCase() !== this.asset) {
          return null;
        }

        const event = this.logDecoder(log);
        if (event.args.to.toLowerCase() === this.vault) {
          return this.handleAssetTransferToVault(event, state, log);
        }

        return null;
      }

      if (topic0 === this.depositTopic) {
        const event = this.logDecoder(log);
        return this.handleDeposit(event, state, log);
      }

      if (topic0 === this.withdrawTopic) {
        const event = this.logDecoder(log);
        return this.handleWithdraw(event, state, log);
      }

      return null;
    } catch (error) {
      this.logger.error(
        `Error processing log: ${JSON.stringify(log)}, error: ${error}`,
      );
      return null;
    }
  }

  async generateState(
    blockNumber: number | 'latest' = 'latest',
  ): Promise<DeepReadonly<ERC4626PoolState>> {
    const calls = [
      {
        target: this.vault,
        callData: this.wrapperInterface.encodeFunctionData('totalAssets', []),
        decodeFunction: uint256ToBigInt,
      },
      {
        target: this.vault,
        callData: this.wrapperInterface.encodeFunctionData('totalSupply', []),
        decodeFunction: uint256ToBigInt,
      },
      ...(this.cooldownEnabled
        ? [
            {
              target: this.vault,
              callData: this.wrapperInterface.encodeFunctionData(
                'cooldownDuration',
                [],
              ),
              decodeFunction: uint24ToBigInt,
            },
          ]
        : []),
    ];

    const [totalAssets, totalSupply, cooldownDuration] =
      await this.dexHelper.multiWrapper.tryAggregate<bigint>(
        true,
        calls,
        blockNumber,
      );

    return {
      totalAssets: totalAssets.returnData,
      totalShares: totalSupply.returnData,
      cooldownDuration: cooldownDuration?.returnData,
    };
  }

  async getOrGenerateState(blockNumber: number): Promise<ERC4626PoolState> {
    let state = this.getState(blockNumber);
    if (!state) {
      state = await this.generateState(blockNumber);
      this.setState(state, blockNumber);
    }
    return state;
  }

  async handleDeposit(
    event: any,
    state: DeepReadonly<ERC4626PoolState>,
    _: Readonly<Log>,
  ): Promise<DeepReadonly<ERC4626PoolState>> {
    return {
      ...state,
      totalShares: state.totalShares + BigInt(event.args.shares),
    };
  }

  async handleAssetTransferToVault(
    event: any,
    state: DeepReadonly<ERC4626PoolState>,
    _: Readonly<Log>,
  ): Promise<DeepReadonly<ERC4626PoolState>> {
    return {
      ...state,
      totalAssets: state.totalAssets + BigInt(event.args.value),
    };
  }

  async handleWithdraw(
    event: any,
    state: DeepReadonly<ERC4626PoolState>,
    _: Readonly<Log>,
  ): Promise<DeepReadonly<ERC4626PoolState>> {
    return {
      ...state,
      totalAssets: BigInt(state.totalAssets) - BigInt(event.args.assets),
      totalShares: BigInt(state.totalShares) - BigInt(event.args.shares),
    };
  }
}

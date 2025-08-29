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
    try {
      const event = this.logDecoder(log);
      if (
        log.topics[0] === this.transferTopic &&
        log.address.toLowerCase() === this.asset &&
        event.args.to.toLowerCase() === this.vault
      ) {
        return this.handleAssetTransferToVault(event, state, log);
      }
      if (log.topics[0] === this.depositTopic) {
        return this.handleDeposit(event, state, log);
      }
      if (log.topics[0] === this.withdrawTopic) {
        return this.handleWithdraw(event, state, log);
      }
      return null;
    } catch (error) {
      this.logger.error(`Error processing log: ${log}, error: ${error}`);
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

  withdrawRedeemAllowed(state: ERC4626PoolState): boolean {
    if (state.cooldownDuration) {
      return state.cooldownDuration === 0n;
    }

    return true;
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
    log: Readonly<Log>,
  ): Promise<DeepReadonly<ERC4626PoolState>> {
    return {
      // skip assets update, as it should be already handled in handleAssetTransferToVault
      totalAssets: state.totalAssets,
      totalShares: state.totalShares + BigInt(event.args.shares),
    };
  }

  async handleAssetTransferToVault(
    event: any,
    state: DeepReadonly<ERC4626PoolState>,
    log: Readonly<Log>,
  ): Promise<DeepReadonly<ERC4626PoolState>> {
    return {
      totalAssets: state.totalAssets + BigInt(event.args.value),
      totalShares: state.totalShares,
    };
  }

  async handleWithdraw(
    event: any,
    state: DeepReadonly<ERC4626PoolState>,
    log: Readonly<Log>,
  ): Promise<DeepReadonly<ERC4626PoolState>> {
    return {
      totalAssets: BigInt(state.totalAssets) - BigInt(event.args.assets),
      totalShares: BigInt(state.totalShares) - BigInt(event.args.shares),
    };
  }
}

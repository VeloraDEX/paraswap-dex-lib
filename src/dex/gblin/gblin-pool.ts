import { Interface } from '@ethersproject/abi';
import { DeepReadonly } from 'ts-essentials';
import { BlockHeader, Log, Logger } from '../../types';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { GblinPoolState } from './types';
import {
  booleanDecode,
  generalDecoder,
  uint256ToBigInt,
} from '../../lib/decoders';
import GBLIN_ABI from '../../abi/gblin/GBLIN.json';
import GBLIN_LENS_ABI from '../../abi/gblin/GBLINLens.json';
import MULTI_V2_ABI from '../../abi/multi-v2.json';

// The vault prices a mint from its net asset value, which moves only when a basket balance
// changes (a vault event) or a Chainlink answer changes (an AnswerUpdated event on one of the
// aggregators behind the vault's feeds). Any log from those addresses re-reads the state
// on-chain, once per block. The management fee accrues with time and is applied at pricing.
export class GblinEventPool extends StatefulEventSubscriber<GblinPoolState> {
  addressesSubscribed: string[];

  constructor(
    readonly parentName: string,
    protected network: number,
    protected dexHelper: IDexHelper,
    logger: Logger,
    readonly vault: string,
    readonly lens: string,
    readonly feedAggregators: string[],
    readonly vaultIface: Interface = new Interface(GBLIN_ABI),
    readonly lensIface: Interface = new Interface(GBLIN_LENS_ABI),
    readonly multiIface: Interface = new Interface(MULTI_V2_ABI),
  ) {
    super(parentName, `${parentName}_${vault}`, dexHelper, logger);
    this.addressesSubscribed = [vault, ...feedAggregators];
  }

  protected async processLog(
    state: DeepReadonly<GblinPoolState>,
    log: Readonly<Log>,
    blockHeader: Readonly<BlockHeader>,
  ): Promise<DeepReadonly<GblinPoolState> | null> {
    // Several logs land in the same block (a mint emits Transfer and Minted): one read per block.
    if (BigInt(blockHeader.timestamp) === state.timestamp) return null;
    try {
      return await this.generateState(
        log.blockNumber,
        BigInt(blockHeader.timestamp),
      );
    } catch (e) {
      this.logger.error(
        `${this.parentName}: state regeneration failed at block ${log.blockNumber}: ${e}`,
      );
      return null;
    }
  }

  async generateState(
    blockNumber: number | 'latest' = 'latest',
    timestamp?: bigint,
  ): Promise<DeepReadonly<GblinPoolState>> {
    const multicall = this.dexHelper.config.data.multicallV2Address;
    const calls = [
      {
        target: this.vault,
        callData: this.vaultIface.encodeFunctionData('totalSupply', []),
        decodeFunction: uint256ToBigInt,
      },
      {
        target: this.vault,
        callData: this.vaultIface.encodeFunctionData('totalEthValue', [0]),
        decodeFunction: uint256ToBigInt,
      },
      {
        target: this.vault,
        callData: this.vaultIface.encodeFunctionData('isNavReliable', []),
        decodeFunction: booleanDecode,
      },
      {
        target: this.lens,
        callData: this.lensIface.encodeFunctionData('managementFeeBps', [
          this.vault,
        ]),
        decodeFunction: uint256ToBigInt,
      },
      {
        target: this.lens,
        callData: this.lensIface.encodeFunctionData(
          'lastManagementFeeAccrual',
          [this.vault],
        ),
        decodeFunction: uint256ToBigInt,
      },
      {
        target: this.lens,
        callData: this.lensIface.encodeFunctionData('configFees', [this.vault]),
        decodeFunction: (result: any) =>
          generalDecoder(
            result,
            [
              'uint256',
              'uint256',
              'uint256',
              'uint256',
              'uint256',
              'uint256',
              'uint256',
            ],
            undefined,
            v => [v[0].toBigInt(), v[1].toBigInt()] as [bigint, bigint],
          ),
      },
      {
        // stray ETH sitting in the vault counts in the NAV until the next action wraps it
        target: multicall,
        callData: this.multiIface.encodeFunctionData('getEthBalance', [
          this.vault,
        ]),
        decodeFunction: uint256ToBigInt,
      },
    ];

    const results = await this.dexHelper.multiWrapper.tryAggregate<any>(
      false,
      calls,
      blockNumber,
    );

    if (timestamp === undefined) {
      const block = await this.dexHelper.web3Provider.eth.getBlock(blockNumber);
      timestamp = BigInt(block.timestamp);
    }

    // A failed leg means the vault cannot price a mint right now (for instance totalEthValue
    // reverts while a feed is stale): report an unreliable NAV instead of throwing, so pricing
    // returns no prices for this block and the next log re-reads the state.
    const required = [0, 1, 3, 4, 5];
    if (required.some(i => !results[i].success)) {
      return {
        supply: 0n,
        navEth: 0n,
        lastAccrual: 0n,
        managementFeeBps: 0n,
        protocolFeeBps: 0n,
        stabilityFeeBps: 0n,
        navReliable: false,
        timestamp,
      };
    }

    const supply = results[0].returnData as bigint;
    const totalEthValue = results[1].returnData as bigint;
    const navReliable = results[2].success
      ? (results[2].returnData as boolean)
      : false;
    const managementFeeBps = results[3].returnData as bigint;
    const lastAccrual = results[4].returnData as bigint;
    const [protocolFeeBps, stabilityFeeBps] = results[5].returnData as [
      bigint,
      bigint,
    ];
    const ethBalance = results[6].success
      ? (results[6].returnData as bigint)
      : 0n;

    return {
      supply,
      navEth: totalEthValue + ethBalance,
      lastAccrual,
      managementFeeBps,
      protocolFeeBps,
      stabilityFeeBps,
      navReliable,
      timestamp,
    };
  }

  async getOrGenerateState(
    blockNumber: number,
  ): Promise<DeepReadonly<GblinPoolState> | null> {
    let state = this.getState(blockNumber);
    if (!state) {
      state = await this.generateState(blockNumber);
      this.setState(state, blockNumber);
    }
    return state;
  }
}

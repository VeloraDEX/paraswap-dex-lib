import _ from 'lodash';
import { LogDescription } from '@ethersproject/abi';
import { DeepReadonly } from 'ts-essentials';
import { IDexHelper } from '../../dex-helper';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { Log, BlockHeader, Address } from '../../types';
import { erc20Iface } from '../utils-interfaces';
import { getTopicLogDecoder } from '../topic-log-decoder';
import {
  decodeERC20Transfer,
  decodeWrappedDeposit,
  decodeWrappedWithdrawal,
} from './utils';
import { BalanceRequest, getBalances } from '../tokens/balancer-fetcher';
import {
  AssetType,
  DEFAULT_ID_ERC20,
  DEFAULT_ID_ERC20_AS_STRING,
} from '../tokens/types';
import { ERC20Event, ERC20StateMap, WrappedEvent } from './types';
import { CACHE_PREFIX } from '../../constants';
import { catchParseLogError } from '../../utils';

const erc20LogDecoder = getTopicLogDecoder(erc20Iface);

export class ERC20EventSubscriber extends StatefulEventSubscriber<ERC20StateMap> {
  private walletAddresses: Set<string> = new Set<string>();

  private handlers: {
    [event: string]: (
      event: LogDescription,
      pool: ERC20StateMap,
    ) => ERC20StateMap;
  } = {};

  constructor(readonly dexHelper: IDexHelper, private token: Address) {
    super(
      `ERC20Tracker`,
      token,
      dexHelper,
      dexHelper.getLogger(`${token}-${dexHelper.config.data.network}`),
      false,
      `${CACHE_PREFIX}_${dexHelper.config.data.network}_${token}_balances`,
    );
    this.token = token.toLowerCase();
    this.addressesSubscribed = [this.token];

    this.handlers[ERC20Event.Transfer] = this.handleTransferEvent.bind(this);
    this.handlers[WrappedEvent.Deposit] = this.handleWrappedDeposit.bind(this);
    this.handlers[WrappedEvent.Withdrawal] =
      this.handleWrappedWithdrawal.bind(this);
  }

  handleTransferEvent(event: LogDescription, state: ERC20StateMap) {
    const erc20Transfer = decodeERC20Transfer(event);

    if (erc20Transfer.from in state) {
      state[erc20Transfer.from].balance -= erc20Transfer.value;
      this.dexHelper.cache.hset(
        this.mapKey,
        erc20Transfer.from,
        state[erc20Transfer.from].balance.toString(),
      );
    }

    if (erc20Transfer.to in state) {
      state[erc20Transfer.to].balance += erc20Transfer.value;
      this.dexHelper.cache.hset(
        this.mapKey,
        erc20Transfer.to,
        state[erc20Transfer.to].balance.toString(),
      );
    }

    return state;
  }

  handleWrappedDeposit(event: LogDescription, state: ERC20StateMap) {
    const deposit = decodeWrappedDeposit(event);

    if (deposit.dst in state) {
      state[deposit.dst].balance += deposit.wad;
      this.dexHelper.cache.hset(
        this.mapKey,
        deposit.dst,
        state[deposit.dst].balance.toString(),
      );
    }

    return state;
  }

  handleWrappedWithdrawal(event: LogDescription, state: ERC20StateMap) {
    const deposit = decodeWrappedWithdrawal(event);

    if (deposit.src in state) {
      state[deposit.src].balance -= deposit.wad;
      this.dexHelper.cache.hset(
        this.mapKey,
        deposit.src,
        state[deposit.src].balance.toString(),
      );
    }

    return state;
  }

  protected async processBlockLogs(
    state: DeepReadonly<ERC20StateMap>,
    logs: Readonly<Log>[],
    blockHeader: Readonly<BlockHeader>,
  ): Promise<DeepReadonly<ERC20StateMap> | null> {
    const _state = _.cloneDeep(state);
    let newState = await super.processBlockLogs(_state, logs, blockHeader);
    if (!newState) {
      this.logger.warn('received empty state generate new one');
      newState = await this.generateState(blockHeader.number);
    }

    return newState;
  }

  protected processLog(
    state: DeepReadonly<ERC20StateMap>,
    log: Readonly<Log>,
    blockHeader: Readonly<BlockHeader>,
  ): DeepReadonly<ERC20StateMap> | null {
    try {
      const event = erc20LogDecoder.decode(log);
      if (event.name in this.handlers) {
        return this.handlers[event.name](event, state);
      }
    } catch (e) {
      catchParseLogError(e, this.logger);
    }

    return null;
  }

  private async getBalanceRPC(wallet: string, blockNumber: number | 'latest') {
    const balances = await getBalances(
      this.dexHelper.multiWrapper,
      [
        {
          owner: wallet,
          asset: this.token,
          assetType: AssetType.ERC20,
          ids: [
            {
              id: DEFAULT_ID_ERC20,
              spenders: [],
            },
          ],
        },
      ],
      blockNumber,
    );

    return balances[0];
  }

  async subscribeToWalletBalanceChange(
    wallet: Address,
    blockNumber: number,
  ): Promise<void> {
    if (this.walletAddresses.has(wallet)) {
      return;
    }
    this.walletAddresses.add(wallet);

    let state = this.getState(blockNumber) as ERC20StateMap;
    if (state === null) {
      state = {} as ERC20StateMap;
    }

    const balance = await this.getBalanceRPC(wallet, blockNumber);

    state[wallet] = {
      balance: balance.amounts[DEFAULT_ID_ERC20_AS_STRING],
    };

    this.dexHelper.cache.hset(
      this.mapKey,
      balance.owner,
      balance.amounts[DEFAULT_ID_ERC20_AS_STRING].toString(),
    );

    this.setState(state, blockNumber);
  }

  async generateState(blockNumber: number): Promise<Readonly<ERC20StateMap>> {
    const request = Array.from(this.walletAddresses).reduce((acc, wallet) => {
      acc.push({
        owner: wallet,
        asset: this.token,
        assetType: AssetType.ERC20,
        ids: [
          {
            id: DEFAULT_ID_ERC20,
            spenders: [],
          },
        ],
      });

      return acc;
    }, [] as BalanceRequest[]);

    const balances = await getBalances(
      this.dexHelper.multiWrapper,
      request,
      blockNumber,
    );
    return balances.reduce((acc, balance) => {
      acc[balance.owner] = {
        balance: balance.amounts[DEFAULT_ID_ERC20_AS_STRING],
      };
      this.dexHelper.cache.hset(
        this.mapKey,
        balance.owner,
        balance.amounts[DEFAULT_ID_ERC20_AS_STRING].toString(),
      );
      return acc;
    }, {} as ERC20StateMap);
  }

  async getBalance(wallet: Address, blockNumber: number): Promise<bigint> {
    if (this.dexHelper.config.isSlave) {
      const balanceAsString = await this.dexHelper.cache.hget(
        this.mapKey,
        wallet,
      );
      if (!balanceAsString) {
        const res = await this.getBalanceRPC(wallet, 'latest');
        this.logger.warn(
          `fallback to rpc, get token balance ${this.token} ${wallet}`,
        );
        return res.amounts[DEFAULT_ID_ERC20_AS_STRING];
      }

      this.logger.debug('found balance in cache');
      return BigInt(balanceAsString);
    } else {
      const state = this.getState(blockNumber) as ERC20StateMap;

      if (state === null) {
        throw new Error(`State is null`);
      }

      if (!(wallet in state)) {
        this.logger.warn(
          `Missing wallet ${wallet} for ${this.token} falling back to rpc`,
        );
        const balance = await this.getBalanceRPC(wallet, blockNumber);

        // this is ok because we don't modify readonly data
        state[wallet] = {
          balance: balance.amounts[DEFAULT_ID_ERC20_AS_STRING],
        };
      }

      return state[wallet].balance;
    }
  }
}

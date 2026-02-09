import { Provider } from '@ethersproject/providers';
import { LoggerConstructor } from '../types';
import { ICache } from './icache';
import { IRequestWrapper } from './irequest-wrapper';
import { IBlockManager } from './iblock-manager';
import Web3 from 'web3';
import { Contract } from 'web3-eth-contract';
import { Token } from '../types';
import { ConfigHelper } from '../config';
import { MultiWrapper } from '../lib/multi-wrapper';
import { PromiseScheduler } from '../lib/promise-scheduler';
import { AugustusApprovals } from '../dex/augustus-approvals';
import { Address } from '@paraswap/sdk';

export interface IDexHelper {
  config: ConfigHelper;
  cache: ICache;
  httpRequest: IRequestWrapper;
  multiContract: Contract;
  multiWrapper: MultiWrapper;
  // duplicates for cases when making a static call with a non-zero `from`
  // address make a difference (like for some CurveV1StableNg pools)
  // todo: refactor so multi wrapper can take `from` as a param
  multiNonZeroSenderContract: Contract;
  multiNonZeroSenderWrapper: MultiWrapper;
  augustusApprovals: AugustusApprovals;
  promiseScheduler: PromiseScheduler;
  provider: Provider;
  web3Provider: Web3;
  blockManager: IBlockManager;
  getLogger: LoggerConstructor;
  getTokenUSDPrice: (token: Token, amount: bigint) => Promise<number>;
  getUsdTokenAmounts: (
    tokensAmounts: [token: Address, amount: bigint | null][],
  ) => Promise<number[]>;
}

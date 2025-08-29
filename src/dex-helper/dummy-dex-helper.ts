import {
  IDexHelper,
  ICache,
  IBlockManager,
  EventSubscriber,
  IRequestWrapper,
} from './index';
import axios, { AxiosResponse } from 'axios';
import { Address, LoggerConstructor, Token } from '../types';
// import { Contract } from '@ethersproject/contracts';
import { StaticJsonRpcProvider, Provider } from '@ethersproject/providers';
import multiABIV2 from '../abi/multi-v2.json';
import log4js from 'log4js';
import { getLogger } from '../lib/log4js';
import Web3 from 'web3';
import { Contract } from 'web3-eth-contract';
import { generateConfig, ConfigHelper } from '../config';
import { MultiWrapper } from '../lib/multi-wrapper';
import { Response, RequestConfig } from './irequest-wrapper';
import { BlockHeader } from 'web3-eth';
import { PromiseScheduler } from '../lib/promise-scheduler';
import { AugustusApprovals } from '../dex/augustus-approvals';
import { SUBGRAPH_TIMEOUT } from '../constants';

const logger = getLogger('DummyDexHelper');

// This is a dummy cache for testing purposes
class DummyCache implements ICache {
  private storage: Record<string, string> = {};
  private hashStorage: Record<string, Record<string, string>> = {};

  private setMap: Record<string, Set<string>> = {};

  async get(
    dexKey: string,
    network: number,
    cacheKey: string,
  ): Promise<string | null> {
    const key = `${network}_${dexKey}_${cacheKey}`.toLowerCase();
    if (this.storage[key]) {
      return this.storage[key];
    }
    return null;
  }

  async keys(
    dexKey: string,
    network: number,
    cacheKey: string,
  ): Promise<string[]> {
    return [];
  }

  async ttl(
    dexKey: string,
    network: number,
    cacheKey: string,
  ): Promise<number> {
    const key = `${network}_${dexKey}_${cacheKey}`.toLowerCase();
    return this.storage[key] ? 1 : -1;
  }

  async rawget(key: string): Promise<string | null> {
    return this.storage[key] ? this.storage[key] : null;
    return null;
  }

  async rawset(
    key: string,
    value: string,
    ttl: number,
  ): Promise<string | null> {
    this.storage[key] = value;
    return 'OK';
  }

  async rawdel(key: string): Promise<void> {
    delete this.storage[key];
    return;
  }

  async del(
    dexKey: string,
    network: number,
    cacheKey: string,
  ): Promise<number> {
    return 0;
  }

  async setex(
    dexKey: string,
    network: number,
    cacheKey: string,
    ttlSeconds: number,
    value: string,
  ): Promise<void> {
    this.storage[`${network}_${dexKey}_${cacheKey}`.toLowerCase()] = value;
    return;
  }

  async getAndCacheLocally(
    dexKey: string,
    network: number,
    cacheKey: string,
    _ttlSeconds: number,
  ): Promise<string | null> {
    const key = `${network}_${dexKey}_${cacheKey}`.toLowerCase();
    if (this.storage[key]) {
      return this.storage[key];
    }
    return null;
  }

  async setexAndCacheLocally(
    dexKey: string,
    network: number,
    cacheKey: string,
    ttlSeconds: number,
    value: string,
  ): Promise<void> {
    return;
  }

  async sadd(setKey: string, key: string): Promise<void> {
    let set = this.setMap[setKey];
    if (!set) {
      this.setMap[setKey] = new Set();
      set = this.setMap[setKey];
    }

    set.add(key);
  }

  async zremrangebyscore(key: string, min: number, max: number) {
    return 0;
  }

  async zrem(key: string, membersKeys: string[]): Promise<number> {
    return 0;
  }

  async zadd(key: string, bulkItemsToAdd: (number | string)[], option?: 'NX') {
    return 0;
  }

  async zscore() {
    return null;
  }

  async sismember(setKey: string, key: string): Promise<boolean> {
    let set = this.setMap[setKey];
    if (!set) {
      return false;
    }

    return set.has(key);
  }

  async smembers(setKey: string): Promise<string[]> {
    return Array.from(this.setMap[setKey] ?? []);
  }

  async hset(mapKey: string, key: string, value: string): Promise<void> {
    if (!this.hashStorage[mapKey]) this.hashStorage[mapKey] = {};
    this.hashStorage[mapKey][key] = value;
    return;
  }

  async hget(mapKey: string, key: string): Promise<string | null> {
    return this.hashStorage[mapKey]?.[key] ?? null;
  }

  async hlen(mapKey: string): Promise<number> {
    return Object.keys(this.hashStorage[mapKey] ?? {}).length;
  }

  async hmget(mapKey: string, keys: string[]): Promise<(string | null)[]> {
    return keys.map(key => this.hashStorage?.[mapKey]?.[key] ?? null);
  }

  // even though native hmset is deprecated in redis, use it to prevent changing implemented hset
  async hmset(mapKey: string, mappings: Record<string, string>): Promise<void> {
    if (!this.hashStorage[mapKey]) this.hashStorage[mapKey] = {};

    this.hashStorage[mapKey] = {
      ...this.hashStorage[mapKey],
      ...mappings,
    };

    return;
  }

  async hgetAll(mapKey: string): Promise<Record<string, string>> {
    return {};
  }

  async hdel(mapKey: string, keys: string[]): Promise<number> {
    return 0;
  }

  async publish(channel: string, msg: string): Promise<void> {
    return;
  }

  subscribe(
    channel: string,
    cb: (channel: string, msg: string) => void,
  ): () => void {
    return () => {};
  }

  addBatchHGet(
    mapKey: string,
    key: string,
    cb: (result: string | null) => boolean,
  ): void {}
}

export class DummyRequestWrapper implements IRequestWrapper {
  private apiKeyTheGraph?: string;

  constructor(apiKeyTheGraph?: string) {
    if (apiKeyTheGraph) {
      this.apiKeyTheGraph = apiKeyTheGraph;
    }
  }

  async get(
    url: string,
    timeout?: number,
    headers?: { [key: string]: string | number },
  ) {
    const axiosResult = await axios({
      method: 'get',
      url,
      timeout,
      headers: {
        'User-Agent': 'node.js',
        ...headers,
      },
    });
    return axiosResult.data;
  }

  async post(
    url: string,
    data: any,
    timeout?: number,
    headers?: { [key: string]: string | number },
  ) {
    const axiosResult = await axios({
      method: 'post',
      url,
      data,
      timeout,
      headers: {
        'User-Agent': 'node.js',
        ...headers,
      },
    });
    return axiosResult.data;
  }

  request<T = any, R = Response<T>>(config: RequestConfig<any>): Promise<R> {
    return axios.request(config);
  }

  async querySubgraph<T>(
    subgraph: string,
    data: { query: string; variables?: Record<string, any> },
    { timeout = SUBGRAPH_TIMEOUT, type = 'subgraphs' },
  ): Promise<T> {
    if (!subgraph || !data.query || !this.apiKeyTheGraph)
      throw new Error('Invalid TheGraph params');

    let url = `https://gateway-arbitrum.network.thegraph.com/api/${this.apiKeyTheGraph}/${type}/id/${subgraph}`;

    // support for the subgraphs that are on the studio and were not migrated to decentralized network yet
    if (subgraph.includes('studio.thegraph.com')) {
      url = subgraph;
    }

    const response = await axios.post<T>(url, data, { timeout });
    return response.data;
  }
}

class DummyBlockManager implements IBlockManager {
  constructor(public _blockNumber: number = 20569333) {}

  subscribeToLogs(
    subscriber: EventSubscriber,
    contractAddress: Address | Address[],
    afterBlockNumber: number,
  ): void {
    logger.info(
      `Subscribed to logs ${subscriber.name} ${contractAddress} ${afterBlockNumber}`,
    );
    subscriber.isTracking = () => true;
  }

  getLatestBlockNumber(): number {
    return this._blockNumber;
  }

  getActiveChainHead(): Readonly<BlockHeader> {
    return {
      number: this._blockNumber,
      hash: '0x42',
    } as BlockHeader;
  }
}

export class DummyDexHelper implements IDexHelper {
  config: ConfigHelper;
  cache: ICache;
  httpRequest: IRequestWrapper;
  provider: Provider;
  multiContract: Contract;
  multiWrapper: MultiWrapper;
  augustusApprovals: AugustusApprovals;
  promiseScheduler: PromiseScheduler;
  blockManager: IBlockManager;
  getLogger: LoggerConstructor;
  web3Provider: Web3;
  getTokenUSDPrice: (token: Token, amount: bigint) => Promise<number>;
  getUsdTokenAmounts: (
    tokenAmounts: [toke: string, amount: bigint | null][],
  ) => Promise<number[]>;

  constructor(network: number, rpcUrl?: string) {
    this.config = new ConfigHelper(false, generateConfig(network), 'is');
    this.cache = new DummyCache();
    this.httpRequest = new DummyRequestWrapper(this.config.data.apiKeyTheGraph);
    this.provider = new StaticJsonRpcProvider(
      rpcUrl ? rpcUrl : this.config.data.privateHttpProvider,
      network,
    );

    this.web3Provider = new Web3(
      rpcUrl ? rpcUrl : this.config.data.privateHttpProvider,
    );
    this.multiContract = new this.web3Provider.eth.Contract(
      multiABIV2 as any,
      this.config.data.multicallV2Address,
    );
    this.blockManager = new DummyBlockManager();
    this.getLogger = name => {
      const logger = log4js.getLogger(name);
      logger.level = 'debug';
      return logger;
    };
    // For testing use only full parts like 1, 2, 3 ETH, not 0.1 ETH etc
    this.getTokenUSDPrice = async (token, amount: bigint) =>
      Number(BigInt(amount) / 10n ** BigInt(token.decimals));

    // For testing use only full parts like 1, 2, 3 ETH, not 0.1 ETH etc
    this.getUsdTokenAmounts = async (tokenAmounts: [string, bigint | null][]) =>
      tokenAmounts.map(([token, amount]) => {
        if (amount === null) {
          return 0;
        }
        return Number(amount / BigInt(10 ** 18));
      });

    this.multiWrapper = new MultiWrapper(
      this.multiContract,
      this.getLogger(`MultiWrapper-${network}`),
    );

    this.promiseScheduler = new PromiseScheduler(
      100,
      5,
      this.getLogger(`PromiseScheduler-${network}`),
    );

    this.augustusApprovals = new AugustusApprovals(
      this.config,
      this.cache,
      this.multiWrapper,
    );
  }

  replaceProviderWithRPC(rpcUrl: string) {
    this.provider = new StaticJsonRpcProvider(rpcUrl, this.config.data.network);
    this.web3Provider = new Web3(rpcUrl);
    this.multiContract = new this.web3Provider.eth.Contract(
      multiABIV2 as any,
      this.config.data.multicallV2Address,
    );
    this.multiWrapper = new MultiWrapper(
      this.multiContract,
      this.getLogger(`MultiWrapper-${this.config.data.network}`),
    );
  }
}

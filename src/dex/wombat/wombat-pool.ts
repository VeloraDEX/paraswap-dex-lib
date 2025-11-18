import { Interface } from '@ethersproject/abi';
import { AsyncOrSync, DeepReadonly } from 'ts-essentials';
import {
  Address,
  Log,
  Logger,
  MultiCallInput,
  MultiCallOutput,
} from '../../types';
import { catchParseLogError } from '../../utils';
import {
  InitializeStateOptions,
  StatefulEventSubscriber,
} from '../../stateful-event-subscriber';
import { IDexHelper } from '../../dex-helper';
import PoolV2ABI from '../../abi/wombat/pool-v2.json';
import PoolV3ABI from '../../abi/wombat/pool-v3.json';
import AssetABI from '../../abi/wombat/asset.json';
import { BlockHeader } from 'web3-eth';
import { AssetState, PoolState } from './types';
import { uint120ToBigInt } from './utils';
import { uint256ToBigInt } from '../../lib/decoders';

const CLEAR_RPC_CALL_COUNT_INTERVAL = 1000 * 60 * 5; // 5 minutes

export class WombatPool extends StatefulEventSubscriber<PoolState> {
  static readonly poolV2Interface = new Interface(PoolV2ABI);
  static readonly poolV3Interface = new Interface(PoolV3ABI);
  static readonly assetInterface = new Interface(AssetABI);

  private rpcCallCount = 0;

  private handlers: {
    [event: string]: (
      event: any,
      state: DeepReadonly<PoolState>,
      log: Readonly<Log>,
    ) => AsyncOrSync<DeepReadonly<PoolState> | null>;
  } = {};
  private poolInterface: Interface = WombatPool.poolV2Interface;
  private eventRefetched: string[];

  blankState: PoolState = {
    asset: {},
    underlyingAddresses: [],
    params: {
      paused: false,
      ampFactor: 0n,
      haircutRate: 0n,
      withdrawalHaircutRate: 0n,
      startCovRatio: 0n,
      endCovRatio: 0n,
    },
  };

  constructor(
    dexKey: string,
    name: string,
    protected network: number,
    protected dexHelper: IDexHelper,
    logger: Logger,
    protected poolAddress: Address,
  ) {
    super(dexKey, `${network}_${name}`, dexHelper, logger);

    this.addressesSubscribed = [this.poolAddress];

    // users-actions handlers
    this.handlers['Swap'] = this.handleSwap.bind(this);
    this.handlers['SwapV2'] = this.handleSwapV2.bind(this);

    // admin-actions handlers
    this.handlers['SetAmpFactor'] = this.handleSetAmpFactor.bind(this);
    this.handlers['SetHaircutRate'] = this.handleSetHaircutRate.bind(this);
    this.handlers['SetWithdrawalHaircutRate'] =
      this.handleSetWithdrawalHaircutRate.bind(this);
    this.handlers['AssetAdded'] = this.handleAssetAdded.bind(this);
    this.handlers['AssetRemoved'] = this.handleAssetRemoved.bind(this);
    this.handlers['FillPool'] = this.handleFillPool.bind(this);
    this.handlers['Paused'] = this.handlePaused.bind(this);
    this.handlers['Unpaused'] = this.handleUnpaused.bind(this);
    this.handlers['PausedAsset'] = this.handlePausedAsset.bind(this);
    this.handlers['UnpausedAsset'] = this.handleUnpausedAsset.bind(this);

    this.eventRefetched = ['Deposit', 'Withdraw', 'TransferTipBucket'];

    setInterval(() => {
      this.rpcCallCount = 0;
    }, CLEAR_RPC_CALL_COUNT_INTERVAL);
  }

  async initialize(
    blockNumber: number,
    options?: InitializeStateOptions<PoolState>,
  ) {
    const poolContract = new this.dexHelper.web3Provider.eth.Contract(
      PoolV3ABI as any,
      this.poolAddress,
    );
    try {
      await poolContract.methods.withdrawalHaircutRate().call({}, blockNumber);
      this.poolInterface = WombatPool.poolV3Interface;
    } catch (e) {
      this.logger.info(
        `no public variable withdrawalHaircutRate in pool ${this.poolAddress}, this is v2 pool`,
      );
    }
    await super.initialize(blockNumber, options);
  }

  protected async processBlockLogs(
    state: DeepReadonly<PoolState>,
    logs: Readonly<Log>[],
    blockHeader: Readonly<BlockHeader>,
  ): Promise<DeepReadonly<PoolState> | null> {
    let nextState: DeepReadonly<PoolState> | null = null;
    for (const log of logs) {
      try {
        const event = this.poolInterface.parseLog(log);
        if (this.eventRefetched.includes(event.name)) {
          // if the state is refetched, no need to deal with the left logs in the block
          return await this.generateState(log.blockNumber);
        }
      } catch (e) {
        catchParseLogError(e, this.logger);
      }

      const retState: DeepReadonly<PoolState> | null = await this.processLog(
        nextState || state,
        log,
        blockHeader,
      );

      if (retState) {
        nextState = retState;
      }
    }
    return nextState;
  }

  /**
   * The function is called every time any of the subscribed
   * addresses release log. The function accepts the current
   * state, updates the state according to the log, and returns
   * the updated state.
   * @param state - Current state of event subscriber
   * @param log - Log released by one of the subscribed addresses
   * @param blockHeader
   * @returns Updates state of the event subscriber after the log
   */
  protected async processLog(
    state: DeepReadonly<PoolState>,
    log: Readonly<Log>,
    blockHeader: Readonly<BlockHeader>,
  ): Promise<DeepReadonly<PoolState> | null> {
    try {
      const event = this.poolInterface.parseLog(log);
      if (event.name in this.handlers) {
        return await this.handlers[event.name](event, state, log);
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
  async generateState(blockNumber: number): Promise<DeepReadonly<PoolState>> {
    this.rpcCallCount++;

    if (this.rpcCallCount > 1) {
      this.logger.warn(
        `WombatPool generateState excessive RPC call. Name: ${
          this.name
        }. Called ${this.rpcCallCount} times during ${
          CLEAR_RPC_CALL_COUNT_INTERVAL / 1000
        }s interval`,
      );
    }
    let multiCallInputs: MultiCallInput[] = [];
    const isV3Pool = this.poolInterface === WombatPool.poolV3Interface;

    // 1.A generate pool params requests
    // paused
    multiCallInputs.push({
      target: this.poolAddress,
      callData: this.poolInterface.encodeFunctionData('paused'),
    });
    // ampFactor
    multiCallInputs.push({
      target: this.poolAddress,
      callData: this.poolInterface.encodeFunctionData('ampFactor'),
    });
    // haircutRate
    multiCallInputs.push({
      target: this.poolAddress,
      callData: this.poolInterface.encodeFunctionData('haircutRate'),
    });
    if (isV3Pool) {
      multiCallInputs.push({
        target: this.poolAddress,
        callData: this.poolInterface.encodeFunctionData(
          'withdrawalHaircutRate',
        ),
      });
    }
    // startCovRatio
    multiCallInputs.push({
      target: this.poolAddress,
      callData: this.poolInterface.encodeFunctionData('startCovRatio'),
    });
    // endCovRatio
    multiCallInputs.push({
      target: this.poolAddress,
      callData: this.poolInterface.encodeFunctionData('endCovRatio'),
    });
    // tokens
    multiCallInputs.push({
      target: this.poolAddress,
      callData: this.poolInterface.encodeFunctionData('getTokens'),
    });

    // 1.B. invoke multicall
    let returnData: MultiCallOutput[] = [];
    if (multiCallInputs.length) {
      returnData = (
        await this.dexHelper.multiContract.methods
          .aggregate(multiCallInputs)
          .call({}, blockNumber)
      ).returnData;
    }

    let i = 0;
    // 1.C. decode pool params
    const paused = Boolean(
      this.poolInterface.decodeFunctionResult('paused', returnData[i++])[0],
    );
    const ampFactor = BigInt(
      this.poolInterface.decodeFunctionResult('ampFactor', returnData[i++])[0],
    );
    const haircutRate = BigInt(
      this.poolInterface.decodeFunctionResult(
        'haircutRate',
        returnData[i++],
      )[0],
    );
    const withdrawalHaircutRate = isV3Pool
      ? BigInt(
          this.poolInterface.decodeFunctionResult(
            'withdrawalHaircutRate',
            returnData[i++],
          )[0],
        )
      : 0n;
    const startCovRatio = BigInt(
      this.poolInterface.decodeFunctionResult(
        'startCovRatio',
        returnData[i++],
      )[0],
    );
    const endCovRatio = BigInt(
      this.poolInterface.decodeFunctionResult(
        'endCovRatio',
        returnData[i++],
      )[0],
    );

    const tokens = this.poolInterface
      .decodeFunctionResult('getTokens', returnData[i++])[0]
      .map((tokenAddress: Address) => tokenAddress.toLowerCase());

    const poolState: PoolState = {
      params: {
        paused,
        ampFactor,
        haircutRate,
        withdrawalHaircutRate,
        startCovRatio,
        endCovRatio,
      },
      underlyingAddresses: tokens,
      asset: {},
    };

    // 2.A. generate requests for getting asset addresses
    multiCallInputs = tokens.map((tokenAddress: Address) => ({
      target: this.poolAddress,
      callData: this.poolInterface.encodeFunctionData('addressOfAsset', [
        tokenAddress,
      ]),
    }));

    // 2.B. invoke multicall
    returnData = (
      await this.dexHelper.multiContract.methods
        .aggregate(multiCallInputs)
        .call({}, blockNumber)
    ).returnData;

    // 2.C. decode asset addresses
    const assets: Address[] = returnData.map(data => {
      return this.poolInterface.decodeFunctionResult('addressOfAsset', data)[0];
    });

    // 3. get asset states
    const assetState = await this.getAssetState(
      this.poolAddress,
      assets.map(asset => asset.toLowerCase()),
      tokens,
      blockNumber,
    );
    const isMainPool =
      assetState.filter(asset => asset.relativePrice === undefined).length > 0;
    for (let j = 0; j < tokens.length; j++) {
      if (isMainPool) {
        assetState[j].relativePrice = undefined;
      }
      poolState.asset[tokens[j]] = assetState[j];
    }

    return poolState;
  }

  async getOrGenerateState(blockNumber: number): Promise<Readonly<PoolState>> {
    let state = this.getState(blockNumber);
    if (!state) {
      state = await this.generateState(blockNumber);
      this.setState(state, blockNumber);
      this.logger.info(
        `Empty state, generated state for pool ${this.poolAddress} at block ${blockNumber}`,
      );
    }

    return {
      ...state,
      underlyingAddresses: Array.from(state.underlyingAddresses),
    };
  }

  handleSwap(
    event: any,
    state: DeepReadonly<PoolState>,
    log: Readonly<Log>,
  ): AsyncOrSync<DeepReadonly<PoolState> | null> {
    const fromTokenAddress = event.args.fromToken.toString().toLowerCase();
    const toTokenAddress = event.args.toToken.toString().toLowerCase();

    if (
      !state.underlyingAddresses.includes(fromTokenAddress) ||
      !state.underlyingAddresses.includes(toTokenAddress)
    ) {
      return null;
    }

    return this.refreshAssetStates(
      state,
      [fromTokenAddress, toTokenAddress],
      log.blockNumber,
    );
  }

  handleSwapV2(
    event: any,
    state: DeepReadonly<PoolState>,
    log: Readonly<Log>,
  ): AsyncOrSync<DeepReadonly<PoolState> | null> {
    const fromTokenAddress = event.args.fromToken.toString().toLowerCase();
    const toTokenAddress = event.args.toToken.toString().toLowerCase();

    if (
      !state.underlyingAddresses.includes(fromTokenAddress) ||
      !state.underlyingAddresses.includes(toTokenAddress)
    ) {
      return null;
    }

    return this.refreshAssetStates(
      state,
      [fromTokenAddress, toTokenAddress],
      log.blockNumber,
    );
  }

  handleSetAmpFactor(
    event: any,
    state: DeepReadonly<PoolState>,
    _log: Readonly<Log>,
  ): AsyncOrSync<DeepReadonly<PoolState> | null> {
    const ampFactor = BigInt(event.args.value.toString());

    return {
      ...state,
      params: {
        ...state.params,
        ampFactor,
      },
    };
  }

  handleSetHaircutRate(
    event: any,
    state: DeepReadonly<PoolState>,
    _log: Readonly<Log>,
  ): AsyncOrSync<DeepReadonly<PoolState> | null> {
    const haircutRate = BigInt(event.args.value.toString());

    return {
      ...state,
      params: {
        ...state.params,
        haircutRate,
      },
    };
  }

  handleSetWithdrawalHaircutRate(
    event: any,
    state: DeepReadonly<PoolState>,
    _log: Readonly<Log>,
  ): AsyncOrSync<DeepReadonly<PoolState> | null> {
    const withdrawalHaircutRate = BigInt(event.args.value.toString());

    return {
      ...state,
      params: {
        ...state.params,
        withdrawalHaircutRate,
      },
    };
  }

  async handleAssetAdded(
    event: any,
    state: DeepReadonly<PoolState>,
    log: Readonly<Log>,
  ): Promise<DeepReadonly<PoolState> | null> {
    const token: Address = event.args.token.toString().toLowerCase();
    const asset: Address = event.args.asset.toString().toLowerCase();
    if (state.underlyingAddresses.includes(token)) {
      return null;
    }

    const assetState = await this.getAssetState(
      this.poolAddress,
      [asset],
      [token],
      log.blockNumber,
    );
    const poolState = {
      ...state,
      underlyingAddresses: [...state.underlyingAddresses, token],
      asset: {
        ...state.asset,
        [token]: assetState[0],
      },
    };

    const isMainPool =
      Object.values(poolState.asset).filter(
        asset => asset.relativePrice === undefined,
      ).length > 0;
    if (isMainPool) {
      for (const underlyingAddress of poolState.underlyingAddresses) {
        poolState.asset[underlyingAddress] = {
          ...poolState.asset[underlyingAddress],
          relativePrice: undefined,
        };
      }
    }
    return poolState;
  }

  async handleAssetRemoved(
    event: any,
    state: DeepReadonly<PoolState>,
    _log: Readonly<Log>,
  ): Promise<DeepReadonly<PoolState> | null> {
    const token = event.args.token.toString().toLowerCase();
    if (!state.underlyingAddresses.includes(token)) {
      return null;
    }

    const { [token]: _, ...remainingAssets } = state.asset;

    return {
      ...state,
      underlyingAddresses: state.underlyingAddresses.filter(
        underlyingAddress => underlyingAddress !== token,
      ),
      asset: {
        ...remainingAssets,
      },
    };
  }

  async handleFillPool(
    event: any,
    state: DeepReadonly<PoolState>,
    log: Readonly<Log>,
  ): Promise<DeepReadonly<PoolState> | null> {
    const token = event.args.token.toString().toLowerCase();
    if (!state.underlyingAddresses.includes(token)) {
      return null;
    }

    return this.refreshAssetStates(state, [token], log.blockNumber);
  }

  async handlePaused(
    event: any,
    state: DeepReadonly<PoolState>,
    _log: Readonly<Log>,
  ): Promise<DeepReadonly<PoolState> | null> {
    return {
      ...state,
      params: {
        ...state.params,
        paused: true,
      },
    };
  }

  async handleUnpaused(
    event: any,
    state: DeepReadonly<PoolState>,
    _log: Readonly<Log>,
  ): Promise<DeepReadonly<PoolState> | null> {
    return {
      ...state,
      params: {
        ...state.params,
        paused: false,
      },
    };
  }

  async handlePausedAsset(
    event: any,
    state: DeepReadonly<PoolState>,
    _log: Readonly<Log>,
  ): Promise<DeepReadonly<PoolState> | null> {
    const token = event.args.token.toString().toLowerCase();
    if (!state.underlyingAddresses.includes(token)) {
      return null;
    }

    return {
      ...state,
      asset: {
        ...state.asset,
        [token]: {
          ...state.asset[token],
          paused: true,
        },
      },
    };
  }

  async handleUnpausedAsset(
    event: any,
    state: DeepReadonly<PoolState>,
    _log: Readonly<Log>,
  ): Promise<DeepReadonly<PoolState> | null> {
    const token = event.args.token.toString().toLowerCase();
    if (!state.underlyingAddresses.includes(token)) {
      return null;
    }

    return {
      ...state,
      asset: {
        ...state.asset,
        [token]: {
          ...state.asset[token],
          paused: false,
        },
      },
    };
  }

  private async refreshAssetStates(
    state: DeepReadonly<PoolState>,
    tokens: Address[],
    blockNumber: number,
  ): Promise<DeepReadonly<PoolState>> {
    const uniqueTokens = Array.from(
      new Set(
        tokens
          .map(token => token.toLowerCase())
          .filter(token => !!state.asset[token]),
      ),
    );

    if (!uniqueTokens.length) {
      return state;
    }

    const assetAddresses = uniqueTokens.map(
      token => state.asset[token].address,
    );

    const balances = await this.fetchAssetBalances(assetAddresses, blockNumber);

    const updatedAssets = { ...state.asset };
    uniqueTokens.forEach((token, index) => {
      const existingAsset = state.asset[token];
      const { cash, liability, relativePrice } = balances[index];

      updatedAssets[token] = {
        ...existingAsset,
        cash,
        liability,
        relativePrice,
      };
    });

    return {
      ...state,
      asset: updatedAssets,
    };
  }

  private async fetchAssetBalances(
    assets: Address[],
    blockNumber: number,
  ): Promise<{ cash: bigint; liability: bigint; relativePrice?: bigint }[]> {
    const multiCallInputs: MultiCallInput[] = [];
    const methods = ['cash', 'liability', 'getRelativePrice'] as const;

    for (const asset of assets) {
      for (const method of methods) {
        multiCallInputs.push({
          target: asset,
          callData: WombatPool.assetInterface.encodeFunctionData(method),
        });
      }
    }

    const returnData = await this.dexHelper.multiContract.methods
      .tryAggregate(false, multiCallInputs)
      .call({}, blockNumber);

    const balances: {
      cash: bigint;
      liability: bigint;
      relativePrice?: bigint;
    }[] = [];

    for (let i = 0; i < assets.length * methods.length; i += methods.length) {
      const cash = returnData[i].success
        ? BigInt(
            WombatPool.assetInterface.decodeFunctionResult(
              'cash',
              returnData[i].returnData,
            )[0],
          )
        : 0n;
      const liability = returnData[i + 1].success
        ? BigInt(
            WombatPool.assetInterface.decodeFunctionResult(
              'liability',
              returnData[i + 1].returnData,
            )[0],
          )
        : 0n;
      const relativePrice = returnData[i + 2].success
        ? BigInt(
            WombatPool.assetInterface.decodeFunctionResult(
              'getRelativePrice',
              returnData[i + 2].returnData,
            )[0],
          )
        : undefined;

      balances.push({ cash, liability, relativePrice });
    }

    return balances;
  }

  private async getAssetState(
    pool: Address,
    assets: Address[],
    tokens: Address[],
    blockNumber: number,
  ): Promise<AssetState[]> {
    const assetStates: AssetState[] = [];
    const multiCallInputs: MultiCallInput[] = [];

    const methods = [
      'cash',
      'liability',
      'underlyingTokenDecimals',
      'getRelativePrice',
    ];

    for (let i = 0; i < assets.length; i++) {
      const asset = assets[i];
      const token = tokens[i];

      multiCallInputs.push({
        target: pool,
        callData: this.poolInterface.encodeFunctionData('isPaused', [token]),
      });

      for (const method of methods) {
        multiCallInputs.push({
          target: asset,
          callData: WombatPool.assetInterface.encodeFunctionData(method),
        });
      }
    }

    const returnData = await this.dexHelper.multiContract.methods
      .tryAggregate(false, multiCallInputs)
      .call({}, blockNumber);

    for (
      let i = 0;
      i < assets.length * (methods.length + 1);
      i += methods.length + 1
    ) {
      const paused = returnData[i].success
        ? Boolean(
            this.poolInterface.decodeFunctionResult(
              'isPaused',
              returnData[i].returnData,
            )[0],
          )
        : false;
      const cash = BigInt(
        WombatPool.assetInterface.decodeFunctionResult(
          methods[0],
          returnData[i + 1].returnData,
        )[0],
      );
      const liability = BigInt(
        WombatPool.assetInterface.decodeFunctionResult(
          methods[1],
          returnData[i + 2].returnData,
        )[0],
      );
      const underlyingTokenDecimals =
        WombatPool.assetInterface.decodeFunctionResult(
          methods[2],
          returnData[i + 3].returnData,
        )[0];

      let relativePrice: bigint | undefined;
      if (returnData[i + 4].success) {
        relativePrice = BigInt(
          WombatPool.assetInterface.decodeFunctionResult(
            methods[3],
            returnData[i + 4].returnData,
          )[0],
        );
      }

      assetStates.push({
        address: assets[i / (methods.length + 1)],
        paused,
        cash,
        liability,
        underlyingTokenDecimals,
        relativePrice,
      });
    }

    return assetStates;
  }
}

import _ from 'lodash';
import { Interface } from '@ethersproject/abi';
import { parseBytes32String } from '@ethersproject/strings';
import { DeepReadonly } from 'ts-essentials';
import { Log, Logger } from '../../types';
import { catchParseLogError } from '../../utils';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { PoolState, PoolStateMap, Step, TokenInfo } from './types';
import { getPoolsApi } from './getPoolsApi';
import vaultExtensionAbi_V3 from '../../abi/balancer-v3/vault-extension.json';
import {
  decodeErc4626MultiCallData,
  decodeThrowError,
  getErc4626MultiCallData,
  getOnChainState,
} from './getOnChainState';
import { BalancerV3Config } from './config';
import { SwapKind, Vault } from '@balancer-labs/balancer-maths';
import {
  ampUpdateStartedEvent,
  ampUpdateStoppedEvent,
  getAmplificationParameter,
  isStableMutableState,
} from './stablePool';
import { BI_POWS } from '../../bigint-constants';
import {
  HookStateMap,
  HooksConfigMap,
} from './hooks/balancer-hook-event-subscriber';
import { StableSurge, StableSurgeHookState } from './hooks/stableSurgeHook';
import {
  isQuantAMMPoolState,
  QauntAMMPoolState,
  updateLatestQuantAMMState,
  updateQuantAMMPoolState,
} from './quantAMMPool';
import { combineInterfaces } from './utils';
import { isAkronPoolState } from './hooks/akronHook';
import {
  centerednessMarginUpdatedEvent,
  isReClammPool,
  lastTimestampUpdatedEvent,
  priceRatioStateUpdatedEvent,
  dailyPriceShiftExponentUpdatedEvent,
  ReClammPoolState,
  virtualBalancesUpdatedEvent,
} from './reClammPool';

export const WAD = BI_POWS[18];
const FEE_SCALING_FACTOR = BI_POWS[11];

export class BalancerV3EventPool extends StatefulEventSubscriber<PoolStateMap> {
  handlers: {
    [event: string]: (
      event: any,
      state: DeepReadonly<PoolStateMap>,
      log: Readonly<Log>,
    ) => DeepReadonly<PoolStateMap> | null;
  } = {};

  logDecoder: (log: Log) => any;

  addressesSubscribed: string[];

  interfaces: {
    [name: string]: Interface;
  };
  vault: Vault;
  hooksConfigMap: HooksConfigMap = {};

  constructor(
    readonly parentName: string,
    protected network: number,
    protected dexHelper: IDexHelper,
    logger: Logger,
  ) {
    super(
      parentName,
      BalancerV3Config.BalancerV3[network].vaultAddress,
      dexHelper,
      logger,
    );

    this.interfaces = {
      ['VAULT']: new Interface(vaultExtensionAbi_V3),
      ['STABLE']: new Interface([
        'function getAmplificationParameter() external view returns (uint256 value, bool isUpdating, uint256 precision)',
        'function getAmplificationState() external view returns (tuple(uint64 startValue, uint64 endValue, uint32 startTime, uint32 endTime) amplificationState, uint256 precision)',
      ]),
      ['ERC4626']: new Interface([
        'function convertToAssets(uint256 shares) external view returns (uint256 assets)',
        'function maxDeposit(address receiver) external view returns (uint256 maxAssets)',
        'function maxMint(address receiver) external view returns (uint256 maxShares)',
      ]),
      ['QUANT_AMM_WEIGHTED']: new Interface([
        'function getQuantAMMWeightedPoolDynamicData() external view returns (tuple(uint256[] balancesLiveScaled18, uint256[] tokenRates, uint256 totalSupply, bool isPoolInitialized, bool isPoolPaused, bool isPoolInRecoveryMode, int256[] firstFourWeightsAndMultipliers, int256[] secondFourWeightsAndMultipliers, uint40 lastUpdateTime, uint40 lastInteropTime) data)',
        'function getQuantAMMWeightedPoolImmutableData() external view returns (tuple(address[] tokens, uint256 oracleStalenessThreshold, uint256 poolRegistry, int256[][] ruleParameters, uint64[] lambda, uint64 epsilonMax, uint64 absoluteWeightGuardRail, uint64 updateInterval, uint256 maxTradeSizeRatio) data)',
      ]),
      ['QUANT_UPDATEWEIGHTRUNNER']: new Interface([
        'event WeightsUpdated(address indexed poolAddress, address updateOwner, int256[] weights, uint40 lastInterpolationTimePossible, uint40 lastUpdateTime)',
      ]),
      ['RECLAMM']: new Interface([
        'function getReClammPoolDynamicData() external view returns (tuple(uint256[] balancesLiveScaled18, uint256[] tokenRates, uint256 staticSwapFeePercentage, uint256 totalSupply, uint256 lastTimestamp, uint256[] lastVirtualBalances, uint256 dailyPriceShiftExponent, uint256 dailyPriceShiftBase, uint256 centerednessMargin, uint256 currentPriceRatio, uint256 currentFourthRootPriceRatio, uint256 startFourthRootPriceRatio, uint256 endFourthRootPriceRatio, uint32 priceRatioUpdateStartTime, uint32 priceRatioUpdateEndTime, bool isPoolInitialized, bool isPoolPaused, bool isPoolInRecoveryMode) data)',
      ]),
      ['RECLAMM_V2']: new Interface([
        'function getReClammPoolDynamicData() external view returns (tuple(uint256[] balancesLiveScaled18, uint256[] tokenRates, uint256 staticSwapFeePercentage, uint256 totalSupply, uint256 lastTimestamp, uint256[] lastVirtualBalances, uint256 dailyPriceShiftExponent, uint256 dailyPriceShiftBase, uint256 centerednessMargin, uint256 currentPriceRatio, uint256 currentFourthRootPriceRatio, uint256 startFourthRootPriceRatio, uint256 endFourthRootPriceRatio, uint32 priceRatioUpdateStartTime, uint32 priceRatioUpdateEndTime, bool isPoolInitialized, bool isPoolPaused, bool isPoolInRecoveryMode) data)',
      ]),
    };

    this.logDecoder = (log: Log) =>
      combineInterfaces([
        this.interfaces['VAULT'],
        this.interfaces['QUANT_UPDATEWEIGHTRUNNER'],
      ]).parseLog(log);
    this.addressesSubscribed = [
      BalancerV3Config.BalancerV3[network].vaultAddress,
      // QuantWeightRunner will emit events for Weight changes on any pool
      BalancerV3Config.BalancerV3[network].quantAmmUpdateWeightRunnerAddress!,
    ];

    // Add handlers
    this.handlers['LiquidityAdded'] = this.liquidityAddedEvent.bind(this);
    this.handlers['LiquidityRemoved'] = this.liquidityRemovedEvent.bind(this);
    this.handlers['Swap'] = this.swapEvent.bind(this);
    this.handlers['VaultAuxiliary'] = this.vaultAuxiliaryEvent.bind(this);
    this.handlers['AggregateSwapFeePercentageChanged'] =
      this.poolAggregateSwapFeePercentageEvent.bind(this);
    this.handlers['SwapFeePercentageChanged'] =
      this.poolSwapFeePercentageChangedEvent.bind(this);
    this.handlers['PoolPausedStateChanged'] =
      this.poolPausedStateChanged.bind(this);
    this.handlers['WeightsUpdated'] = this.quantWeightsUpdatedEvent.bind(this);

    // replicates V3 maths with fees, pool and hook logic
    this.vault = new Vault();
  }

  setHooksConfigMap(hooksConfigMap: HooksConfigMap) {
    this.hooksConfigMap = hooksConfigMap;
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
    state: DeepReadonly<PoolStateMap>,
    log: Readonly<Log>,
  ): DeepReadonly<PoolStateMap> | null {
    try {
      const event = this.logDecoder(log);
      if (event.name in this.handlers) {
        return this.handlers[event.name](event, state, log);
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
  async generateState(
    blockNumber: number,
  ): Promise<DeepReadonly<PoolStateMap>> {
    const block = await this.dexHelper.provider.getBlock(blockNumber);
    const apiPoolStateMap = await getPoolsApi(
      this.network,
      this.hooksConfigMap,
      block.timestamp,
    );
    const allOnChainPools = await getOnChainState(
      this.network,
      apiPoolStateMap,
      this.dexHelper,
      this.interfaces,
      blockNumber,
    );

    // Filter out all paused pools
    const filteredPools = Object.entries(allOnChainPools)
      .filter(([address, pool]) => {
        return !pool.isPoolPaused;
      })
      .reduce((acc, [address, pool]) => {
        acc[address] = pool;
        return acc;
      }, {} as PoolStateMap);

    return filteredPools;
  }

  async getUpdatedPoolState(
    blockNumber: number,
  ): Promise<DeepReadonly<PoolStateMap> | null> {
    // Get all latest pools from API
    const apiPoolStateMap = await getPoolsApi(
      this.network,
      this.hooksConfigMap,
    );

    // Get on-chain state for all pools to ensure correct state
    const latestOnChainPools = await getOnChainState(
      this.network,
      apiPoolStateMap,
      this.dexHelper,
      this.interfaces,
      blockNumber,
    );

    return latestOnChainPools;
  }

  liquidityAddedEvent(
    event: any,
    state: DeepReadonly<PoolStateMap>,
    log: Readonly<Log>,
  ): DeepReadonly<PoolStateMap> | null {
    const poolAddress = event.args.pool.toLowerCase();
    // Vault will send events from all pools, some of which are not officially supported by Balancer
    if (!state[poolAddress]) {
      return null;
    }
    const newState = _.cloneDeep(state) as PoolStateMap;
    for (
      let i = 0;
      i < newState[poolAddress].balancesLiveScaled18.length;
      i++
    ) {
      const totalSwapFeeAmountRaw = BigInt(event.args.swapFeeAmountsRaw[i]);
      const aggregateSwapFeeAmountRaw = this.mulDown(
        totalSwapFeeAmountRaw,
        newState[poolAddress].aggregateSwapFee,
      );
      newState[poolAddress].balancesLiveScaled18[i] +=
        this.toScaled18ApplyRateRoundDown(
          BigInt(event.args.amountsAddedRaw[i]) - aggregateSwapFeeAmountRaw,
          newState[poolAddress].scalingFactors[i],
          newState[poolAddress].tokenRates[i] || WAD,
        );
    }
    newState[poolAddress].totalSupply = BigInt(event.args.totalSupply);

    return newState;
  }

  liquidityRemovedEvent(
    event: any,
    state: DeepReadonly<PoolStateMap>,
    log: Readonly<Log>,
  ): DeepReadonly<PoolStateMap> | null {
    const poolAddress = event.args.pool.toLowerCase();
    // Vault will send events from all pools, some of which are not officially supported by Balancer
    if (!state[poolAddress]) {
      return null;
    }
    const newState = _.cloneDeep(state) as PoolStateMap;
    for (
      let i = 0;
      i < newState[poolAddress].balancesLiveScaled18.length;
      i++
    ) {
      const totalSwapFeeAmountRaw = BigInt(event.args.swapFeeAmountsRaw[i]);
      const aggregateSwapFeeAmountRaw = this.mulDown(
        totalSwapFeeAmountRaw,
        newState[poolAddress].aggregateSwapFee,
      );
      newState[poolAddress].balancesLiveScaled18[i] -=
        this.toScaled18ApplyRateRoundDown(
          BigInt(event.args.amountsRemovedRaw[i]) + aggregateSwapFeeAmountRaw,
          newState[poolAddress].scalingFactors[i],
          newState[poolAddress].tokenRates[i] || WAD,
        );
    }
    newState[poolAddress].totalSupply = BigInt(event.args.totalSupply);

    return newState;
  }

  swapEvent(
    event: any,
    state: DeepReadonly<PoolStateMap>,
    log: Readonly<Log>,
  ): DeepReadonly<PoolStateMap> | null {
    const poolAddress = event.args.pool.toLowerCase();
    // Vault will send events from all pools, some of which are not officially supported by Balancer
    if (!state[poolAddress]) {
      return null;
    }
    const newState = _.cloneDeep(state) as PoolStateMap;
    const tokenInIndex = newState[poolAddress].tokens.findIndex(
      address => address.toLowerCase() === event.args.tokenIn.toLowerCase(),
    );
    const tokenOutIndex = newState[poolAddress].tokens.findIndex(
      address => address.toLowerCase() === event.args.tokenOut.toLowerCase(),
    );
    if (tokenInIndex === -1 || tokenOutIndex === -1) {
      this.logger.error(`swapEvent - token index not found in pool state`);
      return null;
    }
    const totalSwapFeeAmountRaw = BigInt(event.args.swapFeeAmount);
    const aggregateSwapFeeAmountRaw = this.mulDown(
      totalSwapFeeAmountRaw,
      newState[poolAddress].aggregateSwapFee,
    );
    newState[poolAddress].balancesLiveScaled18[tokenInIndex] +=
      this.toScaled18ApplyRateRoundDown(
        BigInt(event.args.amountIn) - aggregateSwapFeeAmountRaw,
        newState[poolAddress].scalingFactors[tokenInIndex],
        newState[poolAddress].tokenRates[tokenInIndex] || WAD,
      );
    newState[poolAddress].balancesLiveScaled18[tokenOutIndex] -=
      this.toScaled18ApplyRateRoundDown(
        BigInt(event.args.amountOut),
        newState[poolAddress].scalingFactors[tokenOutIndex],
        newState[poolAddress].tokenRates[tokenOutIndex] || WAD,
      );

    return newState;
  }

  vaultAuxiliaryEvent(
    event: any,
    state: DeepReadonly<PoolStateMap>,
    log: Readonly<Log>,
  ): DeepReadonly<PoolStateMap> | null {
    // In SC Pools can use this event to emit event data from the Vault.
    // Allows us to track pool specific events using only the Vault subscription.
    // https://github.com/balancer/balancer-v3-monorepo/blob/main/pkg/interfaces/contracts/vault/IVaultExtension.sol
    const poolAddress = event.args.pool.toLowerCase();
    // Vault will send events from all pools, some of which are not officially supported by Balancer
    if (!state[poolAddress]) {
      return null;
    }

    // Convert bytes32 eventKey to string
    const eventKeyString = parseBytes32String(event.args.eventKey);

    const newState = _.cloneDeep(state) as PoolStateMap;
    switch (eventKeyString) {
      case 'AmpUpdateStarted':
        ampUpdateStartedEvent(newState[poolAddress], event.args.eventData);
        return newState;
      case 'AmpUpdateStopped':
        ampUpdateStoppedEvent(newState[poolAddress], event.args.eventData);
        return newState;
      case 'LastTimestampUpdated':
        lastTimestampUpdatedEvent(newState[poolAddress], event.args.eventData);
        return newState;
      case 'PriceRatioStateUpdated':
        priceRatioStateUpdatedEvent(
          newState[poolAddress],
          event.args.eventData,
        );
        return newState;
      case 'DailyPriceShiftExponentUpdated':
        dailyPriceShiftExponentUpdatedEvent(
          newState[poolAddress],
          event.args.eventData,
        );
        return newState;
      case 'CenterednessMarginUpdated':
        centerednessMarginUpdatedEvent(
          newState[poolAddress],
          event.args.eventData,
        );
        return newState;
      case 'VirtualBalancesUpdated':
        virtualBalancesUpdatedEvent(
          newState[poolAddress],
          event.args.eventData,
        );
        return newState;
      default:
        return null;
    }
  }

  poolAggregateSwapFeePercentageEvent(
    event: any,
    state: DeepReadonly<PoolStateMap>,
    log: Readonly<Log>,
  ): DeepReadonly<PoolStateMap> | null {
    const poolAddress = event.args.pool.toLowerCase();
    // Vault will send events from all pools, some of which are not officially supported by Balancer
    if (!state[poolAddress]) {
      return null;
    }
    const newState = _.cloneDeep(state) as PoolStateMap;
    newState[poolAddress].aggregateSwapFee = BigInt(
      event.args.aggregateSwapFeePercentage,
    );
    return newState;
  }

  poolSwapFeePercentageChangedEvent(
    event: any,
    state: DeepReadonly<PoolStateMap>,
    log: Readonly<Log>,
  ): DeepReadonly<PoolStateMap> | null {
    const poolAddress = event.args.pool.toLowerCase();
    // Vault will send events from all pools, some of which are not officially supported by Balancer
    if (!state[poolAddress]) {
      return null;
    }
    const newState = _.cloneDeep(state) as PoolStateMap;
    // The contract is truncating the value before storing and will have a min step of 0.0000001% (effectively 5 decimal places of precision)
    // See: https://github.com/balancer/balancer-v3-monorepo/blob/2f8cf5c78adef2a8b35beae0c90b590eb9f4f865/pkg/interfaces/contracts/vault/VaultTypes.sol#L436
    const value = BigInt(event.args.swapFeePercentage);
    newState[poolAddress].swapFee =
      (value / FEE_SCALING_FACTOR) * FEE_SCALING_FACTOR;
    return newState;
  }

  poolPausedStateChanged(
    event: any,
    state: DeepReadonly<PoolStateMap>,
    log: Readonly<Log>,
  ): DeepReadonly<PoolStateMap> | null {
    // Unpaused pools will be added with correct state during updateStatePools
    if (event.args.paused === false) return null;
    const poolAddress = event.args.pool.toLowerCase();
    // Vault will send events from all pools, some of which are not officially supported by Balancer
    if (!state[poolAddress]) {
      return null;
    }
    // Remove paused pool from state as it can't be swapped against
    const newState = _.cloneDeep(state) as PoolStateMap;
    delete newState[poolAddress];
    return newState;
  }

  quantWeightsUpdatedEvent(
    event: any,
    state: DeepReadonly<PoolStateMap>,
    log: Readonly<Log>,
  ): DeepReadonly<PoolStateMap> | null {
    const poolAddress = event.args.poolAddress.toLowerCase();
    // Check if the pool exists in our state
    if (!state[poolAddress]) {
      return null;
    }

    // Create a new state with the updated weights
    const newState = _.cloneDeep(state) as PoolStateMap;

    // Update the pool's weights and timestamps
    if (isQuantAMMPoolState(newState[poolAddress]))
      updateQuantAMMPoolState(
        newState[poolAddress] as QauntAMMPoolState,
        event.args.weights,
        event.args.lastUpdateTime,
        event.args.lastInterpolationTimePossible,
      );

    return newState;
  }

  getMaxSwapAmount(
    pool: PoolState,
    tokenIn: TokenInfo,
    tokenOut: TokenInfo,
    swapKind: SwapKind,
    timestamp: number,
  ): bigint {
    // Find the maximum swap amount the pool will support

    // Update ReClamm pool state with latest block timestamp
    if (isReClammPool(pool)) {
      (pool as ReClammPoolState).currentTimestamp = BigInt(timestamp);
    }

    const maxSwapAmount = this.vault.getMaxSwapAmount(
      {
        swapKind,
        balancesLiveScaled18: pool.balancesLiveScaled18,
        tokenRates: pool.tokenRates,
        scalingFactors: pool.scalingFactors,
        indexIn: tokenIn.index,
        indexOut: tokenOut.index,
      },
      pool,
    );
    return maxSwapAmount;
  }

  getSwapResult(
    steps: Step[],
    amountRaw: bigint,
    swapKind: SwapKind,
    timestamp: number,
    hookStateMap: HookStateMap,
  ): bigint {
    if (amountRaw === 0n) return 0n;

    // A GivenOut needs to use steps in reverse during calculation
    const indices =
      swapKind === SwapKind.GivenIn
        ? steps.keys()
        : Array.from(steps.keys()).reverse();

    let amount = amountRaw;
    let outputAmountRaw = 0n;
    for (const i of indices) {
      const step = steps[i];

      // If the pool has a hook we fetch latest hook state for use in maths
      let hookState = undefined;
      if ('hookAddress' in step.poolState && step.poolState.hookAddress) {
        hookState = hookStateMap[step.poolState.hookAddress];
        if (!hookState) {
          this.logger.error(
            `getSwapResult hookState not found ${step.poolState.hookAddress}`,
          );
          return 0n;
        }
      }

      // If its a Stable Pool with an updating Amp factor calculate current Amp value
      if (
        step.poolState.poolType === 'STABLE' &&
        isStableMutableState(step.poolState)
      ) {
        if (step.poolState.ampIsUpdating) {
          step.poolState.amp = getAmplificationParameter(
            step.poolState.ampStartValue,
            step.poolState.ampEndValue,
            step.poolState.ampStartTime,
            step.poolState.ampStopTime,
            BigInt(timestamp),
          );
        }
        // StableSurge hook uses Amp as part of maths
        if (step.poolState.hookType === StableSurge.type && hookState) {
          const poolHookState = (hookState as StableSurgeHookState)[
            step.poolState.poolAddress.toLowerCase()
          ];
          if (!poolHookState) {
            this.logger.error(
              `getSwapResult StableSurge hookState not found ${step.poolState.hookAddress}`,
            );
            return 0n;
          }
          hookState = {
            ...poolHookState,
            amp: step.poolState.amp,
          };
        }
      }

      // Update QuantAMM pool state with latest timestamp
      if (isQuantAMMPoolState(step.poolState))
        updateLatestQuantAMMState(
          step.poolState as QauntAMMPoolState,
          BigInt(timestamp),
        );
      // if weighted and akron then update hookState similar to above
      if (isAkronPoolState(step.poolState)) {
        hookState = {
          weights: step.poolState.weights,
          minimumSwapFeePercentage: step.poolState.swapFee,
        };
      }
      // Update ReClamm pool state with latest block timestamp
      if (isReClammPool(step.poolState)) {
        (step.poolState as ReClammPoolState).currentTimestamp =
          BigInt(timestamp);
      }

      // try/catch as the swap can fail for e.g. wrapAmountTooSmall, etc
      try {
        outputAmountRaw = this.vault.swap(
          {
            ...step.swapInput,
            amountRaw: amount,
            swapKind,
          },
          step.poolState,
          hookState,
        );
      } catch (err) {
        outputAmountRaw = 0n;
      }
      // Next step uses output from previous step as input
      amount = outputAmountRaw;
    }
    return outputAmountRaw;
  }

  /**
   * Retrieves any new pools via API/multicall and adds to state
   */
  async updateStatePools(): Promise<void> {
    const blockNumber = await this.dexHelper.provider.getBlockNumber();
    const updatedPoolState = await this.getUpdatedPoolState(blockNumber);
    if (updatedPoolState) this.setState(updatedPoolState, blockNumber);
  }

  /**
   * Uses multicall to get onchain token rate for each pool then updates pool state
   */
  async updateStatePoolRates(): Promise<void> {
    // Get existing state
    const poolState = _.cloneDeep(this.getStaleState()) as PoolStateMap;
    if (!poolState) return;

    // Fetch onchain pool rates
    const poolRates = await this.getPoolRates(poolState);

    // Update each pools rate
    poolRates.forEach(
      (
        {
          poolAddress,
          tokenRates,
          erc4626Rates,
          erc4626MaxDeposit,
          erc4626MaxMint,
        },
        i,
      ) => {
        poolState[poolAddress].tokenRates = tokenRates;
        poolState[poolAddress].erc4626Rates = erc4626Rates;
        poolState[poolAddress].erc4626MaxDeposit = erc4626MaxDeposit;
        poolState[poolAddress].erc4626MaxMint = erc4626MaxMint;
      },
    );

    // Update state
    const blockNumber = await this.dexHelper.provider.getBlockNumber();
    this.setState(poolState, blockNumber);
  }

  private async getPoolRates(poolState: PoolStateMap) {
    const erc4626MultiCallData = getErc4626MultiCallData(
      this.interfaces['ERC4626'],
      poolState,
    );

    const poolAddresses = Object.keys(poolState);
    // For each pool make the getPoolTokenRates call
    const poolsMultiCallData = poolAddresses.map(address => {
      return {
        target: BalancerV3Config.BalancerV3[this.network].vaultAddress,
        callData: this.interfaces['VAULT'].encodeFunctionData(
          'getPoolTokenRates',
          [address],
        ),
      };
    });
    // 500 is an arbitrary number chosen based on the blockGasLimit
    const slicedMultiCallData = _.chunk(
      [...erc4626MultiCallData, ...poolsMultiCallData],
      500,
    );

    // Make the multicall
    const multicallDataResult = (
      await Promise.all(
        slicedMultiCallData.map(async _multiCallData =>
          this.dexHelper.multiContract.methods
            .tryAggregate(false, _multiCallData)
            .call({}),
        ),
      )
    ).flat();

    const dataResultErc4626 = multicallDataResult.slice(
      0,
      erc4626MultiCallData.length,
    );
    const dataResultPools = multicallDataResult.slice(
      erc4626MultiCallData.length,
    );

    const tokensWithRates = decodeErc4626MultiCallData(
      this.interfaces['ERC4626'],
      erc4626MultiCallData,
      dataResultErc4626,
    );

    return poolAddresses.map((address, i) => {
      const tokenRateResult = decodeThrowError(
        this.interfaces['VAULT'],
        'getPoolTokenRates',
        dataResultPools[i],
        address,
      );
      return {
        poolAddress: address,
        tokenRates: tokenRateResult.tokenRates.map((r: string) => BigInt(r)),
        erc4626Rates: poolState[address].tokens.map(t => {
          if (!tokensWithRates[t]) return null;
          return tokensWithRates[t].rate;
        }),
        erc4626MaxDeposit: poolState[address].tokens.map(t => {
          if (!tokensWithRates[t]) return null;
          return tokensWithRates[t].maxDeposit;
        }),
        erc4626MaxMint: poolState[address].tokens.map(t => {
          if (!tokensWithRates[t]) return null;
          return tokensWithRates[t].maxMint;
        }),
      };
    });
  }

  // If a token is "boosted" it can be auto wrapped/unwrapped by Vault, e.g. aDAI<>DAI
  // mainToken is the actual token the pool would contain, e.g. in a bbausd type setup it would be aDAI/aUSDC/aUSDT
  // underlyingToken would be the unwrapped, e.g. DAI/USDC/USDT
  // need rate info to calculate wrap/unwrap
  getTokenInfo(poolState: PoolState, tokenAddress: string): TokenInfo | null {
    // Check in main tokens
    let tokenIndex = poolState.tokens.findIndex(
      address => address.toLowerCase() === tokenAddress.toLowerCase(),
    );
    if (tokenIndex !== -1) {
      return {
        isBoosted: false,
        mainToken: tokenAddress,
        underlyingToken: null,
        index: tokenIndex,
        rate: poolState.tokenRates[tokenIndex],
        maxDeposit: 0n, // N/A As non-erc4626
        maxMint: 0n,
      };
    }

    // Check in underlying tokens if available
    if (poolState.tokensUnderlying) {
      tokenIndex = poolState.tokensUnderlying.findIndex(
        address =>
          address && address.toLowerCase() === tokenAddress.toLowerCase(),
      );
      if (tokenIndex !== -1) {
        if (poolState.erc4626Rates[tokenIndex] === null) {
          this.logger.error(
            `missing erc4626 token rate ${poolState.tokens[tokenIndex]}`,
          );
          return null;
        }
        return {
          isBoosted: true,
          mainToken: poolState.tokens[tokenIndex],
          underlyingToken: tokenAddress,
          index: tokenIndex,
          rate: poolState.erc4626Rates[tokenIndex]!,
          maxDeposit: poolState.erc4626MaxDeposit[tokenIndex]!,
          maxMint: poolState.erc4626MaxMint[tokenIndex]!,
        };
      }
    }

    // Token not found
    this.logger.error(`getTokenInfo token not found`);
    return null;
  }

  /**
   * Prepares all the step data required to simulate maths and construct swap transaction.
   * Balancer V3 has the concepts of Boosted Pools and ERC4626 Liquidity Buffers.
   * These enable highly capital efficient pools and gas efficient swaps.
   * To swap via a buffer we must provide the correct ""steps" to the router transaction.
   * Wrap: e.g. USDC>aUSDC
   * Unwrap: e.g. aUSDC>USDC
   * A full swap between USDC>DAI for an example bbausd pool consisting of aDAI/aUSDC/aUSDT would look like:
   * USDC[wrap-buffer]aUSDC[swap-pool]aDAI[unwrap-buffer]USDC
   * See docs for further info:
   * https://docs-v3.balancer.fi/concepts/explore-available-balancer-pools/boosted-pool.html
   * https://docs-v3.balancer.fi/concepts/vault/buffer.html
   */
  getSteps(pool: PoolState, tokenIn: TokenInfo, tokenOut: TokenInfo): Step[] {
    if (tokenIn.isBoosted && tokenOut.isBoosted) {
      return [
        // Wrap tokenIn underlying to main token
        this.getWrapStep(tokenIn),
        // Swap main > main
        this.getSwapStep(pool, tokenIn, tokenOut),
        // Unwrap tokenOut main to underlying token
        this.getUnwrapStep(tokenOut),
      ];
    } else if (tokenIn.isBoosted) {
      if (
        tokenIn.mainToken.toLowerCase() === tokenOut.mainToken.toLowerCase()
      ) {
        // wrap, token > erc4626
        // tokenIn is boosted, e.g. isn't pool token and must be wrapped
        return [this.getWrapStep(tokenIn)];
      }
      return [
        // Wrap tokenIn underlying to main token
        this.getWrapStep(tokenIn),
        // Swap main > main
        this.getSwapStep(pool, tokenIn, tokenOut),
      ];
    } else if (tokenOut.isBoosted) {
      if (
        tokenIn.mainToken.toLowerCase() === tokenOut.mainToken.toLowerCase()
      ) {
        // unwrap, stata > token
        // token out is boosted, e.g. isn't pool token
        return [this.getUnwrapStep(tokenOut)];
      }
      return [
        // Swap main > main
        this.getSwapStep(pool, tokenIn, tokenOut),
        // Unwrap tokenOut main to underlying token
        this.getUnwrapStep(tokenOut),
      ];
    } else {
      return [
        // Swap main > main
        this.getSwapStep(pool, tokenIn, tokenOut),
      ];
    }
  }

  getWrapStep(token: TokenInfo): Step {
    if (!token.underlyingToken)
      throw new Error(
        `Buffer wrap: token has no underlying. ${token.mainToken}`,
      );
    // Vault expects pool to be the ERC4626 wrapped token, e.g. aUSDC
    return {
      pool: token.mainToken,
      isBuffer: true,
      swapInput: {
        tokenIn: token.underlyingToken,
        tokenOut: token.mainToken,
      },
      poolState: {
        poolType: 'Buffer',
        rate: token.rate,
        poolAddress: token.mainToken,
        tokens: [token.mainToken, token.underlyingToken], // staticToken & underlying
        maxDeposit: token.maxDeposit,
        maxMint: token.maxMint,
      },
    };
  }

  getUnwrapStep(token: TokenInfo): Step {
    if (!token.underlyingToken)
      throw new Error(
        `Buffer unwrap: token has no underlying. ${token.mainToken}`,
      );
    // Vault expects pool to be the ERC4626 wrapped token, e.g. aUSDC
    return {
      pool: token.mainToken,
      isBuffer: true,
      swapInput: {
        tokenIn: token.mainToken,
        tokenOut: token.underlyingToken,
      },
      poolState: {
        poolType: 'Buffer',
        // TODO: for ERC4626 fetch the wrap/unwrap rate
        rate: token.rate,
        poolAddress: token.mainToken,
        tokens: [token.mainToken, token.underlyingToken], // staticToken & underlying
        maxDeposit: token.maxDeposit,
        maxMint: token.maxMint,
      },
    };
  }

  getSwapStep(pool: PoolState, tokenIn: TokenInfo, tokenOut: TokenInfo): Step {
    // A normal swap between two tokens in a pool
    return {
      pool: pool.poolAddress,
      isBuffer: false,
      swapInput: {
        tokenIn: tokenIn.mainToken,
        tokenOut: tokenOut.mainToken,
      },
      poolState: pool,
    };
  }

  toScaled18(amount: bigint, scalingFactor: bigint): bigint {
    // (amount * scalingFactor).mulUp(tokenRate);
    return (amount * scalingFactor * WAD) / WAD;
  }

  toScaled18ApplyRateRoundDown(
    amount: bigint,
    scalingFactor: bigint,
    tokenRate: bigint,
  ): bigint {
    return this.mulDown(amount * scalingFactor, tokenRate);
  }

  mulDown(a: bigint, b: bigint): bigint {
    return (a * b) / WAD;
  }
}

import { Interface } from '@ethersproject/abi';
import { AsyncOrSync, DeepReadonly } from 'ts-essentials';
import { BlockHeader, Log, Logger } from '../../types';
import { bigIntify, catchParseLogError } from '../../utils';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { IDexHelper } from '../../dex-helper/idex-helper';
import {
  DepositParams,
  DexParams,
  PoolState,
  ProtocolState,
  SwapParams,
  VaultState,
  WithdrawParams,
} from './types';
import { BunniV2Config } from './config';
import { getPools, getProtocolState, initializePoolState } from './utils';
import _ from 'lodash';
import { deposit, withdraw } from './logic/BunniHubLogic';
import {
  generateOnChainState,
  updateCuratorFees,
  updatePoolTotalValueLocked,
  updateStateAfterDeposit,
  updateStateAfterNewBunni,
  updateStateAfterOrderFulfilled,
  updateStateAfterSwap,
  updateStateAfterWithdraw,
  updateVaultSharePrices,
} from './getOnChainState';
import { afterInitialize, beforeSwap } from './logic/BunniHookLogic';

import BunniHubABI from '../../abi/bunni-v2/BunniHub.abi.json';
import BunniHookABI from '../../abi/bunni-v2/BunniHook.abi.json';
import BunniTokenABI from '../../abi/bunni-v2/BunniToken.abi.json';
import FeeOverrideHookletABI from '../../abi/bunni-v2/FeeOverrideHooklet.abi.json';
import FloodPlainABI from '../../abi/bunni-v2/FloodPlain.abi.json';
import PoolManagerABI from '../../abi/bunni-v2/PoolManager.abi.json';

import { TickMath } from './lib/TickMath';
import { _updateAmAmmWrite } from './logic/AmAmm';
import { WAD, ZERO_BYTES_32 } from './lib/Constants';
import { NULL_ADDRESS } from '../../constants';
import { quoteSwap } from './logic/BunniQuoter';

export class BunniV2EventPool extends StatefulEventSubscriber<ProtocolState> {
  handlers: {
    [event: string]: (
      event: any,
      state: DeepReadonly<ProtocolState>,
      log: Readonly<Log>,
      blockHeader: BlockHeader,
    ) => AsyncOrSync<DeepReadonly<ProtocolState> | null>;
  } = {};

  ids: { [address: string]: string };
  interfaces: { [name: string]: Interface };
  logDecoders: { [name: string]: (log: Log) => any };
  addressesSubscribed: string[];
  config: DexParams;

  constructor(
    readonly parentName: string,
    protected network: number,
    protected dexHelper: IDexHelper,
    logger: Logger,
  ) {
    super(
      parentName,
      BunniV2Config.BunniV2[network].poolManager,
      dexHelper,
      logger,
    );

    this.config = BunniV2Config.BunniV2[network];

    this.ids = {
      [this.config.poolManager]: 'POOL_MANAGER',
      [this.config.bunniHub]: 'BUNNI_HUB',
      [this.config.bunniHook.address]: 'BUNNI_HOOK',
      [this.config.floodPlain]: 'FLOOD_PLAIN',
      ...Object.fromEntries(
        Object.keys(this.config.hooklets).map(hooklet => [
          hooklet,
          'FEE_OVERRIDE_HOOKLET',
        ]),
      ),
    };

    this.interfaces = {
      ['POOL_MANAGER']: new Interface(PoolManagerABI),
      ['BUNNI_HUB']: new Interface(BunniHubABI),
      ['BUNNI_HOOK']: new Interface(BunniHookABI),
      ['BUNNI_TOKEN']: new Interface(BunniTokenABI),
      ['FLOOD_PLAIN']: new Interface(FloodPlainABI),
      ['FEE_OVERRIDE_HOOKLET']: new Interface(FeeOverrideHookletABI),
    };

    this.logDecoders = {
      ['POOL_MANAGER']: (log: Log) =>
        this.interfaces['POOL_MANAGER'].parseLog(log),
      ['BUNNI_HUB']: (log: Log) => this.interfaces['BUNNI_HUB'].parseLog(log),
      ['BUNNI_HOOK']: (log: Log) => this.interfaces['BUNNI_HOOK'].parseLog(log),
      ['FLOOD_PLAIN']: (log: Log) =>
        this.interfaces['FLOOD_PLAIN'].parseLog(log),
      ['FEE_OVERRIDE_HOOKLET']: (log: Log) =>
        this.interfaces['FEE_OVERRIDE_HOOKLET'].parseLog(log),
    };

    this.addressesSubscribed = [
      this.config.poolManager,
      this.config.bunniHub,
      this.config.bunniHook.address,
      this.config.floodPlain,
      ...Object.keys(this.config.hooklets),
    ];

    // Core Events
    this.handlers['Initialize'] = this.handleInitializeEvent.bind(this);
    this.handlers['NewBunni'] = this.handleNewBunniEvent.bind(this);
    this.handlers['Deposit'] = this.handleDepositEvent.bind(this);
    this.handlers['Withdraw'] = this.handleWithdrawEvent.bind(this);
    this.handlers['Swap'] = this.handleSwapEvent.bind(this);

    // Hook Events
    this.handlers['SetHookFeeModifier'] =
      this.handleSetHookFeeModifierEvent.bind(this);
    this.handlers['CuratorSetFeeRate'] =
      this.handleCuratorSetFeeRateEvent.bind(this);
    this.handlers['ScheduleKChange'] =
      this.handleScheduleKChangeEvent.bind(this);

    // am-AMM Events
    this.handlers['SubmitBid'] = this.handleSubmitBidEvent.bind(this);
    this.handlers['DepositIntoTopBid'] =
      this.handleDepositIntoTopBidEvent.bind(this);
    this.handlers['WithdrawFromTopBid'] =
      this.handleWithdrawFromTopBidEvent.bind(this);
    this.handlers['DepositIntoNextBid'] =
      this.handleDepositIntoNextBidEvent.bind(this);
    this.handlers['WithdrawFromNextBid'] =
      this.handleWithdrawFromNextBidEvent.bind(this);
    this.handlers['SetBidPayload'] = this.handleSetBidPayloadEvent.bind(this);
    this.handlers['IncreaseBidRent'] =
      this.handleIncreaseBidRentEvent.bind(this);

    // Rebalancer Events
    this.handlers['OrderEtched'] = this.handleOrderEtchedEvent.bind(this);
    this.handlers['OrderFulfilled'] = this.handleOrderFulfilledEvent.bind(this);

    // Hooklet Events
    this.handlers['SetFeeOverride'] = this.handleSetFeeOverrideEvent.bind(this);
  }

  protected async processLog(
    state: DeepReadonly<ProtocolState>,
    log: Readonly<Log>,
    blockHeader: BlockHeader,
  ): Promise<DeepReadonly<ProtocolState> | null> {
    try {
      const id = this.ids[log.address];
      const logDecoder = this.logDecoders[id];
      const event = logDecoder(log);
      if (event.name in this.handlers) {
        return await this.handlers[event.name](event, state, log, blockHeader);
      }
    } catch (e) {
      catchParseLogError(e, this.logger);
    }

    return null;
  }

  async generateState(
    blockNumber: number,
  ): Promise<DeepReadonly<ProtocolState>> {
    let protocolState = {
      poolStates: Object.create({}),
      vaultStates: Object.create({}),
      hookFeeModifier: 0n,
      currentK: 0n,
      pendingK: 0n,
      activeBlock: 0n,
    } as ProtocolState;

    const [state, pools] = await Promise.all([
      getProtocolState(this.dexHelper, this.logger, this.config, blockNumber),
      getPools(this.dexHelper, this.logger, this.config, blockNumber),
    ]);

    if (state) {
      protocolState.hookFeeModifier = bigIntify(state.hookFeesModifier);
      protocolState.currentK = bigIntify(state.currentK);
      protocolState.pendingK = bigIntify(state.pendingK);
      protocolState.activeBlock = bigIntify(state.activeBlock);
    }

    pools.forEach(pool => {
      let poolState = initializePoolState(
        pool.id,
        pool.currency0.id,
        pool.currency1.id,
        bigIntify(pool.fee),
        bigIntify(pool.tickSpacing),
        pool.hooks,
      );

      poolState.bunniHub = pool.bunniHub.id;
      poolState.bunniToken = pool.bunniToken.id;
      protocolState.poolStates[pool.id.toLowerCase()] = poolState;
    });

    const poolStates = Object.values(protocolState.poolStates);

    try {
      await generateOnChainState(
        poolStates,
        blockNumber,
        this.interfaces['BUNNI_HUB'],
        this.interfaces['BUNNI_HOOK'],
        this.interfaces['BUNNI_TOKEN'],
        this.interfaces['FEE_OVERRIDE_HOOKLET'],
        this.dexHelper,
        this.config,
      );
    } catch (error) {
      this.logger.error(error);
    }

    poolStates.forEach(poolState => {
      this.initializeVault(
        poolState.vault0,
        poolState.vault0Decimals,
        poolState.currency0Decimals,
        protocolState,
      );
      this.initializeVault(
        poolState.vault1,
        poolState.vault1Decimals,
        poolState.currency1Decimals,
        protocolState,
      );
    });

    return protocolState;
  }

  async getOrGenerateState(
    blockNumber: number,
  ): Promise<DeepReadonly<ProtocolState>> {
    let state = this.getState(blockNumber);
    if (!state) {
      this.logger.warn(
        `${this.parentName}: No state found on block ${blockNumber}, generating new one`,
      );
      state = await this.generateState(blockNumber);
      this.setState(state, blockNumber);
    }
    return state;
  }

  initializeVault(
    address: string,
    vaultDecimals: bigint,
    currencyDecimals: bigint,
    protocolState: ProtocolState,
  ): void {
    if (address !== NULL_ADDRESS) {
      if (!protocolState.vaultStates[address.toLowerCase()]) {
        protocolState.vaultStates[address.toLowerCase()] = {
          address: address.toLowerCase(),
          sharePrice: 0n,
          vaultDecimals,
          currencyDecimals,
          lastSharePriceUpdate: 0n,
        };
      }
    }
  }

  async handleInitializeEvent(
    event: any,
    state: DeepReadonly<ProtocolState>,
    log: Readonly<Log>,
    blockHeader: BlockHeader,
  ): Promise<DeepReadonly<ProtocolState> | null> {
    const newState = _.cloneDeep(state) as ProtocolState;

    // decode the event args
    const poolId = event.args.id.toLowerCase();
    const currency0 = event.args.currency0.toLowerCase();
    const currency1 = event.args.currency1.toLowerCase();
    const fee = bigIntify(event.args.fee);
    const tickSpacing = bigIntify(event.args.tickSpacing);
    const hooks = event.args.hooks.toLowerCase();
    const sqrtPriceX96 = bigIntify(event.args.sqrtPriceX96);
    const tick = bigIntify(event.args.tick);

    if (this.config.bunniHook.address.toLowerCase() === hooks) {
      let newPoolState = initializePoolState(
        poolId,
        currency0,
        currency1,
        fee,
        tickSpacing,
        hooks,
      );

      newPoolState.slot0.sqrtPriceX96 = sqrtPriceX96;
      newPoolState.slot0.tick = tick;

      newState.poolStates[poolId] = newPoolState;
    }

    return newState;
  }

  async handleNewBunniEvent(
    event: any,
    state: DeepReadonly<ProtocolState>,
    log: Readonly<Log>,
    blockHeader: BlockHeader,
  ): Promise<DeepReadonly<ProtocolState> | null> {
    const newState = _.cloneDeep(state) as ProtocolState;

    // decode the event args
    const poolId = event.args.poolId.toLowerCase();
    const bunniToken = event.args.bunniToken.toLowerCase();
    const bunniHub = log.address.toLowerCase();

    let newPoolState = newState.poolStates[poolId];
    newPoolState.bunniToken = bunniToken;
    newPoolState.bunniHub = bunniHub;

    try {
      await updateStateAfterNewBunni(
        newState.poolStates[poolId],
        blockHeader.number,
        this.interfaces['BUNNI_HUB'],
        this.interfaces['BUNNI_HOOK'],
        this.interfaces['BUNNI_TOKEN'],
        this.dexHelper,
      );
    } catch (error) {
      this.logger.error(error);
    }

    const { slot0, observationState } = afterInitialize(
      newPoolState.slot0.sqrtPriceX96,
      newPoolState.slot0.tick,
      bigIntify(newPoolState.twapSecondsAgo),
      newPoolState.hookParams,
      bigIntify(blockHeader.timestamp),
    );

    newState.poolStates[poolId] = {
      ...newPoolState,
      slot0,
      ...observationState,
    };

    return newState;
  }

  async handleDepositEvent(
    event: any,
    state: DeepReadonly<ProtocolState>,
    log: Readonly<Log>,
    blockHeader: BlockHeader,
  ): Promise<DeepReadonly<ProtocolState> | null> {
    const newState = _.cloneDeep(state) as ProtocolState;

    // decode the event args
    const poolId = event.args.poolId.toLowerCase();
    const amount0 = bigIntify(event.args.amount0);
    const amount1 = bigIntify(event.args.amount1);
    const shares = bigIntify(event.args.shares);

    const depositParams: DepositParams = {
      amount0Desired: amount0,
      amount1Desired: amount1,
    };

    let newPoolState: PoolState = newState.poolStates[poolId];

    try {
      await deposit(
        newPoolState,
        depositParams,
        bigIntify(blockHeader.number),
        bigIntify(blockHeader.timestamp),
        this.config.bunniHook.deploymentBlock,
        this._K(bigIntify(blockHeader.number)),
        this.dexHelper,
        this.config,
      );
    } catch (error) {
      this.logger.warn(error);

      try {
        await updateStateAfterDeposit(
          newState.poolStates[poolId],
          blockHeader.number,
          this.interfaces['BUNNI_HUB'],
          this.interfaces['BUNNI_HOOK'],
          this.dexHelper,
        );
      } catch (error) {
        this.logger.error(error);
      }
    }

    // update the total supply (always 1e18 on the first deposit)
    newPoolState.totalSupply += newPoolState.totalSupply === 0n ? WAD : shares;

    newState.poolStates[poolId] = newPoolState;
    return newState;
  }

  async handleWithdrawEvent(
    event: any,
    state: DeepReadonly<ProtocolState>,
    log: Readonly<Log>,
    blockHeader: BlockHeader,
  ): Promise<DeepReadonly<ProtocolState> | null> {
    const newState = _.cloneDeep(state) as ProtocolState;

    // decode the event args
    const poolId = event.args.poolId.toLowerCase();
    const shares = bigIntify(event.args.shares);

    const withdrawParams: WithdrawParams = {
      shares: shares,
    };

    let newPoolState = newState.poolStates[poolId];

    try {
      await withdraw(
        newPoolState,
        withdrawParams,
        bigIntify(blockHeader.number),
        this.dexHelper,
      );
    } catch (error) {
      this.logger.warn(error);

      try {
        await updateStateAfterWithdraw(
          newPoolState,
          blockHeader.number,
          this.interfaces['BUNNI_HUB'],
          this.dexHelper,
        );
      } catch (error) {
        this.logger.error(error);
      }
    }

    newPoolState.totalSupply -= shares;

    newState.poolStates[poolId] = newPoolState;
    return newState;
  }

  async handleSwapEvent(
    event: any,
    state: DeepReadonly<ProtocolState>,
    log: Readonly<Log>,
    blockHeader: BlockHeader,
  ): Promise<DeepReadonly<ProtocolState> | null> {
    // PoolManager will also emit Swap events, but we only care about BunniHook
    if (
      this.config.bunniHook.address.toLowerCase() === log.address.toLowerCase()
    ) {
      const newState = _.cloneDeep(state) as ProtocolState;

      const poolId = event.args.id.toLowerCase();
      const exactIn = event.args.exactIn;
      const zeroForOne = event.args.zeroForOne;
      const inputAmount = bigIntify(event.args.inputAmount);
      const outputAmount = bigIntify(event.args.outputAmount);

      try {
        await beforeSwap(
          newState.poolStates[poolId],
          bigIntify(blockHeader.number),
          bigIntify(blockHeader.timestamp),
          {
            zeroForOne,
            amountSpecified: exactIn ? -inputAmount : outputAmount,
            sqrtPriceLimitX96: zeroForOne
              ? TickMath.MIN_SQRT_PRICE + 1n
              : TickMath.MAX_SQRT_PRICE - 1n,
          },
          newState.hookFeeModifier,
          this.config.bunniHook.deploymentBlock,
          this._K(bigIntify(blockHeader.number)),
          this.dexHelper,
          this.config,
        );
      } catch (error) {
        this.logger.warn(error);

        try {
          await updateStateAfterSwap(
            newState.poolStates[poolId],
            blockHeader.number,
            this.interfaces['BUNNI_HUB'],
            this.interfaces['BUNNI_HOOK'],
            this.dexHelper,
          );
        } catch (error) {
          this.logger.error(error);
        }
      }

      return newState;
    }

    return state;
  }

  async handleSetHookFeeModifierEvent(
    event: any,
    state: DeepReadonly<ProtocolState>,
    log: Readonly<Log>,
    blockHeader: BlockHeader,
  ): Promise<DeepReadonly<ProtocolState> | null> {
    const newState = _.cloneDeep(state) as ProtocolState;
    newState.hookFeeModifier = bigIntify(event.args.hookFeeModifier);
    return newState;
  }

  async handleCuratorSetFeeRateEvent(
    event: any,
    state: DeepReadonly<ProtocolState>,
    log: Readonly<Log>,
    blockHeader: BlockHeader,
  ): Promise<DeepReadonly<ProtocolState> | null> {
    const newState = _.cloneDeep(state) as ProtocolState;

    const poolId = event.args.id.toLowerCase();
    const newfeeRate = bigIntify(event.args.newFeeRate);

    try {
      newState.poolStates[poolId].curatorFeeRate = newfeeRate;
    } catch (error) {
      this.logger.warn(error);

      try {
        await updateCuratorFees(
          [newState.poolStates[poolId]],
          blockHeader.number,
          this.interfaces['BUNNI_HOOK'],
          this.dexHelper,
        );
      } catch (error) {
        this.logger.error(error);
      }
    }

    return newState;
  }

  async handleScheduleKChangeEvent(
    event: any,
    state: DeepReadonly<ProtocolState>,
    log: Readonly<Log>,
    blockHeader: BlockHeader,
  ): Promise<DeepReadonly<ProtocolState> | null> {
    const newState = _.cloneDeep(state) as ProtocolState;
    newState.currentK = bigIntify(event.args.currentK);
    newState.pendingK = bigIntify(event.args.newK);
    newState.activeBlock = bigIntify(event.args.activeBlock);
    return newState;
  }

  async handleSubmitBidEvent(
    event: any,
    state: DeepReadonly<ProtocolState>,
    log: Readonly<Log>,
    blockHeader: BlockHeader,
  ): Promise<DeepReadonly<ProtocolState> | null> {
    const poolId = event.args.id.toLowerCase();
    const manager = event.args.manager;
    const blockIdx = bigIntify(event.args.blockIdx);
    const payload = event.args.payload;
    const rent = bigIntify(event.args.rent);
    const deposit = bigIntify(event.args.deposit);

    if (state.poolStates[poolId]) {
      const newState = _.cloneDeep(state) as ProtocolState;
      const newPoolState = newState.poolStates[poolId];

      _updateAmAmmWrite(
        newPoolState,
        bigIntify(blockHeader.number),
        this.config.bunniHook.deploymentBlock,
        this._K(bigIntify(blockHeader.number)),
      );

      newPoolState.nextBid = { manager, blockIdx, payload, rent, deposit };
      return newState;
    }

    return state;
  }

  async handleDepositIntoTopBidEvent(
    event: any,
    state: DeepReadonly<ProtocolState>,
    log: Readonly<Log>,
    blockHeader: BlockHeader,
  ): Promise<DeepReadonly<ProtocolState> | null> {
    const poolId = event.args.id.toLowerCase();
    const amount = bigIntify(event.args.amount);

    if (state.poolStates[poolId]) {
      const newState = _.cloneDeep(state) as ProtocolState;
      const newPoolState = newState.poolStates[poolId];

      _updateAmAmmWrite(
        newPoolState,
        bigIntify(blockHeader.number),
        this.config.bunniHook.deploymentBlock,
        this._K(bigIntify(blockHeader.number)),
      );

      newPoolState.topBid.deposit += amount;
      return newState;
    }

    return state;
  }

  async handleWithdrawFromTopBidEvent(
    event: any,
    state: DeepReadonly<ProtocolState>,
    log: Readonly<Log>,
    blockHeader: BlockHeader,
  ): Promise<DeepReadonly<ProtocolState> | null> {
    const poolId = event.args.id.toLowerCase();
    const amount = bigIntify(event.args.amount);

    if (state.poolStates[poolId]) {
      const newState = _.cloneDeep(state) as ProtocolState;
      const newPoolState = newState.poolStates[poolId];

      _updateAmAmmWrite(
        newPoolState,
        bigIntify(blockHeader.number),
        this.config.bunniHook.deploymentBlock,
        this._K(bigIntify(blockHeader.number)),
      );

      newPoolState.topBid.deposit -= amount;
      return newState;
    }

    return state;
  }

  async handleDepositIntoNextBidEvent(
    event: any,
    state: DeepReadonly<ProtocolState>,
    log: Readonly<Log>,
    blockHeader: BlockHeader,
  ): Promise<DeepReadonly<ProtocolState> | null> {
    const poolId = event.args.id.toLowerCase();
    const amount = bigIntify(event.args.amount);

    if (state.poolStates[poolId]) {
      const newState = _.cloneDeep(state) as ProtocolState;
      const newPoolState = newState.poolStates[poolId];

      _updateAmAmmWrite(
        newPoolState,
        bigIntify(blockHeader.number),
        this.config.bunniHook.deploymentBlock,
        this._K(bigIntify(blockHeader.number)),
      );

      newPoolState.nextBid.deposit += amount;
      return newState;
    }

    return state;
  }

  async handleWithdrawFromNextBidEvent(
    event: any,
    state: DeepReadonly<ProtocolState>,
    log: Readonly<Log>,
    blockHeader: BlockHeader,
  ): Promise<DeepReadonly<ProtocolState> | null> {
    const poolId = event.args.id.toLowerCase();
    const amount = bigIntify(event.args.amount);

    if (state.poolStates[poolId]) {
      const newState = _.cloneDeep(state) as ProtocolState;
      const newPoolState = newState.poolStates[poolId];

      _updateAmAmmWrite(
        newPoolState,
        bigIntify(blockHeader.number),
        this.config.bunniHook.deploymentBlock,
        this._K(bigIntify(blockHeader.number)),
      );

      newPoolState.nextBid.deposit -= amount;
      return newState;
    }

    return state;
  }

  async handleSetBidPayloadEvent(
    event: any,
    state: DeepReadonly<ProtocolState>,
    log: Readonly<Log>,
    blockHeader: BlockHeader,
  ): Promise<DeepReadonly<ProtocolState> | null> {
    const poolId = event.args.id.toLowerCase();
    const payload = event.args.payload;
    const topBid = event.args.topBid;

    if (state.poolStates[poolId]) {
      const newState = _.cloneDeep(state) as ProtocolState;
      const newPoolState = newState.poolStates[poolId];

      _updateAmAmmWrite(
        newPoolState,
        bigIntify(blockHeader.number),
        this.config.bunniHook.deploymentBlock,
        this._K(bigIntify(blockHeader.number)),
      );

      const relevantBid = topBid ? newPoolState.topBid : newPoolState.nextBid;
      relevantBid.payload = payload;

      return newState;
    }

    return state;
  }

  async handleIncreaseBidRentEvent(
    event: any,
    state: DeepReadonly<ProtocolState>,
    log: Readonly<Log>,
    blockHeader: BlockHeader,
  ): Promise<DeepReadonly<ProtocolState> | null> {
    const poolId = event.args.id.toLowerCase();
    const additionalRent = bigIntify(event.args.additionalRent);
    const updatedDeposit = bigIntify(event.args.updatedDeposit);
    const topBid: boolean = event.args.topBid;

    if (state.poolStates[poolId]) {
      const newState = _.cloneDeep(state) as ProtocolState;
      const newPoolState = newState.poolStates[poolId];

      _updateAmAmmWrite(
        newPoolState,
        bigIntify(blockHeader.number),
        this.config.bunniHook.deploymentBlock,
        this._K(bigIntify(blockHeader.number)),
      );

      const relevantBid = topBid ? newPoolState.topBid : newPoolState.nextBid;
      relevantBid.rent += additionalRent;
      relevantBid.deposit = updatedDeposit;

      return newState;
    }

    return state;
  }

  async handleOrderEtchedEvent(
    event: any,
    state: DeepReadonly<ProtocolState>,
    log: Readonly<Log>,
    blockHeader: BlockHeader,
  ): Promise<DeepReadonly<ProtocolState> | null> {
    // Only handle OrderEtched events from the BunniHook
    const offerer: string = event.args.signedOrder.order.offerer;
    if (this.config.bunniHook.address.toLowerCase() === offerer.toLowerCase()) {
      const newState = _.cloneDeep(state) as ProtocolState;
      const poolId = event.args.signedOrder.signature.toLowerCase();
      newState.poolStates[poolId].rebalanceOrderHash =
        event.args.orderHash.toLowerCase();
      return newState;
    }

    return state;
  }

  async handleOrderFulfilledEvent(
    event: any,
    state: DeepReadonly<ProtocolState>,
    log: Readonly<Log>,
    blockHeader: BlockHeader,
  ): Promise<DeepReadonly<ProtocolState> | null> {
    const newState = _.cloneDeep(state) as ProtocolState;

    const orderHash = event.args.orderHash.toLowerCase();
    const poolState = Object.values(newState.poolStates).find(
      pool => pool.rebalanceOrderHash.toLowerCase() === orderHash,
    );

    if (poolState) {
      try {
        await updateStateAfterOrderFulfilled(
          [poolState],
          blockHeader.number,
          this.interfaces['BUNNI_HUB'],
          this.interfaces['BUNNI_HOOK'],
          this.dexHelper,
        );

        poolState.rebalanceOrderHash = ZERO_BYTES_32;
      } catch (error) {
        this.logger.error(error);
      }
    }

    return newState;
  }

  async handleSetFeeOverrideEvent(
    event: any,
    state: DeepReadonly<ProtocolState>,
    log: Readonly<Log>,
    blockHeader: BlockHeader,
  ): Promise<DeepReadonly<ProtocolState> | null> {
    const newState = _.cloneDeep(state) as ProtocolState;

    const poolId = event.args.id.toLowerCase();
    const overrideZeroToOne = event.args.overrideZeroToOne;
    const feeZeroToOne = bigIntify(event.args.feeZeroToOne);
    const overrideOneToZero = event.args.overrideOneToZero;
    const feeOneToZero = bigIntify(event.args.feeOneToZero);

    const poolState = newState.poolStates[poolId];

    if (poolState) {
      poolState.overrideZeroToOne = overrideZeroToOne;
      poolState.feeZeroToOne = feeZeroToOne;
      poolState.overrideOneToZero = overrideOneToZero;
      poolState.feeOneToZero = feeOneToZero;
      return newState;
    }

    return state;
  }

  _quoteSwap(
    state: PoolState,
    vaults: { [address: string]: VaultState },
    params: SwapParams,
    blockNumber: bigint,
    blockTimestamp: bigint,
  ): {
    success: boolean;
    updatedSqrtPriceX96: bigint;
    updatedTick: bigint;
    inputAmount: bigint;
    outputAmount: bigint;
    swapFee: bigint;
    totalLiquidity: bigint;
  } {
    return quoteSwap(
      state,
      params,
      blockNumber,
      blockTimestamp,
      this.state?.hookFeeModifier || 0n,
      this.config.bunniHook.deploymentBlock,
      this._K(blockNumber),
      vaults,
      this.config,
    );
  }

  async _updatePoolTotalValueLocked(blockNumber?: number): Promise<void> {
    const _blockNumber =
      blockNumber || this.dexHelper.blockManager.getLatestBlockNumber();

    if (this.state !== null) {
      const newState = _.cloneDeep(this.state) as ProtocolState;
      await updatePoolTotalValueLocked(newState, this.dexHelper);
      this.setState(newState, _blockNumber);
    }
  }

  async _updateVaultSharePrices(blockNumber?: number): Promise<void> {
    const _blockNumber =
      blockNumber || this.dexHelper.blockManager.getLatestBlockNumber();

    if (this.state !== null) {
      const newState = _.cloneDeep(this.state) as ProtocolState;
      await updateVaultSharePrices(newState, this.dexHelper);
      this.setState(newState, _blockNumber);
    }
  }

  private _K(blockNumber: bigint): bigint {
    if (!this.state) return 0n;

    const k = this.state.currentK;
    const pendingK = this.state.pendingK;
    const pendingKActiveBlock = this.state.activeBlock;

    return pendingK > k && blockNumber >= pendingKActiveBlock ? pendingK : k;
  }
}

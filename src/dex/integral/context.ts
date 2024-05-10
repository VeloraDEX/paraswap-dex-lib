import { Address } from '@paraswap/core';
import { IntegralEventPool } from './integral-pool';
import { IntegralPricing } from './integral-pricing';
import { IntegralFactory } from './integral-factory';
import { IntegralRelayer } from './integral-relayer';
import { Network } from '../../constants';
import { IDexHelper } from '../../dex-helper';
import { Logger } from 'log4js';
import { Interface } from '@ethersproject/abi';
import { IntegralPool, PoolInitProps, RelayerState, Requires } from './types';
import {
  getPoolIdentifier,
  onPoolCreatedAddPool,
  onRelayerPoolEnabledSet,
  onTransferUpdateBalance,
} from './helpers';
import { IntegralToken } from './integral-token';

export class IntegralContext {
  static instance: IntegralContext;

  private _pools: { [poolId: string]: IntegralPool } = {};
  private _tokens: { [tokenAddress: Address]: IntegralToken } = {};
  private _factory: IntegralFactory;
  private _relayer: IntegralRelayer;

  logger: Logger;

  private constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
    readonly erc20Interface: Interface,
    readonly factoryAddress: Address,
    readonly relayerAddress: Address,
  ) {
    this.logger = dexHelper.getLogger(dexKey);
    this._factory = new IntegralFactory(
      dexHelper,
      dexKey,
      this.factoryAddress,
      onPoolCreatedAddPool,
      this.logger,
    );
    this._relayer = new IntegralRelayer(
      dexHelper,
      dexKey,
      this.erc20Interface,
      this.relayerAddress,
      {},
      onRelayerPoolEnabledSet,
      this.logger,
    );
  }

  async addPools(
    pools: PoolInitProps,
    blockNumber: number,
    initPhase: boolean = false,
  ) {
    this._relayer.addPools(pools);
    if (initPhase) {
      await this._relayer.initialize(blockNumber);
    }
    const _relayerState = this._relayer.getState(blockNumber);
    const relayerState = _relayerState
      ? _relayerState
      : await this._relayer.generateState(blockNumber);
    if (!_relayerState) {
      this._relayer.setState(relayerState, blockNumber);
    }
    const poolInitProps = this.removeDisabledPoolInitProps(relayerState, pools);

    const bases = Object.entries(poolInitProps).map(([poolAddress, p]) => {
      const poolId = getPoolIdentifier(this.dexKey, p.token0, p.token1);
      const base =
        (this._pools[poolId] && this._pools[poolId].base) ||
        new IntegralEventPool(
          this.dexKey,
          this.network,
          this.dexHelper,
          poolAddress,
          p.token0,
          p.token1,
          this.logger,
        );
      this._pools[poolId] = { base, enabled: true };
      return base;
    });
    await Promise.all(
      bases.map(base => !base.isInitialized && base.initialize(blockNumber)),
    );

    const pricings = await Promise.all(
      bases.map(async base => {
        const _poolState = base.getState(blockNumber);
        const poolState = _poolState
          ? _poolState
          : await base.generateState(blockNumber);
        const poolId = getPoolIdentifier(this.dexKey, base.token0, base.token1);
        const pricing =
          (this._pools[poolId] && this._pools[poolId].pricing) ||
          new IntegralPricing(
            this.dexHelper,
            poolId,
            this.erc20Interface,
            poolState.uniswapPool,
            base.token0,
            base.token1,
            poolState.uniswapPoolFee,
            this.logger,
            this.network,
          );
        this._pools[poolId].pricing = pricing;
        return pricing;
      }),
    );
    await Promise.all(
      pricings.map(
        pricing => !pricing.isInitialized && pricing.initialize(blockNumber),
      ),
    );

    const initIntegralToken = (token: Address) =>
      new IntegralToken(
        this.dexHelper,
        this.dexKey,
        this.erc20Interface,
        token,
        this.relayerAddress,
        onTransferUpdateBalance,
        this.logger,
      );
    bases.map(base => {
      this._tokens[base.token0] =
        this._tokens[base.token0] || initIntegralToken(base.token0);
      this._tokens[base.token1] =
        this._tokens[base.token1] || initIntegralToken(base.token1);
    });
    await Promise.all(
      Object.values(this._tokens).map(
        token => !token.isInitialized && token.initialize(blockNumber),
      ),
    );
  }

  getPoolAddresses() {
    return Object.values(this._pools)
      .filter(
        (pool): pool is Requires<IntegralPool, 'base'> =>
          !!pool.base && pool.enabled,
      )
      .map(({ base }) => base.poolAddress);
  }

  private removeDisabledPoolInitProps(
    state: RelayerState,
    props: PoolInitProps,
  ) {
    Object.entries(state.pools).forEach(
      ([poolAddress, poolState]) =>
        !poolState.isEnabled && delete props[poolAddress],
    );
    return props;
  }

  public static initialize(
    network: Network,
    dexKey: string,
    dexHelper: IDexHelper,
    erc20Interface: Interface,
    factoryAddress: Address,
    relayerAddress: Address,
  ) {
    if (!this.instance) {
      this.instance = new IntegralContext(
        network,
        dexKey,
        dexHelper,
        erc20Interface,
        factoryAddress,
        relayerAddress,
      );
    }
    return this.instance;
  }

  public static getInstance() {
    if (!this.instance) {
      throw new Error('IntegralContext instance not initialized');
    }
    return this.instance;
  }

  get pools() {
    return this._pools;
  }
  get factory() {
    return this._factory;
  }
  get relayer() {
    return this._relayer;
  }
}

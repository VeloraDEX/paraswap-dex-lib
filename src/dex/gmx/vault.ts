import _ from 'lodash';
import { Interface } from 'ethers';
import { AsyncOrSync, DeepReadonly } from 'ts-essentials';
import { PartialEventSubscriber } from '../../composed-event-subscriber';
import { Lens } from '../../lens';
import VaultABI from '../../abi/gmx/vault.json';
import { VaultUtils } from './vault-utils';
import { VaultConfig, VaultState } from './types';
import { VaultPriceFeed } from './vault-price-feed';
import { USDG } from './usdg';
import {
  MultiCallInput,
  MultiCallOutput,
  Address,
  Logger,
  Log,
} from '../../types';
import { BlockHeader } from 'web3-eth';

export class Vault<State> extends PartialEventSubscriber<State, VaultState> {
  static readonly interface: Interface = new Interface(VaultABI);

  protected vaultUtils: VaultUtils<State>;

  public tokenDecimals: { [address: string]: number };
  public stableTokens: { [address: string]: boolean };
  protected tokenWeights: { [address: string]: bigint };
  public stableSwapFeeBasisPoints: bigint;
  public swapFeeBasisPoints: bigint;
  public stableTaxBasisPoints: bigint;
  public taxBasisPoints: bigint;
  public hasDynamicFees: bigint;
  protected includeAmmPrice: boolean;
  protected useSwapPricing: boolean;
  protected totalTokenWeights: bigint;

  constructor(
    public readonly vaultAddress: Address,
    protected tokenAddresses: Address[],
    config: VaultConfig,
    protected vaultPriceFeed: VaultPriceFeed<State>,
    protected usdg: USDG<State>,
    lens: Lens<DeepReadonly<State>, DeepReadonly<VaultState>>,
    logger: Logger,
  ) {
    super([vaultAddress], lens, logger);
    this.vaultUtils = new VaultUtils(this);
    this.tokenDecimals = config.tokenDecimals;
    this.stableTokens = config.stableTokens;
    this.tokenWeights = config.tokenWeights;
    this.stableSwapFeeBasisPoints = config.stableSwapFeeBasisPoints;
    this.swapFeeBasisPoints = config.swapFeeBasisPoints;
    this.stableTaxBasisPoints = config.stableTaxBasisPoints;
    this.taxBasisPoints = config.taxBasisPoints;
    this.hasDynamicFees = config.hasDynamicFees;
    this.includeAmmPrice = config.includeAmmPrice;
    this.useSwapPricing = config.useSwapPricing;
    this.totalTokenWeights = config.totalTokenWeights;
  }

  getMinPrice(state: DeepReadonly<State>, _token: Address): bigint {
    return this.vaultPriceFeed.getPrice(
      state,
      _token,
      false,
      this.includeAmmPrice,
      this.useSwapPricing,
    );
  }

  getMaxPrice(state: DeepReadonly<State>, _token: Address): bigint {
    return this.vaultPriceFeed.getPrice(
      state,
      _token,
      true,
      this.includeAmmPrice,
      this.useSwapPricing,
    );
  }

  getFeeBasisPoints(
    state: DeepReadonly<State>,
    _token: Address,
    _usdgDelta: bigint,
    _feeBasisPoints: bigint,
    _taxBasisPoints: bigint,
    _increment: boolean,
  ): bigint {
    return this.vaultUtils.getFeeBasisPoints(
      state,
      _token,
      _usdgDelta,
      _feeBasisPoints,
      _taxBasisPoints,
      _increment,
    );
  }

  getTargetUsdgAmount(state: DeepReadonly<State>, _token: Address): bigint {
    const supply = this.usdg.getTotalSupply(state);
    if (supply == 0n) {
      return 0n;
    }
    const weight = this.tokenWeights[_token];
    return (weight * supply) / this.totalTokenWeights;
  }

  static getConfigMulticallInputs(
    vaultAddress: Address,
    tokenAddresses: Address[],
  ): MultiCallInput[] {
    return [
      ...tokenAddresses.map(t => ({
        target: vaultAddress,
        callData: Vault.interface.encodeFunctionData('tokenDecimals', [t]),
      })),
      ...tokenAddresses.map(t => ({
        target: vaultAddress,
        callData: Vault.interface.encodeFunctionData('stableTokens', [t]),
      })),
      ...tokenAddresses.map(t => ({
        target: vaultAddress,
        callData: Vault.interface.encodeFunctionData('tokenWeights', [t]),
      })),
      ...[
        'stableSwapFeeBasisPoints',
        'swapFeeBasisPoints',
        'stableTaxBasisPoints',
        'taxBasisPoints',
        'hasDynamicFees',
        'includeAmmPrice',
        'useSwapPricing',
        'totalTokenWeights',
      ].map(fn => ({
        target: vaultAddress,
        callData: Vault.interface.encodeFunctionData(fn),
      })),
    ];
  }

  static getConfig(
    multicallOutputs: MultiCallOutput[],
    tokenAddresses: Address[],
  ): VaultConfig {
    let i = 0;
    return {
      tokenDecimals: tokenAddresses.reduce(
        (acc: { [address: string]: number }, t: Address) => {
          acc[t] = parseInt(
            Vault.interface
              .decodeFunctionResult('tokenDecimals', multicallOutputs[i++])[0]
              .toString(),
          );
          return acc;
        },
        {},
      ),
      stableTokens: tokenAddresses.reduce(
        (acc: { [address: string]: boolean }, t: Address) => {
          acc[t] = Vault.interface.decodeFunctionResult(
            'stableTokens',
            multicallOutputs[i++],
          )[0];
          return acc;
        },
        {},
      ),
      tokenWeights: tokenAddresses.reduce(
        (acc: { [address: string]: bigint }, t: Address) => {
          acc[t] = BigInt(
            Vault.interface
              .decodeFunctionResult('tokenWeights', multicallOutputs[i++])[0]
              .toString(),
          );
          return acc;
        },
        {},
      ),
      stableSwapFeeBasisPoints: BigInt(
        Vault.interface
          .decodeFunctionResult(
            'stableSwapFeeBasisPoints',
            multicallOutputs[i++],
          )[0]
          .toString(),
      ),
      swapFeeBasisPoints: BigInt(
        Vault.interface
          .decodeFunctionResult('swapFeeBasisPoints', multicallOutputs[i++])[0]
          .toString(),
      ),
      stableTaxBasisPoints: BigInt(
        Vault.interface
          .decodeFunctionResult(
            'stableTaxBasisPoints',
            multicallOutputs[i++],
          )[0]
          .toString(),
      ),
      taxBasisPoints: BigInt(
        Vault.interface
          .decodeFunctionResult('taxBasisPoints', multicallOutputs[i++])[0]
          .toString(),
      ),
      hasDynamicFees: Vault.interface.decodeFunctionResult(
        'hasDynamicFees',
        multicallOutputs[i++],
      )[0],
      includeAmmPrice: Vault.interface.decodeFunctionResult(
        'includeAmmPrice',
        multicallOutputs[i++],
      )[0],
      useSwapPricing: Vault.interface.decodeFunctionResult(
        'useSwapPricing',
        multicallOutputs[i++],
      )[0],
      totalTokenWeights: BigInt(
        Vault.interface
          .decodeFunctionResult('totalTokenWeights', multicallOutputs[i++])[0]
          .toString(),
      ),
    };
  }

  public getGenerateStateMultiCallInputs(): MultiCallInput[] {
    return this.tokenAddresses.map((t: Address) => ({
      target: this.vaultAddress,
      callData: Vault.interface.encodeFunctionData('usdgAmounts', [t]),
    }));
  }

  public generateState(
    multicallOutputs: MultiCallOutput[],
    blockNumber?: number | 'latest',
  ): DeepReadonly<VaultState> {
    let vaultState: VaultState = {
      usdgAmounts: {},
    };
    this.tokenAddresses.forEach(
      (t: Address, i: number) =>
        (vaultState.usdgAmounts[t] = BigInt(
          Vault.interface
            .decodeFunctionResult('usdgAmounts', multicallOutputs[i])[0]
            .toString(),
        )),
    );
    return vaultState;
  }

  public getUSDGAmount(state: DeepReadonly<State>, token: Address): bigint {
    return this.lens.get()(state).usdgAmounts[token];
  }

  public processLog(
    state: DeepReadonly<VaultState>,
    log: Readonly<Log>,
    blockHeader: Readonly<BlockHeader>,
  ): AsyncOrSync<VaultState | null> {
    try {
      const parsed = Vault.interface.parseLog(log);

      if (!parsed) return null;

      const _state: VaultState = _.cloneDeep(state);
      switch (parsed.name) {
        case 'IncreaseUsdgAmount': {
          const tokenAddress = parsed.args.token.toLowerCase();
          const amount = BigInt(parsed.args.amount.toString());
          if (tokenAddress in state.usdgAmounts)
            _state.usdgAmounts[tokenAddress] += amount;
          return _state;
        }
        case 'DecreaseUsdgAmount': {
          const tokenAddress = parsed.args.token.toLowerCase();
          const amount = BigInt(parsed.args.amount.toString());
          if (tokenAddress in state.usdgAmounts)
            _state.usdgAmounts[tokenAddress] -= amount;
          return _state;
        }
        default:
          return null;
      }
    } catch (e) {
      this.logger.error('Failed to parse log', e);
      return null;
    }
  }
}

import { Interface, JsonFragment } from '@ethersproject/abi';
import { Logger } from 'log4js';
import { MultiCallParams, MultiResult } from '../../../lib/multi-wrapper';
import {
  DexParams,
  FactoryImplementationNames,
  PoolConstants,
  PoolContextConstants,
  PoolState,
} from '../types';
import { PoolPollingBase, MulticallReturnedTypes } from './pool-polling-base';
import FactoryCurveV1ABI from '../../../abi/curve-v1-factory/FactoryCurveV1.json';
import { generalDecoder, uint256ToBigInt } from '../../../lib/decoders';
import { BytesLike } from 'ethers';
import { Address } from '@paraswap/core';

const DEFAULT_2_ZERO_ARRAY = [0n, 0n];
const DEFAULT_4_ZERO_ARRAY = [0n, 0n, 0n, 0n];

const getStoredRatesABI = (n: string) => ({
  name: 'stored_rates',
  stateMutability: 'view',
  type: 'function',
  inputs: [],
  outputs: [{ name: '', type: `uint256[${n}]` }],
});

export class FactoryStateHandler extends PoolPollingBase {
  constructor(
    readonly logger: Logger,
    readonly dexKey: string,
    network: number,
    cacheStateKey: string,
    readonly implementationName: FactoryImplementationNames,
    implementationAddress: Address,
    readonly address: Address,
    readonly stateUpdatePeriodMs: number,
    readonly factories: DexParams['factories'],
    readonly factoryAddress: Address,
    readonly poolIdentifier: string,
    readonly poolConstants: PoolConstants,
    readonly poolContextConstants: PoolContextConstants,
    readonly isSrcFeeOnTransferSupported: boolean,
    liquidityApiSlug: string,
    baseStatePoolPolling?: PoolPollingBase,
    customGasCost?: number,
    readonly isStoredRatesSupported: boolean = false,
    private factoryIface: Interface = new Interface(
      FactoryCurveV1ABI as JsonFragment[],
    ),
    private additionalFuncsIface: Interface = new Interface([
      getStoredRatesABI(poolContextConstants?.N_COINS?.toString() || ''),
    ]),
  ) {
    super(
      logger,
      dexKey,
      network,
      cacheStateKey,
      implementationName,
      implementationAddress,
      stateUpdatePeriodMs,
      poolIdentifier,
      poolConstants,
      poolContextConstants,
      address,
      liquidityApiSlug,
      false,
      baseStatePoolPolling,
      isSrcFeeOnTransferSupported,
      customGasCost,
    );

    if (this.isMetaPool && this.baseStatePoolPolling === undefined) {
      throw new Error(
        `${this.fullName}: is instantiated with error. basePoolStateFetcher is not provided`,
      );
    }
  }

  getStateMultiCalldata(): MultiCallParams<MulticallReturnedTypes>[] {
    const factoryConfig = this.factories?.find(
      ({ address }) =>
        address.toLowerCase() === this.factoryAddress.toLowerCase(),
    );

    const calls = [
      {
        target: this.factoryAddress,
        callData: this.factoryIface.encodeFunctionData('get_A', [this.address]),
        decodeFunction: uint256ToBigInt,
      },
      {
        target: this.factoryAddress,
        callData: this.factoryIface.encodeFunctionData('get_fees', [
          this.address,
        ]),
        decodeFunction: (result: MultiResult<BytesLike> | BytesLike) =>
          generalDecoder(result, ['uint256', 'uint256'], DEFAULT_2_ZERO_ARRAY),
      },
      {
        target: this.factoryAddress,
        callData: this.factoryIface.encodeFunctionData('get_balances', [
          this.address,
        ]),
        decodeFunction: (result: MultiResult<BytesLike> | BytesLike) =>
          generalDecoder(
            result,
            [`uint256[${factoryConfig?.isStableNg ? '' : '4'}]`],
            DEFAULT_4_ZERO_ARRAY,
          ),
      },
    ];

    if (this.isStoredRatesSupported) {
      calls.push({
        target: this.address,
        callData: this.additionalFuncsIface.encodeFunctionData(
          'stored_rates',
          [],
        ),
        decodeFunction: (result: MultiResult<BytesLike> | BytesLike) =>
          generalDecoder(
            result,
            [
              `uint256[${
                factoryConfig?.isStableNg
                  ? ''
                  : this.poolContextConstants.N_COINS
              }]`,
            ],
            new Array(this.poolContextConstants.N_COINS).fill(0n),
          ),
      });
    }

    if (factoryConfig?.isStableNg) {
      calls.push({
        target: this.address,
        callData: this.abiCoder.encodeFunctionCall(
          {
            stateMutability: 'view',
            type: 'function',
            name: 'offpeg_fee_multiplier',
            inputs: [],
            outputs: [{ name: '', type: 'uint256' }],
          },
          [],
        ),
        decodeFunction: uint256ToBigInt,
      });

      calls.push({
        target: this.address,
        callData: this.abiCoder.encodeFunctionCall(
          {
            stateMutability: 'view',
            type: 'function',
            name: 'N_COINS',
            inputs: [],
            outputs: [{ name: '', type: 'uint256' }],
          },
          [],
        ),
        decodeFunction: uint256ToBigInt,
      });
    }

    return calls;
  }

  parseMultiResultsToStateValues(
    multiOutputs: MulticallReturnedTypes[],
    blockNumber: number,
    updatedAtMs: number,
  ): PoolState {
    const [A, fees, balances, storedRates, offpeg_fee_multiplier, n_coins] =
      multiOutputs as [
        bigint,
        bigint[],
        bigint[],
        bigint[] | undefined,
        bigint | undefined,
        number | undefined,
      ];

    let basePoolState: PoolState | undefined;
    if (this.isMetaPool) {
      // Check for undefined done in constructor
      const retrievedBasePoolState = this.baseStatePoolPolling!.getState();

      if (retrievedBasePoolState === null) {
        throw new Error(
          `${this.CLASS_NAME} ${this.dexKey} ${this.address}: Can not retrieve base pool state`,
        );
      }
      basePoolState = retrievedBasePoolState;
    }

    return {
      A: this.poolContextConstants.A_PRECISION
        ? A * this.poolContextConstants.A_PRECISION
        : A,
      fee: fees[0], // Array has [fee, adminFee], but we want only fee
      balances: balances,
      constants: this.poolConstants,
      n_coins,
      basePoolState,
      updatedAtMs,
      blockNumber,
      offpeg_fee_multiplier,
      storedRates,
    };
  }
}

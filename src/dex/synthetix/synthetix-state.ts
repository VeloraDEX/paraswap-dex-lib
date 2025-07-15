import _ from 'lodash';
import { ethers } from 'ethers';
import { Interface } from '@ethersproject/abi';
import { NULL_ADDRESS } from '../../constants';
import { IDexHelper } from '../../dex-helper';
import { MultiCallParams, MultiWrapper } from '../../lib/multi-wrapper';
import { BigIntAsString, Logger, Token } from '../../types';
import { getBigIntPow, _require } from '../../utils';
import { dexPriceAggregatorUniswapV3 } from './contract-math/DexPriceAggregatorUniswapV3';
import { OracleLibrary } from './contract-math/OracleLibrary';
import {
  ChainlinkData,
  DexParams,
  LatestRoundData,
  OnchainConfigValues,
  OracleObservation,
  PoolKey,
  PoolState,
  Slot0,
} from './types';
import {
  addressDecode,
  booleanDecode,
  bytes32ToString,
  uint24ToBigInt,
  uint256ArrayDecode,
  uint8ToNumber,
  uint256ToBigInt,
} from '../../lib/decoders';
import {
  decodeLatestRoundData,
  decodeObserveTickCumulatives,
  decodeOracleObservation,
  decodeUniswapV3Slot0,
  encodeStringToBytes32,
  exchangeSuspensionDecoder,
  synthStatusDecoder,
} from './utils';
import {
  Contracts,
  EXCHANGE_RATES_CONTRACT_NAME,
  LIQUIDITY_ESTIMATION_FACTOR,
  ONCHAIN_CONFIG_VALUE_UPDATE_FREQUENCY_IN_MS,
  SETTING_ATOMIC_EQUIVALENT_FOR_DEX_PRICING,
  SETTING_ATOMIC_EXCHANGE_FEE_RATE,
  SETTING_ATOMIC_TWAP_WINDOW,
  SETTING_CONTRACT_NAME,
  SETTING_DEX_PRICE_AGGREGATOR,
  SETTING_EXCHANGE_DYNAMIC_FEE_ROUNDS,
  SETTING_EXCHANGE_DYNAMIC_FEE_THRESHOLD,
  SETTING_EXCHANGE_DYNAMIC_FEE_WEIGHT_DECAY,
  SETTING_EXCHANGE_FEE_RATE,
  SETTING_EXCHANGE_MAX_DYNAMIC_FEE,
  SETTING_PURE_CHAINLINK_PRICE_FOR_ATOMIC_SWAPS_ENABLED,
  STATE_TTL_IN_MS,
} from './constants';
import { Address } from '@paraswap/core';

export class SynthetixState {
  logger: Logger;

  // updatedAt may be blockNumber or timestamp
  fullState?: { blockNumber: number; updatedAtInMs: number; values: PoolState };

  isStateSynching = false;

  private readonly _onchainConfigValues: {
    values?: OnchainConfigValues;
    updatedAtInMs: number;
    isUpdating: boolean;
  } = { updatedAtInMs: 0, isUpdating: false };

  constructor(
    private dexKey: string,
    private dexHelper: IDexHelper,
    private combinedIface: Interface,
    private config: DexParams,
    private onchainConfigValueUpdateFrequencyInMs = ONCHAIN_CONFIG_VALUE_UPDATE_FREQUENCY_IN_MS,
  ) {
    this.logger = this.dexHelper.getLogger('SynthetixState');
  }

  get multiWrapper() {
    return this.dexHelper.multiWrapper;
  }

  get onchainConfigValuesWithUndefined(): OnchainConfigValues | undefined {
    return this._onchainConfigValues.values;
  }

  get onchainConfigValues(): OnchainConfigValues {
    if (
      Date.now() - this.onchainConfigValueUpdateFrequencyInMs >
        this._onchainConfigValues.updatedAtInMs &&
      !this._onchainConfigValues.isUpdating
    ) {
      // We can just create promise and don't wait while it is resolved. When it is resolved, the values will be updated automatically
      // There is no reason to wait it
      this._onchainConfigValues.isUpdating = true;
      this.updateOnchainConfigValues()
        .then(() => {
          this.logger.info(`${this.dexKey}: _onchainConfigValues are updated`);
          this._onchainConfigValues.isUpdating = false;
        })
        .catch(e => {
          this.logger.error(
            `${this.dexKey}: failed to update _onchainConfigValues. Retrying`,
          );
          this._onchainConfigValues.isUpdating = false;
          // Retry after 1 sec
          setTimeout(() => {
            this.onchainConfigValues;
          }, 1000);
        });
    }
    if (this._onchainConfigValues.values === undefined) {
      throw new Error(
        `${this.dexKey}: onchain config values are not initialized`,
      );
    }
    return this._onchainConfigValues.values;
  }

  async updateOnchainConfigValues(blockNumber?: number) {
    this._onchainConfigValues.values = await this.getOnchainConfigValues(
      blockNumber,
    );
    this._onchainConfigValues.updatedAtInMs = Date.now();
    this.logger.info(
      `${this.dexKey}: onchain config values are successfully updated`,
    );
  }

  getState(): PoolState | undefined {
    if (this.fullState) {
      // If last updated time is exceeding twice normal update frequency we have to alarm about it
      if (Date.now() - this.fullState.updatedAtInMs > STATE_TTL_IN_MS * 2) {
        this.logger.error(
          `${this.dexKey}: state was not updated since ${
            this.fullState.updatedAtInMs
          } (apr. ${Math.floor(
            (Date.now() - this.fullState.updatedAtInMs) / 1000,
          )} sec. ago)`,
        );
        // We don't want to serve very outdated pricing
        return undefined;
      }
      return this.fullState.values;
    }
    return undefined;
  }

  async updateOnchainState(
    blockNumber?: number,
  ): Promise<PoolState | undefined> {
    if (this.onchainConfigValues === undefined)
      throw new Error(
        `${this.dexKey} is not initialized, but received pricing request`,
      );

    if (this.isStateSynching) {
      this.logger.error(
        `${this.dexKey}: getOnchainState was called before previous request has finished. It must not be happening. Something is wrong`,
      );
      return;
    }

    this.isStateSynching = true;

    try {
      const addressesFromPK = this.onchainConfigValues.poolKeys.map(pk =>
        dexPriceAggregatorUniswapV3.getPoolForRoute(
          this.onchainConfigValues!.dexPriceAggregator.uniswapV3Factory,
          this.onchainConfigValues!.dexPriceAggregator.overriddenPoolForRoute,
          pk,
        ),
      );

      const aggregatorAddressesWithoutZeros = Object.entries(
        this.onchainConfigValues.aggregatorsAddresses,
      ).reduce<Record<string, Address>>((acc, curr) => {
        const [key, address] = curr;
        if (address !== NULL_ADDRESS) {
          acc[key] = address;
        }
        return acc;
      }, {});

      const [packCounter, slot0TickCumulativesSuspensionsLatestRoundCallData] =
        this._buildObserveSlot0SuspensionsLatestRoundCallData(
          addressesFromPK,
          aggregatorAddressesWithoutZeros,
          this.onchainConfigValues.atomicTwapWindow,
          this.onchainConfigValues.systemStatusAddress,
          this.onchainConfigValues.addressToKey,
        );

      const slot0TickCumulativesSuspensionsLatestRound = (
        await this.multiWrapper.tryAggregate<
          Record<0 | 1, bigint> | Slot0 | boolean[] | boolean | LatestRoundData
        >(true, slot0TickCumulativesSuspensionsLatestRoundCallData, blockNumber)
      ).map(d => d.returnData) as (
        | Record<0 | 1, bigint>
        | boolean
        | boolean[]
        | LatestRoundData
      )[];

      let addressesFromPKBoundary = addressesFromPK.length * packCounter;
      const slot0AndTickCumulatives =
        slot0TickCumulativesSuspensionsLatestRound.slice(
          0,
          addressesFromPKBoundary,
        );

      const suspensions = slot0TickCumulativesSuspensionsLatestRound.slice(
        addressesFromPKBoundary,
        // Number of suspension requests
        addressesFromPKBoundary + 4,
      );

      const latestRoundDatas = slot0TickCumulativesSuspensionsLatestRound.slice(
        addressesFromPKBoundary + 4,
      ) as LatestRoundData[];

      const isExchangeSuspended = suspensions[0] as boolean;
      const isSystemSuspended = suspensions[1] as boolean;
      const synthSuspensions = suspensions[2] as boolean[];
      const synthExchangeSuspensions = suspensions[3] as boolean[];

      const areSynthsSuspended = Object.keys(
        this.onchainConfigValues.addressToKey,
      ).reduce<Record<string, boolean>>((acc, curr, i) => {
        acc[curr] =
          synthSuspensions[i] === true || synthExchangeSuspensions[i] === true;
        return acc;
      }, {});

      const uniswapV3Slot0: Record<Address, Slot0> = {};
      const tickCumulatives: Record<Address, Record<0 | 1, bigint>> = {};

      _.chunk(slot0AndTickCumulatives, packCounter).forEach((result, i) => {
        const address = addressesFromPK[i];
        const [tickCumulative, slot0] = result as [
          Record<0 | 1, bigint>,
          Slot0,
        ];

        uniswapV3Slot0[address] = slot0;
        tickCumulatives[address] = tickCumulative;
      });

      const [_packCounter, observationsRoundAndOverriddenCallData] =
        this._buildObservationsRoundAndOverriddenCallData(
          addressesFromPK,
          uniswapV3Slot0,
          aggregatorAddressesWithoutZeros,
          latestRoundDatas,
        );

      const [block, observationsRoundDataAndOverridden] = await Promise.all([
        this.dexHelper.web3Provider.eth.getBlock(blockNumber || 'latest'),
        this.multiWrapper.tryAggregate<
          OracleObservation | LatestRoundData | string
        >(true, observationsRoundAndOverriddenCallData, blockNumber),
      ]);

      addressesFromPKBoundary = addressesFromPK.length * _packCounter;
      const observations = observationsRoundDataAndOverridden
        .slice(0, addressesFromPKBoundary)
        .map(e => e.returnData) as OracleObservation[];

      const overriddenPools = observationsRoundDataAndOverridden
        .slice(
          addressesFromPKBoundary,
          addressesFromPKBoundary + this.onchainConfigValues.poolKeys.length,
        )
        .map(e => e.returnData) as string[];

      const otherRoundDatas = observationsRoundDataAndOverridden
        .slice(
          addressesFromPKBoundary + this.onchainConfigValues.poolKeys.length,
        )
        .map(e => e.returnData) as LatestRoundData[];

      const chunkedOtherRoundDatas =
        this.onchainConfigValues.exchangeDynamicFeeConfig.rounds > 0n
          ? _.chunk(
              otherRoundDatas,
              Number(this.onchainConfigValues.exchangeDynamicFeeConfig.rounds),
            )
          : new Array<LatestRoundData[]>(latestRoundDatas.length).fill([]);

      const overriddenPoolForRoute = overriddenPools.reduce<
        Record<string, Address>
      >((acc, curr, i) => {
        acc[
          dexPriceAggregatorUniswapV3.identifyRouteFromPoolKey(
            this.onchainConfigValues!.poolKeys[i],
          )
        ] = curr;
        return acc;
      }, {});

      _require(
        latestRoundDatas.length === chunkedOtherRoundDatas.length,
        'Something is wrong with indexes while getting OnchainState',
        { chunkedOtherRoundDatas, latestRoundDatas },
        'latestRoundDatas.length === chunkedOtherRoundDatas.length',
      );

      const aggregators = latestRoundDatas.reduce<
        Record<Address, ChainlinkData>
      >((acc, cur, i) => {
        const getRoundData = chunkedOtherRoundDatas[i].reduce<
          Record<BigIntAsString, LatestRoundData>
        >((roundAcc, currRound) => {
          roundAcc[currRound.roundId.toString()] = currRound;
          return roundAcc;
        }, {});

        acc[Object.keys(aggregatorAddressesWithoutZeros)[i]] = {
          latestRoundData: cur,
          getRoundData,
        };
        return acc;
      }, {});

      const uniswapV3Observations = _.chunk(observations, _packCounter).reduce<
        Record<Address, Record<number, OracleObservation>>
      >((acc, cur, i) => {
        const address = addressesFromPK[i];
        const slot0 = uniswapV3Slot0[address];
        const [currentObservation, prevObservation] = cur;
        acc[address] = {
          [Number(slot0.observationIndex)]: currentObservation,
          [Number(
            slot0.observationCardinality !== 0n
              ? OracleLibrary.getPrevIndex(
                  slot0.observationIndex,
                  slot0.observationCardinality,
                )
              : 0n,
          )]: prevObservation,
        };
        return acc;
      }, {});

      const newState: PoolState = {
        atomicExchangeFeeRate: this.onchainConfigValues.atomicExchangeFeeRate,
        exchangeFeeRate: this.onchainConfigValues.exchangeFeeRate,
        exchangeDynamicFeeConfig:
          this.onchainConfigValues.exchangeDynamicFeeConfig,
        pureChainlinkPriceForAtomicSwapsEnabled:
          this.onchainConfigValues.pureChainlinkPriceForAtomicSwapsEnabled,
        atomicEquivalentForDexPricing:
          this.onchainConfigValues.atomicEquivalentForDexPricing,
        atomicTwapWindow: this.onchainConfigValues.atomicTwapWindow,
        dexPriceAggregator: {
          weth: this.onchainConfigValues.dexPriceAggregator.weth,
          defaultPoolFee:
            this.onchainConfigValues.dexPriceAggregator.defaultPoolFee,
          uniswapV3Factory:
            this.onchainConfigValues.dexPriceAggregator.uniswapV3Factory,
          overriddenPoolForRoute,
          uniswapV3Slot0,
          uniswapV3Observations,
          tickCumulatives,
        },
        sUSDCurrencyKey:
          this.onchainConfigValues.addressToKey[this.config.sUSDAddress],
        aggregatorDecimals: this.onchainConfigValues.aggregatorDecimals,
        blockTimestamp: BigInt(block.timestamp),
        aggregators,
        isSystemSuspended,
        areSynthsSuspended,
        isExchangeSuspended,
      };

      this.fullState = {
        updatedAtInMs: Date.now(),
        blockNumber: blockNumber || block.number,
        values: newState,
      };

      return newState;
    } finally {
      this.isStateSynching = false;
    }
  }

  async getOnchainConfigValues(
    blockNumber?: number,
  ): Promise<OnchainConfigValues> {
    // There are four onchain calls for one state update
    // I deliberately don't split into meaningful functions to not add additional
    // Promises on top of the ones I already use

    const [
      targetAddress,
      dexPriceAggregatorAddress,
      atomicTwapWindow,
      sUSDTotalSupply,
      ...synthsAddresses
    ] = (
      await this.multiWrapper.tryAggregate<string | bigint>(
        true,
        this._buildInitialStateCallData(),
        blockNumber,
      )
    ).map(d => d.returnData) as [
      Address,
      Address,
      bigint,
      bigint,
      ...Address[],
    ];

    const [
      synthetixAddress,
      exchangerAddress,
      exchangeRatesAddress,
      systemStatusAddress,
      weth,
      uniswapV3Factory,
      defaultPoolFee,
      ...synthCurrencyKeys
    ] = (
      await this.multiWrapper.tryAggregate<string | number | bigint>(
        true,
        this._buildResolverAggregatorAndCurrencyCallData(
          targetAddress,
          dexPriceAggregatorAddress,
          synthsAddresses,
        ),
        blockNumber,
      )
    ).map(d => d.returnData) as [
      Address,
      Address,
      Address,
      Address,
      Address,
      Address,
      bigint,
      ...string[],
    ];

    _require(
      synthCurrencyKeys.length === this.config.synths.length,
      `Number of currencyKeys=${synthCurrencyKeys.length} doesn't match the number of synth=${this.config.synths.length} in config`,
    );

    const addressToKey = this.config.synths.reduce<Record<Address, string>>(
      (acc, curr, i) => {
        const _tokenAddress = curr.address.toLowerCase();
        acc[_tokenAddress] = synthCurrencyKeys[i];
        return acc;
      },
      {},
    );

    // This packCounter value updated automatically and used later to make difference between different value in array
    let [packCounter, flexibleStorageCurrencyCallData] =
      this._buildFlexibleStorageCurrencyCallData(
        synthCurrencyKeys,
        exchangeRatesAddress,
      );

    const results = (
      await this.multiWrapper.tryAggregate<
        bigint | boolean | string | number | bigint[]
      >(true, flexibleStorageCurrencyCallData, blockNumber)
    ).map(d => d.returnData);

    const exchangeDynamicFeeConfigResult = results.pop() as bigint[];
    const exchangeDynamicFeeConfig = {
      threshold: exchangeDynamicFeeConfigResult[0],
      weightDecay: exchangeDynamicFeeConfigResult[1],
      rounds: exchangeDynamicFeeConfigResult[2],
      maxFee: exchangeDynamicFeeConfigResult[3],
    };

    const atomicExchangeFeeRate: Record<string, bigint> = {};
    const exchangeFeeRate: Record<string, bigint> = {};
    const pureChainlinkPriceForAtomicSwapsEnabled: Record<string, boolean> = {};
    const atomicEquivalentForDexPricing: Record<string, Token> = {};
    const aggregatorsAddresses: Record<string, Address> = {};
    const aggregatorDecimals: Record<string, number> = {};

    _.chunk(results, packCounter).map((result, i) => {
      const currencyKey = synthCurrencyKeys[i];
      const [
        atomicExchangeFeeRateValue,
        exchangeFeeRateValue,
        pureChainlinkPriceForAtomicSwapsEnabledValue,
        atomicEquivalentForDexPricingValue,
        aggregatorAddress,
        aggregatorDecimal,
      ] = result as [bigint, bigint, boolean, Address, Address, number];

      atomicExchangeFeeRate[currencyKey] = atomicExchangeFeeRateValue;
      exchangeFeeRate[currencyKey] = exchangeFeeRateValue;
      pureChainlinkPriceForAtomicSwapsEnabled[currencyKey] =
        pureChainlinkPriceForAtomicSwapsEnabledValue;
      atomicEquivalentForDexPricing[currencyKey] = {
        address: atomicEquivalentForDexPricingValue,
        decimals: 0,
      };
      aggregatorsAddresses[currencyKey] = aggregatorAddress;
      aggregatorDecimals[currencyKey] = aggregatorDecimal;
    });

    const atomicEquivalentForDexPricingWithoutZeros = Object.entries(
      atomicEquivalentForDexPricing,
    ).reduce<Record<string, Token>>((acc, curr) => {
      const [key, token] = curr;
      if (token.address !== NULL_ADDRESS) {
        acc[key] = token;
      }
      return acc;
    }, {});

    const tokenAddressesForCombination = Object.values(
      atomicEquivalentForDexPricingWithoutZeros,
    ).map(t => t.address);

    // This thing just to create all possible combinations of addresses skipping the order
    const poolKeyCombinations: PoolKey[] = tokenAddressesForCombination.flatMap(
      (address0, i) =>
        tokenAddressesForCombination
          .slice(i + 1)
          .map(address1 =>
            dexPriceAggregatorUniswapV3.getPoolKey(address0, address1, 0n),
          ),
    );

    const overriddenPoolAndDecimals = (
      await this.multiWrapper.tryAggregate<number | string>(
        true,
        this._buildOverriddenAndDecimalsCallData(
          poolKeyCombinations,
          dexPriceAggregatorAddress,
          atomicEquivalentForDexPricing,
        ),
        blockNumber,
      )
    ).map(d => d.returnData);

    const overriddenPools = overriddenPoolAndDecimals.slice(
      0,
      poolKeyCombinations.length,
    ) as Address[];

    const overriddenPoolForRoute = overriddenPools.reduce<
      Record<string, Address>
    >((acc, curr, i) => {
      acc[
        dexPriceAggregatorUniswapV3.identifyRouteFromPoolKey(
          poolKeyCombinations[i],
        )
      ] = curr;
      return acc;
    }, {});

    const equivalentDecimals = overriddenPoolAndDecimals.slice(
      poolKeyCombinations.length,
    ) as number[];

    Object.values(atomicEquivalentForDexPricing).forEach((t, i) => {
      t.decimals = equivalentDecimals[i];
    });

    const addressesFromPK = poolKeyCombinations
      .map(pk => {
        pk.fee = defaultPoolFee;
        return pk;
      })
      .map(pk =>
        dexPriceAggregatorUniswapV3.getPoolForRoute(
          uniswapV3Factory,
          overriddenPoolForRoute,
          pk,
        ),
      );

    const aggregatorAddressesWithoutZeros = Object.entries(
      aggregatorsAddresses,
    ).reduce<Record<string, Address>>((acc, curr) => {
      const [key, address] = curr;
      if (address !== NULL_ADDRESS) {
        acc[key] = address;
      }
      return acc;
    }, {});

    const [_packCounter, slot0TickCumulativesSuspensionsLatestRoundCallData] =
      this._buildObserveSlot0SuspensionsLatestRoundCallData(
        addressesFromPK,
        aggregatorAddressesWithoutZeros,
        atomicTwapWindow,
        systemStatusAddress,
        addressToKey,
      );

    const slot0TickCumulativesSuspensionsLatestRound = (
      await this.multiWrapper.tryAggregate<
        Record<0 | 1, bigint> | Slot0 | boolean[] | boolean | LatestRoundData
      >(true, slot0TickCumulativesSuspensionsLatestRoundCallData, blockNumber)
    ).map(d => d.returnData) as (
      | Record<0 | 1, bigint>
      | boolean
      | boolean[]
      | LatestRoundData
    )[];

    let addressesFromPKBoundary = addressesFromPK.length * _packCounter;

    const suspensions = slot0TickCumulativesSuspensionsLatestRound.slice(
      addressesFromPKBoundary,
      // Number of suspension requests
      addressesFromPKBoundary + 4,
    );

    const isExchangeSuspended = suspensions[0] as boolean;
    const isSystemSuspended = suspensions[1] as boolean;
    const synthSuspensions = suspensions[2] as boolean[];
    const synthExchangeSuspensions = suspensions[3] as boolean[];

    const areSynthsSuspended = Object.keys(addressToKey).reduce<
      Record<string, boolean>
    >((acc, curr, i) => {
      acc[curr] =
        synthSuspensions[i] === true || synthExchangeSuspensions[i] === true;
      return acc;
    }, {});

    return {
      isExchangeSuspended,
      isSystemSuspended,
      areSynthsSuspended,

      lastUpdatedInMs: Date.now(),

      synthetixAddress,
      exchangerAddress,
      dexPriceAggregatorAddress,

      addressToKey,

      aggregatorDecimals,
      atomicTwapWindow,
      atomicExchangeFeeRate,
      exchangeFeeRate,
      pureChainlinkPriceForAtomicSwapsEnabled,
      atomicEquivalentForDexPricing,

      dexPriceAggregator: {
        weth,
        defaultPoolFee,
        uniswapV3Factory,
        overriddenPoolForRoute,
      },
      poolKeys: poolKeyCombinations.map(pk => {
        pk.fee = defaultPoolFee;
        return pk;
      }),
      aggregatorsAddresses,
      systemStatusAddress,
      exchangeDynamicFeeConfig,
      liquidityEstimationInUSD:
        Number(
          sUSDTotalSupply /
            getBigIntPow(
              this.config.synths.filter(
                s => s.address === this.config.sUSDAddress,
              )[0].decimals,
            ),
        ) * LIQUIDITY_ESTIMATION_FACTOR,
    };
  }

  private _buildObserveSlot0SuspensionsLatestRoundCallData(
    addressesFromPK: Address[],
    aggregatorAddressesWithoutZeros: Record<string, string>,
    atomicTwapWindow: bigint,
    systemStatusAddress: Address,
    addressToKey: Record<string, string>,
  ): [
    number,
    MultiCallParams<
      Record<0 | 1, bigint> | Slot0 | boolean[] | boolean | LatestRoundData
    >[],
  ] {
    let packCounter = 0;
    let callData: MultiCallParams<
      Record<0 | 1, bigint> | Slot0 | boolean[] | boolean | LatestRoundData
    >[] = addressesFromPK
      .map(address => {
        const _callData = [
          {
            target: address,
            callData: this.combinedIface.encodeFunctionData('observe', [
              [atomicTwapWindow, 0n],
            ]),
            decodeFunction: decodeObserveTickCumulatives,
          },
          {
            target: address,
            callData: this.combinedIface.encodeFunctionData('slot0', []),
            decodeFunction: decodeUniswapV3Slot0,
          },
        ];
        packCounter = _callData.length;
        return _callData;
      })
      .flat();

    const currencyKeys = Object.values(addressToKey);
    callData = callData.concat([
      {
        target: systemStatusAddress,
        callData: this.combinedIface.encodeFunctionData(
          'exchangeSuspension',
          [],
        ),
        decodeFunction: exchangeSuspensionDecoder,
      },
      {
        target: systemStatusAddress,
        callData: this.combinedIface.encodeFunctionData('systemSuspended', []),
        decodeFunction: booleanDecode,
      },
      {
        target: systemStatusAddress,
        callData: this.combinedIface.encodeFunctionData('getSynthSuspensions', [
          currencyKeys,
        ]),
        decodeFunction: synthStatusDecoder,
      },
      {
        target: systemStatusAddress,
        callData: this.combinedIface.encodeFunctionData(
          'getSynthExchangeSuspensions',
          [currencyKeys],
        ),
        decodeFunction: synthStatusDecoder,
      },
      ...Object.values(aggregatorAddressesWithoutZeros).map(address => ({
        target: address,
        callData: this.combinedIface.encodeFunctionData('latestRoundData', []),
        decodeFunction: decodeLatestRoundData,
      })),
    ]);
    return [packCounter, callData];
  }

  private _buildObservationsRoundAndOverriddenCallData(
    addressesFromPK: Address[],
    uniswapV3Slot0: Record<Address, Slot0>,
    aggregatorAddressesWithoutZeros: Record<string, string>,
    latestRoundDatas: LatestRoundData[],
  ): [number, MultiCallParams<OracleObservation | string | LatestRoundData>[]] {
    let packCounter = 0;
    const callData = [
      ...addressesFromPK
        .map(address => {
          const _callData = [
            {
              target: address,
              callData: this.combinedIface.encodeFunctionData('observations', [
                uniswapV3Slot0[address].observationIndex,
              ]),
              decodeFunction: decodeOracleObservation,
            },
            {
              target: address,
              callData: this.combinedIface.encodeFunctionData('observations', [
                uniswapV3Slot0[address].observationCardinality !== 0n
                  ? OracleLibrary.getPrevIndex(
                      uniswapV3Slot0[address].observationIndex,
                      uniswapV3Slot0[address].observationCardinality,
                    )
                  : 0n,
              ]),
              decodeFunction: decodeOracleObservation,
            },
          ];
          packCounter = _callData.length;
          return _callData;
        })
        .flat(),
      ...this._buildOverriddenCallData(
        this.onchainConfigValues!.poolKeys,
        this.onchainConfigValues!.dexPriceAggregatorAddress,
      ),
      ...Object.values(aggregatorAddressesWithoutZeros)
        .map((aggregatorAddress, i) =>
          // If exchangeDynamicFeeConfig.rounds === 0, then it will return []
          _.range(
            0,
            Number(this.onchainConfigValues.exchangeDynamicFeeConfig.rounds),
          ).map(round => ({
            target: aggregatorAddress,
            callData: this.combinedIface.encodeFunctionData('getRoundData', [
              latestRoundDatas[i].roundId - BigInt(round),
            ]),
            decodeFunction: decodeLatestRoundData,
          })),
        )
        .flat(),
    ];
    return [packCounter, callData];
  }

  private _buildOneOverriddenCallData(
    dexPriceAggregatorAddress: Address,
    key: PoolKey,
  ) {
    return {
      target: dexPriceAggregatorAddress,
      callData: this.combinedIface.encodeFunctionData(
        'overriddenPoolForRoute',
        [dexPriceAggregatorUniswapV3.identifyRouteFromPoolKey(key)],
      ),
      decodeFunction: addressDecode,
    };
  }

  private _buildOverriddenCallData(
    poolKeyCombinations: PoolKey[],
    dexPriceAggregatorAddress: Address,
  ) {
    return poolKeyCombinations.map((key: PoolKey) =>
      this._buildOneOverriddenCallData(dexPriceAggregatorAddress, key),
    );
  }

  private _buildOverriddenAndDecimalsCallData(
    poolKeyCombinations: PoolKey[],
    dexPriceAggregatorAddress: Address,
    atomicEquivalentForDexPricing: Record<string, Token>,
  ) {
    return [
      ...poolKeyCombinations.map((key: PoolKey) => ({
        target: dexPriceAggregatorAddress,
        callData: this.combinedIface.encodeFunctionData(
          'overriddenPoolForRoute',
          [dexPriceAggregatorUniswapV3.identifyRouteFromPoolKey(key)],
        ),
        decodeFunction: addressDecode,
      })),
      ...Object.values(atomicEquivalentForDexPricing).map(token => ({
        target: token.address,
        callData: this.combinedIface.encodeFunctionData('decimals', []),
        decodeFunction: uint8ToNumber,
      })),
    ];
  }

  private _buildFlexibleStorageCurrencyCallData(
    synthCurrencyKeys: string[],
    exchangeRatesAddress: Address,
  ): [
    number,
    MultiCallParams<bigint | boolean | Address | number | bigint[]>[],
  ] {
    let packCounter = 0;
    const callData = synthCurrencyKeys
      .map(key => {
        const result = [
          {
            target: this.config.flexibleStorage,
            callData: this.combinedIface.encodeFunctionData('getUIntValue', [
              encodeStringToBytes32(SETTING_CONTRACT_NAME),
              ethers.utils.solidityKeccak256(
                ['bytes32', 'bytes32'],
                [encodeStringToBytes32(SETTING_ATOMIC_EXCHANGE_FEE_RATE), key],
              ),
            ]),
            decodeFunction: uint256ToBigInt,
          },
          {
            target: this.config.flexibleStorage,
            callData: this.combinedIface.encodeFunctionData('getUIntValue', [
              encodeStringToBytes32(SETTING_CONTRACT_NAME),
              ethers.utils.solidityKeccak256(
                ['bytes32', 'bytes32'],
                [encodeStringToBytes32(SETTING_EXCHANGE_FEE_RATE), key],
              ),
            ]),
            decodeFunction: uint256ToBigInt,
          },
          {
            target: this.config.flexibleStorage,
            callData: this.combinedIface.encodeFunctionData('getBoolValue', [
              encodeStringToBytes32(SETTING_CONTRACT_NAME),
              ethers.utils.solidityKeccak256(
                ['bytes32', 'bytes32'],
                [
                  encodeStringToBytes32(
                    SETTING_PURE_CHAINLINK_PRICE_FOR_ATOMIC_SWAPS_ENABLED,
                  ),
                  key,
                ],
              ),
            ]),
            decodeFunction: booleanDecode,
          },
          {
            target: this.config.flexibleStorage,
            callData: this.combinedIface.encodeFunctionData('getAddressValue', [
              encodeStringToBytes32(SETTING_CONTRACT_NAME),
              ethers.utils.solidityKeccak256(
                ['bytes32', 'bytes32'],
                [
                  encodeStringToBytes32(
                    SETTING_ATOMIC_EQUIVALENT_FOR_DEX_PRICING,
                  ),
                  key,
                ],
              ),
            ]),
            decodeFunction: addressDecode,
          },
          {
            target: exchangeRatesAddress,
            callData: this.combinedIface.encodeFunctionData('aggregators', [
              key,
            ]),
            decodeFunction: addressDecode,
          },
          {
            target: exchangeRatesAddress,
            callData: this.combinedIface.encodeFunctionData(
              'currencyKeyDecimals',
              [key],
            ),
            decodeFunction: uint8ToNumber,
          },
        ];
        packCounter = result.length;
        return result;
      })
      .flat();
    callData.push({
      target: this.config.flexibleStorage,
      callData: this.combinedIface.encodeFunctionData('getUIntValues', [
        encodeStringToBytes32(SETTING_CONTRACT_NAME),
        [
          encodeStringToBytes32(SETTING_EXCHANGE_DYNAMIC_FEE_THRESHOLD),
          encodeStringToBytes32(SETTING_EXCHANGE_DYNAMIC_FEE_WEIGHT_DECAY),
          encodeStringToBytes32(SETTING_EXCHANGE_DYNAMIC_FEE_ROUNDS),
          encodeStringToBytes32(SETTING_EXCHANGE_MAX_DYNAMIC_FEE),
        ],
      ]),
      decodeFunction: uint256ArrayDecode,
    });

    return [packCounter, callData];
  }

  private _buildResolverAggregatorAndCurrencyCallData(
    targetAddress: Address,
    dexPriceAggregatorAddress: Address,
    synthsAddresses: Address[],
  ) {
    return [
      {
        target: targetAddress,
        callData: this.combinedIface.encodeFunctionData('getAddress', [
          encodeStringToBytes32(Contracts.SYNTHETIX),
        ]),
        decodeFunction: addressDecode,
      },
      {
        target: targetAddress,
        callData: this.combinedIface.encodeFunctionData('getAddress', [
          encodeStringToBytes32(Contracts.EXCHANGER),
        ]),
        decodeFunction: addressDecode,
      },
      {
        target: targetAddress,
        callData: this.combinedIface.encodeFunctionData('getAddress', [
          encodeStringToBytes32(Contracts.EXCHANGE_RATES),
        ]),
        decodeFunction: addressDecode,
      },
      {
        target: targetAddress,
        callData: this.combinedIface.encodeFunctionData('getAddress', [
          encodeStringToBytes32(Contracts.SYSTEM_STATUS),
        ]),
        decodeFunction: addressDecode,
      },
      {
        target: dexPriceAggregatorAddress,
        callData: this.combinedIface.encodeFunctionData('weth', []),
        decodeFunction: addressDecode,
      },
      {
        target: dexPriceAggregatorAddress,
        callData: this.combinedIface.encodeFunctionData('uniswapV3Factory', []),
        decodeFunction: addressDecode,
      },
      {
        target: dexPriceAggregatorAddress,
        callData: this.combinedIface.encodeFunctionData('defaultPoolFee', []),
        decodeFunction: uint24ToBigInt,
      },
      ...synthsAddresses.map(address => ({
        target: address,
        callData: this.combinedIface.encodeFunctionData('currencyKey', []),
        decodeFunction: bytes32ToString,
      })),
    ];
  }

  private _buildInitialStateCallData() {
    return [
      {
        target: this.config.readProxyAddressResolver,
        callData: this.combinedIface.encodeFunctionData('target', []),
        decodeFunction: addressDecode,
      },
      {
        target: this.config.flexibleStorage,
        callData: this.combinedIface.encodeFunctionData('getAddressValue', [
          encodeStringToBytes32(EXCHANGE_RATES_CONTRACT_NAME),
          encodeStringToBytes32(SETTING_DEX_PRICE_AGGREGATOR),
        ]),
        decodeFunction: addressDecode,
      },
      {
        target: this.config.flexibleStorage,
        callData: this.combinedIface.encodeFunctionData('getUIntValue', [
          encodeStringToBytes32(SETTING_CONTRACT_NAME),
          encodeStringToBytes32(SETTING_ATOMIC_TWAP_WINDOW),
        ]),
        decodeFunction: uint256ToBigInt,
      },
      {
        target: this.config.sUSDAddress,
        callData: this.combinedIface.encodeFunctionData('totalSupply', []),
        decodeFunction: uint256ToBigInt,
      },
      ...this.config.synths.map(synth => ({
        target: synth.address,
        callData: this.combinedIface.encodeFunctionData('target', []),
        decodeFunction: addressDecode,
      })),
    ];
  }
}

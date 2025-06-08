import { DeepReadonly } from 'ts-essentials';
import { PartialEventSubscriber } from '../../composed-event-subscriber';
import {
  Address,
  BlockHeader,
  Log,
  Logger,
  MultiCallInput,
  MultiCallOutput,
} from '../../types';
import { CBETH, RETH, SFRXETH, STETH } from './constants';
import { Lens } from '../../lens';
import TransmuterABI from '../../abi/angle-transmuter/Transmuter.json';
import TransmuterSidechainABI from '../../abi/angle-transmuter/TransmuterSidechain.json';
import {
  DecodedOracleConfig,
  Chainlink,
  OracleFeed,
  OracleReadType,
  Pyth,
  TransmuterState,
  Fees,
  Oracle,
  CollateralState,
  MaxOracle,
  MorphoOracle,
} from './types';
import _ from 'lodash';
import { ethers } from 'ethers';
import { formatEther, formatUnits, Interface } from 'ethers';
import { filterDictionaryOnly } from './utils';
import { Network } from '../../constants';

export class TransmuterSubscriber<State> extends PartialEventSubscriber<
  State,
  TransmuterState
> {
  static readonly transmuterCrosschainInterface = new Interface(TransmuterABI);
  public readonly interface;

  constructor(
    private EURA: Address,
    private transmuter: Address,
    private collaterals: Address[],
    protected network: number,
    lens: Lens<DeepReadonly<State>, DeepReadonly<TransmuterState>>,
    logger: Logger,
  ) {
    super([transmuter], lens, logger);
    if (network === Network.MAINNET)
      this.interface = new Interface(TransmuterABI);
    else this.interface = new Interface(TransmuterSidechainABI);
  }

  public processLog(
    state: DeepReadonly<TransmuterState>,
    log: Readonly<Log>,
    blockHeader: Readonly<BlockHeader>,
  ): DeepReadonly<TransmuterState> | null {
    try {
      const parsed = this.interface.parseLog(log);

      if (!parsed) return null;

      const _state: TransmuterState = _.cloneDeep(state) as TransmuterState;
      switch (parsed.name) {
        case 'FeesSet':
          return this._handleFeesSet(parsed, _state);
        case 'RedemptionCurveParamsSet':
          return this._handleRedemptionCurveSet(parsed, _state);
        case 'OracleSet':
          return this._handleOracleSet(parsed, _state, blockHeader.number);
        case 'Swap':
          return this._handleSwap(parsed, _state);
        case 'Redeemed':
          return this._handleRedeem(parsed, _state);
        case 'ReservesAdjusted':
          return this._handleAdjustStablecoins(parsed, _state);
        case 'CollateralAdded':
          return this._handleAddCollateral(parsed, _state);
        case 'CollateralRevoked':
          return this._handleRevokeCollateral(parsed, _state);
        case 'CollateralWhitelistStatusUpdated':
          return this._handleSetWhitelistedStatus(parsed, _state);
        case 'WhitelistStatusToggled':
          return this._handleIsWhitelistedForType(parsed, _state);
        case 'StablecoinCapSet':
          return this._handleStablecoinCapSet(parsed, _state);
        default:
          return null;
      }
    } catch (e) {
      this.logger.error('Failed to parse log', e);
      return null;
    }
  }

  public getGenerateStateMultiCallInputs(): MultiCallInput[] {
    const multicallInput = [
      ...this.collaterals.map(collat => ({
        target: this.transmuter,
        callData: this.interface.encodeFunctionData('getIssuedByCollateral', [
          collat,
        ]),
      })),
      ...this.collaterals.map(collat => ({
        target: this.transmuter,
        callData: this.interface.encodeFunctionData('getOracle', [collat]),
      })),
      ...this.collaterals.map(collat => ({
        target: this.transmuter,
        callData: this.interface.encodeFunctionData('getCollateralMintFees', [
          collat,
        ]),
      })),
      ...this.collaterals.map(collat => ({
        target: this.transmuter,
        callData: this.interface.encodeFunctionData('getCollateralBurnFees', [
          collat,
        ]),
      })),
      ...this.collaterals.map(collat => ({
        target: this.transmuter,
        callData: this.interface.encodeFunctionData('isWhitelistedCollateral', [
          collat,
        ]),
      })),
      ...this.collaterals.map(collat => ({
        target: this.transmuter,
        callData: this.interface.encodeFunctionData(
          'getCollateralWhitelistData',
          [collat],
        ),
      })),
    ];
    if (this.network !== Network.MAINNET) {
      multicallInput.push(
        ...this.collaterals.map(collat => ({
          target: this.transmuter,
          callData: this.interface.encodeFunctionData('getStablecoinCap', [
            collat,
          ]),
        })),
      );
    }
    multicallInput.push(
      ...[
        {
          target: this.transmuter,
          callData: this.interface.encodeFunctionData('getRedemptionFees'),
        },
        {
          target: this.transmuter,
          callData: this.interface.encodeFunctionData('getTotalIssued'),
        },
      ],
    );
    return multicallInput;
  }

  public generateState(
    multicallOutputs: MultiCallOutput[],
    blockNumber?: number | 'latest',
  ): DeepReadonly<TransmuterState> {
    const transmuterState = {
      collaterals: {} as {
        [token: string]: CollateralState;
      },
      isWhitelisted: {} as {
        [token: string]: Set<string>;
      },
      totalStablecoinIssued: 0,
      xRedemptionCurve: [],
      yRedemptionCurve: [],
    } as TransmuterState;

    const nbrCollaterals = this.collaterals.length;
    const indexStableIssued = 0;
    const indexOracleFees = 1;
    const indexMintFees = 2;
    const indexBurnFees = 3;
    const indexWhitelistStatus = 4;
    const indexWhitelistData = 5;
    const indexStablecoinCap = 6;

    this.collaterals.forEach(
      (collat: Address, i: number) =>
        (transmuterState.collaterals[collat] = {
          fees: {
            xFeeMint: (
              this.interface.decodeFunctionResult(
                'getCollateralMintFees',
                multicallOutputs[indexMintFees * nbrCollaterals + i],
              )[0] as bigint[]
            ).map(f => Number.parseFloat(formatUnits(f, 9))),
            yFeeMint: (
              this.interface.decodeFunctionResult(
                'getCollateralMintFees',
                multicallOutputs[indexMintFees * nbrCollaterals + i],
              )[1] as bigint[]
            ).map(f => Number.parseFloat(formatUnits(f, 9))),
            xFeeBurn: (
              this.interface.decodeFunctionResult(
                'getCollateralBurnFees',
                multicallOutputs[indexBurnFees * nbrCollaterals + i],
              )[0] as bigint[]
            ).map(f => Number.parseFloat(formatUnits(f, 9))),
            yFeeBurn: (
              this.interface.decodeFunctionResult(
                'getCollateralBurnFees',
                multicallOutputs[indexBurnFees * nbrCollaterals + i],
              )[1] as bigint[]
            ).map(f => Number.parseFloat(formatUnits(f, 9))),
          } as Fees,
          stablecoinsIssued: Number.parseFloat(
            formatUnits(
              this.interface.decodeFunctionResult(
                'getIssuedByCollateral',
                multicallOutputs[indexStableIssued * nbrCollaterals + i],
              )[0],
              18,
            ),
          ),
          stablecoinCap:
            this.network === Network.MAINNET
              ? -1
              : Number.parseFloat(
                  formatUnits(
                    this.interface.decodeFunctionResult(
                      'getStablecoinCap',
                      multicallOutputs[indexStablecoinCap * nbrCollaterals + i],
                    )[0],
                    18,
                  ),
                ),
          config: this._setOracleConfig(
            multicallOutputs[indexOracleFees * nbrCollaterals + i],
          ),
          whitelist: {
            status: this.interface.decodeFunctionResult(
              'isWhitelistedCollateral',
              multicallOutputs[indexWhitelistStatus * nbrCollaterals + i],
            )[0] as boolean,
            data: this.interface.decodeFunctionResult(
              'getCollateralWhitelistData',
              multicallOutputs[indexWhitelistData * nbrCollaterals + i],
            )[0] as string,
          },
        }),
    );
    transmuterState.xRedemptionCurve = (
      this.interface.decodeFunctionResult(
        'getRedemptionFees',
        multicallOutputs[multicallOutputs.length - 2],
      )[0] as bigint[]
    ).map(f => Number.parseFloat(formatUnits(f, 9)));
    transmuterState.yRedemptionCurve = (
      this.interface.decodeFunctionResult(
        'getRedemptionFees',
        multicallOutputs[multicallOutputs.length - 2],
      )[1] as bigint[]
    ).map(f => Number.parseFloat(formatUnits(f, 9)));
    transmuterState.totalStablecoinIssued = Number.parseFloat(
      formatUnits(
        this.interface.decodeFunctionResult(
          'getTotalIssued',
          multicallOutputs[multicallOutputs.length - 1],
        )[0],
        18,
      ),
    );

    return transmuterState;
  }

  /**
   * Update Mint and Burn fees parameters
   */
  _handleFeesSet(
    event: ethers.LogDescription,
    state: TransmuterState,
  ): Readonly<TransmuterState> | null {
    const isMint: boolean = event.args.mint;
    const collateral: string = event.args.collateral;
    const xFee: bigint[] = event.args.xFee;
    const yFee: bigint[] = event.args.yFee;
    if (isMint) {
      state.collaterals[collateral].fees.xFeeMint = xFee.map(f =>
        Number.parseFloat(formatUnits(f, 9)),
      );
      state.collaterals[collateral].fees.yFeeMint = yFee.map(f =>
        Number.parseFloat(formatUnits(f, 9)),
      );
    } else {
      state.collaterals[collateral].fees.xFeeBurn = xFee.map(f =>
        Number.parseFloat(formatUnits(f, 9)),
      );
      state.collaterals[collateral].fees.yFeeBurn = yFee.map(f =>
        Number.parseFloat(formatUnits(f, 9)),
      );
    }
    return state;
  }

  /**
   * Update redemption curve parameters
   */
  _handleRedemptionCurveSet(
    event: ethers.LogDescription,
    state: TransmuterState,
  ): Readonly<TransmuterState> | null {
    const xFee: bigint[] = event.args.xFee;
    const yFee: bigint[] = event.args.yFee;
    state.xRedemptionCurve = xFee.map(f =>
      Number.parseFloat(formatUnits(f, 9)),
    );
    state.yRedemptionCurve = yFee.map(f =>
      Number.parseFloat(formatUnits(f, 9)),
    );
    return state;
  }

  /**
   * Adapt collateral exposure after a swap event
   */
  _handleSwap(
    event: ethers.LogDescription,
    state: TransmuterState,
  ): Readonly<TransmuterState> | null {
    const tokenIn: string = event.args.tokenIn.toLowerCase();
    const tokenOut: string = event.args.tokenOut.toLowerCase();
    // in case of a burn
    if (tokenIn === this.EURA.toLowerCase()) {
      const amount: number = Number.parseFloat(
        formatUnits(event.args.amountIn, 18),
      );
      state.collaterals[tokenOut].stablecoinsIssued -= amount;
      state.totalStablecoinIssued -= amount;
    } else {
      const amount: number = Number.parseFloat(
        formatUnits(event.args.amountOut, 18),
      );
      state.collaterals[tokenIn].stablecoinsIssued += amount;
      state.totalStablecoinIssued += amount;
    }
    return state;
  }

  /**
   * Adapt collateral balances after a redeem event
   */
  _handleRedeem(
    event: ethers.LogDescription,
    state: TransmuterState,
  ): Readonly<TransmuterState> | null {
    const amount: number = Number.parseFloat(
      formatUnits(event.args.amount, 18),
    );
    const currentStablecoinEmission = state.totalStablecoinIssued;
    for (const collat of Object.keys(state.collaterals)) {
      state.collaterals[collat].stablecoinsIssued -=
        (amount / currentStablecoinEmission) *
        state.collaterals[collat].stablecoinsIssued;
    }
    state.totalStablecoinIssued -= amount;

    return state;
  }

  _handleAddCollateral(
    event: ethers.LogDescription,
    state: TransmuterState,
  ): Readonly<TransmuterState> | null {
    this.collaterals.push(event.args.collateral);
    state.collaterals[event.args.collateral] = {} as CollateralState;
    return state;
  }

  _handleRevokeCollateral(
    event: ethers.LogDescription,
    state: TransmuterState,
  ): Readonly<TransmuterState> | null {
    const index = this.collaterals.indexOf(event.args.collateral);
    if (index > -1) this.collaterals.splice(index, 1);
    delete state.collaterals[event.args.collateral];

    return state;
  }

  _handleAdjustStablecoins(
    event: ethers.LogDescription,
    state: TransmuterState,
  ): Readonly<TransmuterState> | null {
    const collateral = event.args.collateral.toLowerCase();
    const isIncrease: boolean = event.args.increase;
    const amount: number =
      Number.parseFloat(formatUnits(event.args.amount, 18)) *
      Number(isIncrease);
    state.totalStablecoinIssued += amount;
    state.collaterals[collateral].stablecoinsIssued += amount;
    return state;
  }

  _handleSetWhitelistedStatus(
    event: ethers.LogDescription,
    state: TransmuterState,
  ): Readonly<TransmuterState> | null {
    const status: number = event.args.whitelistStatus;
    const collateral: string = event.args.collateral;
    const data: string = event.args.whitelistData;
    if (!state.collaterals[collateral])
      state.collaterals[collateral] = {} as CollateralState;
    if (status === 1) state.collaterals[collateral].whitelist.data = data;
    state.collaterals[collateral].whitelist.status = status > 0;
    return state;
  }

  _handleIsWhitelistedForType(
    event: ethers.LogDescription,
    state: TransmuterState,
  ): Readonly<TransmuterState> | null {
    const status: number = event.args.whitelistStatus;
    const who: string = event.args.who;
    const whitelistType: number = event.args.whitelistType;
    if (!state.isWhitelisted[whitelistType])
      state.isWhitelisted[whitelistType] = new Set();
    if (status === 0 && state.isWhitelisted[whitelistType].has(who))
      state.isWhitelisted[whitelistType].delete(who);
    else if (status !== 0 && !state.isWhitelisted[whitelistType].has(who))
      state.isWhitelisted[whitelistType].add(who);
    return state;
  }

  _handleStablecoinCapSet(
    event: ethers.LogDescription,
    state: TransmuterState,
  ): Readonly<TransmuterState> | null {
    const capAmount: number = event.args.stablecoinCap;
    const collateral: string = event.args.collateral;
    state.collaterals[collateral].stablecoinCap = capAmount;
    return state;
  }

  /**
   * Keep track of used oracles for each collaterals
   */
  _handleOracleSet(
    event: ethers.LogDescription,
    state: TransmuterState,
    blockNumber: number,
  ): Readonly<TransmuterState> | null {
    const collateral: string = event.args.collateral;
    const oracleConfig: string = event.args.oracleConfig;

    state.collaterals[collateral].config = this._setOracleConfig(oracleConfig);
    return state;
  }

  /**
   * Keep track of used oracles for each collaterals
   */
  _setOracleConfig(oracleConfig: string): Oracle {
    const configOracle = {} as Oracle;
    const oracleConfigDecoded =
      TransmuterSubscriber._decodeOracleConfig(oracleConfig);

    configOracle.oracleType = oracleConfigDecoded.oracleType;
    configOracle.targetType = oracleConfigDecoded.targetType;
    configOracle.hyperparameters = oracleConfigDecoded.hyperparameters;
    if (oracleConfigDecoded.oracleType === OracleReadType.EXTERNAL) {
      const externalOracle: Address = ethers.AbiCoder.defaultAbiCoder().decode(
        [`address externalOracle`],
        oracleConfigDecoded.oracleData,
      )[0];
      configOracle.externalOracle = externalOracle;
    } else {
      configOracle.oracleFeed = TransmuterSubscriber._decodeOracleFeed(
        oracleConfigDecoded.oracleType,
        oracleConfigDecoded.oracleData,
      );
      configOracle.targetFeed = TransmuterSubscriber._decodeOracleFeed(
        oracleConfigDecoded.targetType,
        oracleConfigDecoded.targetData,
      );
    }
    return configOracle;
  }

  static _decodeOracleConfig(oracleConfig: string): DecodedOracleConfig {
    const oracleConfigDecoded = filterDictionaryOnly(
      ethers.AbiCoder.defaultAbiCoder().decode(
        [
          'uint8 oracleType',
          'uint8 targetType',
          'bytes oracleData',
          'bytes targetData',
          'bytes hyperparameters',
        ],
        oracleConfig,
      ),
    ) as unknown as DecodedOracleConfig;

    return oracleConfigDecoded;
  }

  static _decodeOracleFeed(
    readType: OracleReadType,
    oracleData: string,
  ): OracleFeed {
    if (readType === OracleReadType.CHAINLINK_FEEDS)
      return {
        isChainlink: true,
        isPyth: false,
        isMorpho: false,
        chainlink: TransmuterSubscriber._decodeChainlinkOracle(oracleData),
      };
    if (readType === OracleReadType.PYTH)
      return {
        isChainlink: false,
        isPyth: true,
        isMorpho: false,
        pyth: TransmuterSubscriber._decodePythOracle(oracleData),
      };
    if (readType === OracleReadType.MAX)
      return {
        isChainlink: false,
        isPyth: false,
        isMorpho: false,
        maxValue: TransmuterSubscriber._decodeMaxOracle(oracleData),
      };
    if (readType === OracleReadType.MORPHO_ORACLE)
      return {
        isChainlink: false,
        isPyth: false,
        isMorpho: true,
        morpho: TransmuterSubscriber._decodeMorphoOracle(oracleData),
      };
    if (readType === OracleReadType.WSTETH)
      return {
        isChainlink: false,
        isPyth: false,
        isMorpho: false,
        otherContract: STETH,
      };
    if (readType === OracleReadType.CBETH)
      return {
        isChainlink: false,
        isPyth: false,
        isMorpho: false,
        otherContract: CBETH,
      };
    if (readType === OracleReadType.RETH)
      return {
        isChainlink: false,
        isPyth: false,
        isMorpho: false,
        otherContract: RETH,
      };
    if (readType === OracleReadType.SFRXETH)
      return {
        isChainlink: false,
        isPyth: false,
        isMorpho: false,
        otherContract: SFRXETH,
      };
    return { isChainlink: false, isPyth: false, isMorpho: false };
  }

  static _decodeChainlinkOracle(oracleData: string): Chainlink {
    const chainlinkOracleDecoded = filterDictionaryOnly(
      ethers.AbiCoder.defaultAbiCoder().decode(
        [
          'address[] circuitChainlink',
          'uint32[] stalePeriods',
          'uint8[] circuitChainIsMultiplied',
          'uint8[] chainlinkDecimals',
          'uint8 quoteType',
        ],
        oracleData,
      ),
    ) as unknown as Chainlink;

    return chainlinkOracleDecoded;
  }

  static _decodePythOracle(oracleData: string): Pyth {
    const pythOracleDecoded = filterDictionaryOnly(
      ethers.AbiCoder.defaultAbiCoder().decode(
        [
          'address pyth',
          'bytes32[] feedIds',
          'uint32[] stalePeriods',
          'uint8[] isMultiplied',
          'uint8 quoteType',
        ],
        oracleData,
      ),
    ) as unknown as Pyth;

    return pythOracleDecoded;
  }

  static _decodeMaxOracle(oracleData: string): number {
    const maxOracleDecoded = filterDictionaryOnly(
      ethers.AbiCoder.defaultAbiCoder().decode(
        ['uint256 maxValue'],
        oracleData,
      ),
    ) as unknown as MaxOracle;

    return Number.parseFloat(formatEther(maxOracleDecoded.maxValue));
  }

  static _decodeMorphoOracle(oracleData: string): MorphoOracle {
    const morphoOracleDecoded = filterDictionaryOnly(
      ethers.AbiCoder.defaultAbiCoder().decode(
        ['address oracle', 'uint256 normalizationFactor'],
        oracleData,
      ),
    ) as unknown as MorphoOracle;

    return morphoOracleDecoded;
  }
}

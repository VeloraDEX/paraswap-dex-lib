import { DeepReadonly } from 'ts-essentials';
import { lens } from '../../lens';
import { Address, Logger } from '../../types';
import { ComposedEventSubscriber } from '../../composed-event-subscriber';
import { ChainLinkSubscriber } from '../../lib/chainlink';
import { IDexHelper } from '../../dex-helper/idex-helper';
import {
  ChainlinkConfig,
  DecodedOracleConfig,
  MorphoConfig,
  OracleFeed,
  OracleHyperparameter,
  OracleQuoteType,
  OracleReadType,
  PoolConfig,
  PoolState,
  PythConfig,
  TransmuterParams,
  TransmuterState,
} from './types';
import TransmuterABI from '../../abi/angle-transmuter/Transmuter.json';
import TransmuterSidechainABI from '../../abi/angle-transmuter/TransmuterSidechain.json';
import { Contract } from 'web3-eth-contract';
import { TransmuterSubscriber } from './transmuter';
import { PythSubscriber } from './pyth';
import {
  _quoteBurnExactInput,
  _quoteBurnExactOutput,
  _quoteMintExactInput,
  _quoteMintExactOutput,
  filterDictionaryOnly,
} from './utils';
import { RedstoneSubscriber } from './redstone';
import { formatEther, formatUnits, parseUnits, Interface } from 'ethers';
import { BackedSubscriber } from './backedOracle';
import { Network, SwapSide } from '../../constants';
import { ethers } from 'ethers';
import { MorphoOracleEventPool } from './morphoOracle';
import { bigIntify } from '../../utils';
import { MorphoVaultSubscriber } from './morphoVault';
import _ from 'lodash';

const FORCE_REGENERATE_STATE_INTERVAL_MS = 1000 * 60 * 60 * 24; // 24h

export class AngleTransmuterEventPool extends ComposedEventSubscriber<PoolState> {
  public transmuter: Contract;
  public readonly angleTransmuterIface;
  readonly config: PoolConfig;
  timer: NodeJS.Timeout;

  constructor(
    readonly parentName: string,
    protected network: number,
    protected dexHelper: IDexHelper,
    logger: Logger,
    config: PoolConfig,
  ) {
    const chainlinkMap = Object.entries(config.oracles.chainlink).reduce(
      (
        acc: { [address: string]: ChainLinkSubscriber<PoolState> },
        [key, value],
      ) => {
        acc[key] = new ChainLinkSubscriber<PoolState>(
          value.proxy,
          value.aggregator,
          lens<DeepReadonly<PoolState>>().oracles.chainlink[key],
          dexHelper.getLogger(`${key} ChainLink for ${parentName}-${network}`),
        );
        return acc;
      },
      {},
    );
    const backedMap = Object.entries(config.oracles.backed).reduce(
      (
        acc: { [address: string]: BackedSubscriber<PoolState> },
        [key, value],
      ) => {
        acc[key] = new BackedSubscriber<PoolState>(
          value.proxy,
          value.aggregator,
          lens<DeepReadonly<PoolState>>().oracles.chainlink[key],
          dexHelper.getLogger(`${key} ChainLink for ${parentName}-${network}`),
        );
        return acc;
      },
      {},
    );

    const redstoneMap = Object.entries(config.oracles.redstone).reduce(
      (
        acc: { [address: string]: RedstoneSubscriber<PoolState> },
        [key, value],
      ) => {
        acc[key] = new RedstoneSubscriber<PoolState>(
          value.proxy,
          value.aggregator,
          lens<DeepReadonly<PoolState>>().oracles.chainlink[key],
          dexHelper.getLogger(`${key} ChainLink for ${parentName}-${network}`),
        );
        return acc;
      },
      {},
    );

    const morphoMap = Object.entries(config.oracles.morpho).reduce(
      (
        acc: { [address: string]: MorphoVaultSubscriber<PoolState> },
        [key, value],
      ) => {
        if (value.baseVault && value.baseVault !== ethers.ZeroAddress)
          acc[value.baseVault] = new MorphoVaultSubscriber<PoolState>(
            value.baseVault,
            lens<DeepReadonly<PoolState>>().oracles.morphoVault[
              value.baseVault
            ],
            dexHelper.getLogger(
              `${key}:${value.baseVault} Morpho Vault for ${parentName}-${network}`,
            ),
          );
        if (value.quoteVault && value.quoteVault !== ethers.ZeroAddress)
          acc[value.quoteVault] = new MorphoVaultSubscriber<PoolState>(
            value.quoteVault,
            lens<DeepReadonly<PoolState>>().oracles.morphoVault[
              value.quoteVault
            ],
            dexHelper.getLogger(
              `${key}:${value.quoteVault} Morpho Vault for ${parentName}-${network}`,
            ),
          );
        return acc;
      },
      {},
    );

    const pythListener: PythSubscriber<PoolState>[] = [];
    if (!_.isEmpty(config.oracles.pyth)) {
      pythListener[0] = new PythSubscriber<PoolState>(
        config.oracles.pyth.proxy,
        config.oracles.pyth.ids,
        lens<DeepReadonly<PoolState>>().oracles.pyth,
        dexHelper.getLogger(`Pyth for ${parentName}-${network}`),
      );
    }

    const transmuterListener = new TransmuterSubscriber(
      config.stablecoin.address,
      config.transmuter,
      config.collaterals,
      network,
      lens<DeepReadonly<PoolState>>().transmuter,
      dexHelper.getLogger(`${parentName}-${network} Transmuter`),
    );

    super(
      parentName,
      'Transmuter',
      dexHelper.getLogger(`${parentName}-${network}`),
      dexHelper,
      [
        ...Object.values(chainlinkMap),
        ...Object.values(backedMap),
        ...Object.values(redstoneMap),
        ...Object.values(morphoMap),
        transmuterListener,
        ...pythListener,
      ],
      {
        stablecoin: config.stablecoin,
        transmuter: {} as TransmuterState,
        oracles: { chainlink: {}, pyth: {}, morphoVault: {} },
      },
    );

    this.angleTransmuterIface =
      network === Network.MAINNET
        ? new Interface(TransmuterABI)
        : new Interface(TransmuterSidechainABI);
    this.transmuter = new this.dexHelper.web3Provider.eth.Contract(
      TransmuterABI as any,
      config.transmuter,
    );

    this.config = config;

    // some oracles don't emit events (redstone), need to regenerate state after some period of time. 1 day should provide up-to-date info
    this.timer = setInterval(() => {
      const blockNumber = this.dexHelper.blockManager.getLatestBlockNumber();
      this.generateState(blockNumber).then(newState =>
        this.setState(newState, blockNumber),
      );
    }, FORCE_REGENERATE_STATE_INTERVAL_MS);
  }

  releaseResources(): void {
    clearInterval(this.timer);
  }

  async getStateOrGenerate(blockNumber: number): Promise<Readonly<PoolState>> {
    const evenState = this.getState(blockNumber);
    if (evenState) return evenState as PoolState;
    const onChainState = await this.generateState(blockNumber);
    this.setState(onChainState, blockNumber);
    return onChainState as PoolState;
  }

  async generateState(blockNumber: number): Promise<DeepReadonly<PoolState>> {
    const state = (await super.generateState(blockNumber)) as PoolState;
    return this.stateToLowercase(state);
  }

  private stateToLowercase(state: PoolState): PoolState {
    return {
      oracles: state.oracles,
      stablecoin: {
        ...state.stablecoin,
        address: state.stablecoin.address.toLowerCase(),
      },
      transmuter: {
        ...state.transmuter,
        collaterals: Object.fromEntries(
          Object.entries(state.transmuter.collaterals).map(([k, v]) => [
            k.toLowerCase(),
            v,
          ]),
        ),
      },
    };
  }

  // Reference to the original implementation
  // https://github.com/AngleProtocol/angle-transmuter/blob/6e1f2eb1f961d6c3b1cdaefe068d967c33c41936/contracts/transmuter/facets/Swapper.sol#L177
  async getAmountOut(
    _tokenIn: Address,
    _tokenOut: Address,
    side: SwapSide,
    _amounts: number[],
    blockNumber: number,
  ): Promise<number[] | null> {
    const state = await this.getStateOrGenerate(blockNumber);
    const isMint = _tokenOut === state.stablecoin.address;
    let oracleValue: number;
    let minRatio = 0;
    let collateral = _tokenIn;
    if (isMint)
      oracleValue = await this._readMint(
        this.config,
        state,
        _tokenIn,
        blockNumber,
      );
    else {
      collateral = _tokenOut;
      ({ oracleValue, minRatio } = await this._getBurnOracle(
        this.config,
        state,
        _tokenOut,
        blockNumber,
      ));
    }

    const collatStablecoinIssued =
      state.transmuter.collaterals[collateral].stablecoinsIssued;
    const otherStablecoinIssued =
      state.transmuter.totalStablecoinIssued - collatStablecoinIssued;
    const fees = state.transmuter.collaterals[collateral].fees;
    const stablecoinCap =
      state.transmuter.collaterals[collateral].stablecoinCap;

    return _amounts.map(_amount => {
      if (isMint && side === SwapSide.SELL)
        return _quoteMintExactInput(
          oracleValue,
          _amount,
          fees,
          collatStablecoinIssued,
          otherStablecoinIssued,
          stablecoinCap,
        );
      if (isMint && side === SwapSide.BUY)
        return _quoteMintExactOutput(
          oracleValue,
          _amount,
          fees,
          collatStablecoinIssued,
          otherStablecoinIssued,
          stablecoinCap,
        );
      if (!isMint && side === SwapSide.SELL)
        return _quoteBurnExactInput(
          oracleValue,
          minRatio,
          _amount,
          fees,
          collatStablecoinIssued,
          otherStablecoinIssued,
        );
      return _quoteBurnExactOutput(
        oracleValue,
        minRatio,
        _amount,
        fees,
        collatStablecoinIssued,
        otherStablecoinIssued,
      );
    });
  }

  static async getCollateralsList(
    transmuterAddress: Address,
    blockNumber: number | 'latest',
    multiContract: Contract,
  ) {
    const tokensResult = (
      await multiContract.methods
        .aggregate([
          {
            target: transmuterAddress,
            callData:
              TransmuterSubscriber.transmuterCrosschainInterface.encodeFunctionData(
                'getCollateralList',
              ),
          },
        ])
        .call({}, blockNumber)
    ).returnData;
    const tokens: Address[] =
      TransmuterSubscriber.transmuterCrosschainInterface.decodeFunctionResult(
        'getCollateralList',
        tokensResult[0],
      )[0];
    // .map((t: any) => t.toLowerCase());
    return tokens;
  }

  static async _fillMap(
    chainlinkMap: ChainlinkConfig,
    backedMap: ChainlinkConfig,
    redstoneMap: ChainlinkConfig,
    pythIds: PythConfig,
    morphoMap: MorphoConfig,
    oracleFeed: OracleFeed,
    blockNumber: number | 'latest',
    multiContract: Contract,
  ): Promise<{
    chainlinkMap: ChainlinkConfig;
    backedMap: ChainlinkConfig;
    redstoneMap: ChainlinkConfig;
    pythIds: PythConfig;
    morphoMap: MorphoConfig;
  }> {
    if (oracleFeed.isChainlink) {
      await Promise.all(
        oracleFeed.chainlink!.circuitChainlink.map(async feed => {
          ({ chainlinkMap, backedMap, redstoneMap } =
            await AngleTransmuterEventPool.generateStateChainlinkLike(
              feed,
              chainlinkMap,
              backedMap,
              redstoneMap,
              blockNumber,
              multiContract,
            ));
        }),
      );
    } else if (oracleFeed.isPyth) {
      pythIds.ids = pythIds.ids.concat(oracleFeed.pyth!.feedIds);
    } else if (oracleFeed.isMorpho) {
      const morphoOracleResult = (
        await multiContract.methods
          .aggregate(
            MorphoOracleEventPool.getGenerateInfoMultiCallInput(
              oracleFeed.morpho!.oracle,
            ),
          )
          .call({}, blockNumber)
      ).returnData;
      const morphoOracleInfo =
        MorphoOracleEventPool.generateInfo(morphoOracleResult);
      if (morphoOracleInfo.baseFeed1 !== ethers.ZeroAddress)
        ({ chainlinkMap, backedMap, redstoneMap } =
          await AngleTransmuterEventPool.generateStateChainlinkLike(
            morphoOracleInfo.baseFeed1,
            chainlinkMap,
            backedMap,
            redstoneMap,
            blockNumber,
            multiContract,
          ));
      if (morphoOracleInfo.baseFeed2 !== ethers.ZeroAddress)
        ({ chainlinkMap, backedMap, redstoneMap } =
          await AngleTransmuterEventPool.generateStateChainlinkLike(
            morphoOracleInfo.baseFeed2,
            chainlinkMap,
            backedMap,
            redstoneMap,
            blockNumber,
            multiContract,
          ));
      if (morphoOracleInfo.quoteFeed1 !== ethers.ZeroAddress)
        ({ chainlinkMap, backedMap, redstoneMap } =
          await AngleTransmuterEventPool.generateStateChainlinkLike(
            morphoOracleInfo.quoteFeed1,
            chainlinkMap,
            backedMap,
            redstoneMap,
            blockNumber,
            multiContract,
          ));
      if (morphoOracleInfo.quoteFeed2 !== ethers.ZeroAddress)
        ({ chainlinkMap, backedMap, redstoneMap } =
          await AngleTransmuterEventPool.generateStateChainlinkLike(
            morphoOracleInfo.quoteFeed2,
            chainlinkMap,
            backedMap,
            redstoneMap,
            blockNumber,
            multiContract,
          ));
      morphoMap[oracleFeed.morpho!.oracle] = morphoOracleInfo;
    } else {
      throw new Error('Unknown oracle feed');
    }
    return { chainlinkMap, backedMap, redstoneMap, pythIds, morphoMap };
  }

  static async generateStateChainlinkLike(
    feed: string,
    chainlinkMap: ChainlinkConfig,
    backedMap: ChainlinkConfig,
    redstoneMap: ChainlinkConfig,
    blockNumber: number | 'latest',
    multiContract: Contract,
  ): Promise<{
    chainlinkMap: ChainlinkConfig;
    backedMap: ChainlinkConfig;
    redstoneMap: ChainlinkConfig;
  }> {
    let aggreagator: Address;
    let decimals: number;
    // it can be Chainlink or Redstone feed
    // if the call getReadAggregatorMultiCallInput fail with a Chainlink instance
    // then it is a Redstone one
    try {
      // Chainlink
      const proxyResult = (
        await multiContract.methods
          .aggregate([
            ChainLinkSubscriber.getReadAggregatorMultiCallInput(feed),
            ChainLinkSubscriber.getReadDecimal(feed),
          ])
          .call({}, blockNumber)
      ).returnData;
      aggreagator = ChainLinkSubscriber.readAggregator(proxyResult[0]);
      decimals = Number(ChainLinkSubscriber.readDecimals(proxyResult[1]));
      chainlinkMap[feed] = {
        proxy: feed,
        aggregator: aggreagator,
        decimals: decimals,
      };
    } catch {
      try {
        // Redstone
        const proxyResult = (
          await multiContract.methods
            .aggregate([
              RedstoneSubscriber.getReadAggregatorMultiCallInput(feed),
              RedstoneSubscriber.getReadDecimal(feed),
            ])
            .call({}, blockNumber)
        ).returnData;
        aggreagator = RedstoneSubscriber.readAggregator(proxyResult[0]);
        decimals = Number(RedstoneSubscriber.readDecimals(proxyResult[1]));
        redstoneMap[feed] = {
          proxy: feed,
          aggregator: aggreagator,
          decimals: decimals,
        };
      } catch {
        // Backed
        const proxyResult = (
          await multiContract.methods
            .aggregate([ChainLinkSubscriber.getReadDecimal(feed)])
            .call({}, blockNumber)
        ).returnData;
        decimals = Number(ChainLinkSubscriber.readDecimals(proxyResult[0]));
        backedMap[feed] = {
          proxy: feed,
          aggregator: feed,
          decimals: decimals,
        };
      }
    }
    return { chainlinkMap, backedMap, redstoneMap };
  }

  static async getOraclesConfig(
    transmuterAddress: Address,
    pythAddress: Address,
    collaterals: Address[],
    blockNumber: number | 'latest',
    multiContract: Contract,
  ) {
    const getOracleConfigData = collaterals.map(collat => {
      return {
        callData:
          TransmuterSubscriber.transmuterCrosschainInterface.encodeFunctionData(
            'getOracle',
            [collat],
          ),
        target: transmuterAddress,
      };
    });
    const oracleConfigResult = (
      await multiContract.methods
        .aggregate(getOracleConfigData)
        .call({}, blockNumber)
    ).returnData;

    const oracleConfigs: DecodedOracleConfig[] = oracleConfigResult.map(
      (p: any) =>
        TransmuterSubscriber.transmuterCrosschainInterface.decodeFunctionResult(
          'getOracle',
          p,
        ),
    );

    let chainlinkMap: ChainlinkConfig = {} as ChainlinkConfig;
    let backedMap: ChainlinkConfig = {} as ChainlinkConfig;
    let redstoneMap: ChainlinkConfig = {} as ChainlinkConfig;
    let pythIds: PythConfig = { proxy: pythAddress, ids: [] } as PythConfig;
    let morphoMap: MorphoConfig = {} as MorphoConfig;

    await Promise.all(
      oracleConfigs.map(async oracleConfigDecoded => {
        if (oracleConfigDecoded.oracleType !== OracleReadType.EXTERNAL) {
          // add all the feed oracles used to their respective channels
          if (
            oracleConfigDecoded.oracleType === OracleReadType.CHAINLINK_FEEDS ||
            oracleConfigDecoded.oracleType === OracleReadType.PYTH ||
            oracleConfigDecoded.oracleType === OracleReadType.MORPHO_ORACLE
          ) {
            const oracleFeed = TransmuterSubscriber._decodeOracleFeed(
              oracleConfigDecoded.oracleType,
              oracleConfigDecoded.oracleData,
            );
            ({ chainlinkMap, backedMap, redstoneMap, pythIds, morphoMap } =
              await AngleTransmuterEventPool._fillMap(
                chainlinkMap,
                backedMap,
                redstoneMap,
                pythIds,
                morphoMap,
                oracleFeed,
                blockNumber,
                multiContract,
              ));
          }
          if (
            oracleConfigDecoded.targetType === OracleReadType.CHAINLINK_FEEDS ||
            oracleConfigDecoded.targetType === OracleReadType.PYTH ||
            oracleConfigDecoded.targetType === OracleReadType.MORPHO_ORACLE
          ) {
            const oracleFeed = TransmuterSubscriber._decodeOracleFeed(
              oracleConfigDecoded.targetType,
              oracleConfigDecoded.targetData,
            );
            ({ chainlinkMap, backedMap, redstoneMap, pythIds, morphoMap } =
              await AngleTransmuterEventPool._fillMap(
                chainlinkMap,
                backedMap,
                redstoneMap,
                pythIds,
                morphoMap,
                oracleFeed,
                blockNumber,
                multiContract,
              ));
          }
        }
      }),
    );
    return {
      chainlink: chainlinkMap,
      backed: backedMap,
      redstone: redstoneMap,
      pyth: pythIds,
      morpho: morphoMap,
    };
  }

  static async getConfig(
    dexParams: TransmuterParams,
    blockNumber: number | 'latest',
    multiContract: Contract,
  ): Promise<PoolConfig> {
    const collaterals = await AngleTransmuterEventPool.getCollateralsList(
      dexParams.transmuter,
      blockNumber,
      multiContract,
    );

    // get all oracles feed
    const oracles = await AngleTransmuterEventPool.getOraclesConfig(
      dexParams.transmuter,
      dexParams.pyth!,
      collaterals,
      blockNumber,
      multiContract,
    );

    return {
      stablecoin: dexParams.stablecoin,
      transmuter: dexParams.transmuter,
      collaterals: collaterals.map(el => el.toLowerCase()),
      oracles: oracles,
    };
  }

  /*//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                       UTILS                                                      
  //////////////////////////////////////////////////////////////////////////////////////////////////////////////////*/

  _readMint(
    config: PoolConfig,
    state: PoolState,
    collateral: Address,
    blockNumber: number,
  ): number {
    const configOracle = state.transmuter.collaterals[collateral].config;
    if (configOracle.oracleType === OracleReadType.EXTERNAL) {
      return 1;
    }
    let target: number;
    let spot: number;
    ({ spot, target } = this._readSpotAndTarget(
      config,
      state,
      collateral,
      blockNumber,
    ));

    if (target < spot) spot = target;
    return spot;
  }

  _getBurnOracle(
    config: PoolConfig,
    state: PoolState,
    collateral: Address,
    blockNumber: number,
  ): { oracleValue: number; minRatio: number } {
    return config.collaterals.reduce(
      (
        acc: { oracleValue: number; minRatio: number },
        comparedCollat: string,
        j: number,
      ) => {
        let ratio: number;
        if (comparedCollat.toLowerCase() === collateral.toLowerCase()) {
          let oracleValue: number;
          ({ oracleValue, ratio } = this._readBurn(
            config,
            state,
            comparedCollat,
            blockNumber,
          ));
          acc.oracleValue = oracleValue;
        } else
          ({ ratio } = this._readBurn(
            config,
            state,
            comparedCollat,
            blockNumber,
          ));
        if (ratio < acc.minRatio) acc.minRatio = ratio;
        return acc;
      },
      { oracleValue: 0, minRatio: 1 },
    );
  }

  _readBurn(
    config: PoolConfig,
    state: PoolState,
    collateral: Address,
    blockNumber: number,
  ): { oracleValue: number; ratio: number } {
    const configOracle = state.transmuter.collaterals[collateral].config;
    if (configOracle.oracleType === OracleReadType.EXTERNAL) {
      return { oracleValue: 1, ratio: 1 };
    }
    let spot: number;
    let target: number;
    let burnRatioDeviation: number;
    ({ spot, target, burnRatioDeviation } = this._readSpotAndTarget(
      config,
      state,
      collateral,
      blockNumber,
    ));

    let ratio = 1;
    if (spot < target * (1 - burnRatioDeviation)) ratio = spot / target;
    else if (spot < target) spot = target;
    return { oracleValue: spot, ratio };
  }

  _readSpotAndTarget(
    config: PoolConfig,
    state: PoolState,
    collateral: Address,
    blockNumber: number,
  ): {
    spot: number;
    target: number;
    userDeviation: number;
    burnRatioDeviation: number;
  } {
    const configOracle = state.transmuter.collaterals[collateral].config;
    const hyperparameters = filterDictionaryOnly(
      ethers.AbiCoder.defaultAbiCoder().decode(
        ['uint128 userDeviation', 'uint128 burnRatioDeviation'],
        configOracle.hyperparameters,
      ),
    ) as unknown as OracleHyperparameter;
    const userDeviation = Number.parseFloat(
      formatEther(hyperparameters.userDeviation.toString()),
    );
    const burnRatioDeviation = Number.parseFloat(
      formatEther(hyperparameters.burnRatioDeviation.toString()),
    );
    const targetPrice = this._read(
      config,
      state,
      configOracle.targetType,
      configOracle.targetFeed,
      1,
    );
    let oracleValue = this._read(
      config,
      state,
      configOracle.oracleType,
      configOracle.oracleFeed,
      targetPrice,
    );

    if (
      targetPrice * (1 - userDeviation) < oracleValue &&
      oracleValue < targetPrice * (1 + userDeviation)
    )
      oracleValue = targetPrice;
    return {
      spot: oracleValue,
      target: targetPrice,
      userDeviation,
      burnRatioDeviation,
    };
  }

  _quoteAmount(quoteType: OracleQuoteType, baseValue: number): number {
    if (quoteType === OracleQuoteType.UNIT) return 1;
    return baseValue;
  }

  _read(
    config: PoolConfig,
    state: PoolState,
    oracleType: OracleReadType,
    feed: OracleFeed,
    baseValue: number,
  ): number {
    let price = 1;
    if (oracleType === OracleReadType.CHAINLINK_FEEDS) {
      price = this._quoteAmount(feed.chainlink!.quoteType, baseValue);
      for (let i = 0; i < feed.chainlink!.circuitChainlink.length; i++) {
        ({ price } = this._readChainlink(
          config,
          state,
          feed.chainlink!.circuitChainlink[i],
          feed.chainlink!.circuitChainIsMultiplied[i],
          price,
        ));
      }
    } else if (oracleType === OracleReadType.PYTH) {
      price = this._quoteAmount(feed.pyth!.quoteType, baseValue);
      for (let i = 0; i < feed.pyth!.feedIds.length; i++) {
        const id = feed.pyth!.feedIds[i];
        const rate = state.oracles.pyth[id].answer;
        if (feed.pyth!.isMultiplied[i] === 1) price *= rate;
        else price /= rate;
      }
    } else if (oracleType === OracleReadType.STABLE) {
      price = 1;
    } else if (oracleType === OracleReadType.NO_ORACLE) {
      price = baseValue;
    } else if (oracleType == OracleReadType.MAX) {
      price = feed.maxValue!;
    } else if (oracleType == OracleReadType.MORPHO_ORACLE) {
      const morphoOracleConfig = config.oracles.morpho[feed.morpho!.oracle];
      const baseVaultPrice =
        morphoOracleConfig.baseVault !== ethers.ZeroAddress
          ? (morphoOracleConfig.baseVaultConversion *
              state.oracles.morphoVault[morphoOracleConfig.baseVault]
                .totalAssets) /
            state.oracles.morphoVault[morphoOracleConfig.baseVault].totalSupply
          : 1n;
      const quoteVaultPrice =
        morphoOracleConfig.quoteVault !== ethers.ZeroAddress
          ? (morphoOracleConfig.quoteVaultConversion *
              state.oracles.morphoVault[morphoOracleConfig.quoteVault]
                .totalAssets) /
            state.oracles.morphoVault[morphoOracleConfig.quoteVault].totalSupply
          : 1n;
      const baseFeed1Price =
        morphoOracleConfig.baseFeed1 !== ethers.ZeroAddress
          ? this._readMorphoFeedChainlink(
              config,
              state,
              morphoOracleConfig.baseFeed1,
            )
          : 1n;
      const baseFeed2Price =
        morphoOracleConfig.baseFeed2 !== ethers.ZeroAddress
          ? this._readMorphoFeedChainlink(
              config,
              state,
              morphoOracleConfig.baseFeed2,
            )
          : 1n;
      const quoteFeed1Price =
        morphoOracleConfig.quoteFeed1 !== ethers.ZeroAddress
          ? this._readMorphoFeedChainlink(
              config,
              state,
              morphoOracleConfig.quoteFeed1,
            )
          : 1n;
      const quoteFeed2Price =
        morphoOracleConfig.quoteFeed2 !== ethers.ZeroAddress
          ? this._readMorphoFeedChainlink(
              config,
              state,
              morphoOracleConfig.quoteFeed2,
            )
          : 1n;
      price = Number.parseFloat(
        formatUnits(
          (morphoOracleConfig.scaleFactor *
            baseVaultPrice *
            baseFeed1Price *
            baseFeed2Price) /
            quoteVaultPrice /
            quoteFeed1Price /
            quoteFeed2Price,
          36,
        ),
      );
    }
    return price;
  }

  _readChainlink(
    config: PoolConfig,
    state: PoolState,
    id: string,
    isMultiplied: number,
    price: number,
  ): { price: number; decimals: number } {
    let decimals: number;
    if (Object.keys(config.oracles.chainlink).includes(id))
      decimals = config.oracles.chainlink[id].decimals;
    else if (Object.keys(config.oracles.redstone).includes(id))
      decimals = config.oracles.redstone[id].decimals;
    else decimals = config.oracles.backed[id].decimals;
    const rate = Number.parseFloat(
      formatUnits(state.oracles.chainlink[id].answer.toString(), decimals),
    );
    if (isMultiplied === 1) price *= rate;
    else price /= rate;
    return { price, decimals };
  }

  _readMorphoFeedChainlink(
    config: PoolConfig,
    state: PoolState,
    id: string,
  ): bigint {
    const { price, decimals } = this._readChainlink(config, state, id, 1, 1);
    return bigIntify(parseUnits(price.toString(), decimals));
  }
}

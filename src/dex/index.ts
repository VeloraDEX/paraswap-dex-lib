import _ from 'lodash';
import { UnoptimizedRate } from '../types';
import { CurveV2 } from './curve-v2/curve-v2';
import { IDexTxBuilder, DexConstructor, IDex, IRouteOptimizer } from './idex';
import { JarvisV6 } from './jarvis-v6/jarvis-v6';
import { StablePool } from './stable-pool/stable-pool';
import { Weth } from './weth/weth';
import { PolygonMigrator } from './polygon-migrator/polygon-migrator';
import { UniswapV3 } from './uniswap-v3/uniswap-v3';
import { BalancerV2 } from './balancer-v2/balancer-v2';
import { balancerV2Merge } from './balancer-v2/optimizer';
import { UniswapV2 } from './uniswap-v2/uniswap-v2';
import { UniswapV2Alias } from './uniswap-v2/constants';
import { uniswapMerge } from './uniswap-v2/optimizer';
import { BiSwap } from './uniswap-v2/biswap';
import { MDEX } from './uniswap-v2/mdex';
import { Dfyn } from './uniswap-v2/dfyn';
import { Bancor } from './bancor/bancor';
import { Compound } from './compound/compound';
import { AaveV2 } from './aave-v2/aave-v2';
import { AaveV3 } from './aave-v3/aave-v3';
import { IdleDao } from './idle-dao/idle-dao';
import { DodoV1 } from './dodo-v1/dodo-v1';
import { DodoV2 } from './dodo-v2';
import { Smoothy } from './smoothy/smoothy';
import { Nerve } from './nerve/nerve';
import { IDexHelper } from '../dex-helper';
import { SwapSide } from '../constants';
import { Adapters } from '../types';
import { Lido } from './lido/lido';
import { MakerPsm } from './maker-psm/maker-psm';
import { KyberDmm } from './kyberdmm/kyberdmm';
import { GMX } from './gmx/gmx';
import { WooFiV2 } from './woo-fi-v2/woo-fi-v2';
import { ParaSwapLimitOrders } from './paraswap-limit-orders/paraswap-limit-orders';
import { AugustusRFQOrder } from './augustus-rfq';
import { Solidly } from './solidly/solidly';
import { SolidlyV3 } from './solidly-v3/solidly-v3';
import { Ramses } from './solidly/forks-override/ramses';
import { Thena } from './solidly/forks-override/thena';
import { Chronos } from './solidly/forks-override/chronos';
import { Velodrome } from './solidly/forks-override/velodrome';
import { VelodromeV2 } from './solidly/forks-override/velodromeV2';
import { Aerodrome } from './solidly/forks-override/aerodrome';
import { SpiritSwapV2 } from './solidly/forks-override/spiritSwapV2';
import { Synthetix } from './synthetix/synthetix';
import { Usdfi } from './solidly/forks-override/usdfi';
import { Equalizer } from './solidly/forks-override/equalizer';
import { Velocimeter } from './solidly/forks-override/velocimeter';
import { BalancerV1 } from './balancer-v1/balancer-v1';
import { balancerV1Merge } from './balancer-v1/optimizer';
import { CurveV1 } from './curve-v1/curve-v1';
import { CurveFork } from './curve-v1/forks/curve-forks/curve-forks';
import { Swerve } from './curve-v1/forks/swerve/swerve';
import { CurveV1Factory } from './curve-v1-factory/curve-v1-factory';
import { CurveV1StableNg } from './curve-v1-stable-ng/curve-v1-stable-ng';
import { curveV1Merge } from './curve-v1-factory/optimizer';
import { GenericRFQ } from './generic-rfq/generic-rfq';
import { WstETH } from './wsteth/wsteth';
import { ERC4626 } from './erc4626/erc4626';
import { Camelot } from './camelot/camelot';
import { Hashflow } from './hashflow/hashflow';
import { Infusion } from './infusion/infusion';
import { SolidlyEthereum } from './solidly/solidly-ethereum';
import { MaverickV1 } from './maverick-v1/maverick-v1';
import { MaverickV2 } from './maverick-v2/maverick-v2';
import { QuickSwapV3 } from './quickswap/quickswap-v3';
import { ThenaFusion } from './quickswap/thena-fusion';
import { SwaapV2 } from './swaap-v2/swaap-v2';
import { TraderJoeV21 } from './trader-joe-v2.1/trader-joe-v2.1';
import { TraderJoeV22 } from './trader-joe-v2.1/trader-joe-v2.2';
import { PancakeswapV3 } from './pancakeswap-v3/pancakeswap-v3';
import { Algebra } from './algebra/algebra';
import { AngleTransmuter } from './angle-transmuter/angle-transmuter';
import { AngleStakedStable } from './angle-staked-stable/angle-staked-stable';
import { QuickPerps } from './quick-perps/quick-perps';
import { NomiswapV2 } from './uniswap-v2/nomiswap-v2';
import { Dexalot } from './dexalot/dexalot';
import { Bebop } from './bebop/bebop';
import { Wombat } from './wombat/wombat';
import { Swell } from './swell/swell';
import { PharaohV1 } from './solidly/forks-override/pharaohV1';
import { EtherFi } from './etherfi';
import { Spark } from './spark/spark';
import { SparkPsm } from './spark/spark-psm';
import { VelodromeSlipstream } from './uniswap-v3/forks/velodrome-slipstream/velodrome-slipstream';
import { AaveV3Stata } from './aave-v3-stata/aave-v3-stata';
import { AaveV3StataV2 } from './aave-v3-stata-v2/aave-v3-stata-v2';
import { OSwap } from './oswap/oswap';
import { FluidDex } from './fluid-dex/fluid-dex';
import { ConcentratorArusd } from './concentrator-arusd/concentrator-arusd';
import { FxProtocolRusd } from './fx-protocol-rusd/fx-protocol-rusd';
import { AaveGsm } from './aave-gsm/aave-gsm';
import { LitePsm } from './lite-psm/lite-psm';
import { StkGHO } from './stkgho/stkgho';
import { BalancerV3 } from './balancer-v3/balancer-v3';
import { balancerV3Merge } from './balancer-v3/optimizer';
import { SkyConverter } from './sky-converter/sky-converter';
import { Cables } from './cables/cables';
import { Stader } from './stader/stader';
import { UsualBond } from './usual/usual-bond';
import { UsualMWrappedM } from './usual/usual-m-wrapped-m';
import { UsualMUsd0 } from './usual/usual-m-usd0';
import { MWrappedM } from './usual/m-wrapped-m';
import { WrappedMM } from './usual/wrapped-m-m';
import { UsualPP } from './usual-pp/usual-pp';
import { AlgebraIntegral } from './algebra-integral/algebra-integral';
import { Ekubo } from './ekubo/ekubo';
import { UniswapV4 } from './uniswap-v4/uniswap-v4';
import { PancakeSwapV2 } from './uniswap-v2/pancake-swap-v2';
import { uniswapV4Merge } from './uniswap-v4/optimizer';
import { AaveV3PtRollOver } from './aave-v3-pt-roll-over/aave-v3-pt-roll-over';
import { RingV2 } from './uniswap-v2/ring-v2';
import { UsdcTransmuter } from './usdc-transmuter/usdc-transmuter';
import { ApexDefi } from './apex-defi/apex-defi';

const LegacyDexes = [
  CurveV2,
  StablePool,
  Smoothy,
  Bancor,
  Compound,
  DodoV1,
  DodoV2,
  QuickSwapV3,
  ThenaFusion,
  TraderJoeV21,
  TraderJoeV22,
  Lido,
  AugustusRFQOrder,
  EtherFi,
];

const Dexes = [
  Stader,
  Bebop,
  Dexalot,
  CurveV1,
  CurveFork,
  Swerve,
  BalancerV1,
  BalancerV2,
  BalancerV3,
  UniswapV2,
  UniswapV3,
  UniswapV4,
  Algebra,
  AlgebraIntegral,
  PancakeSwapV2,
  PancakeswapV3,
  VelodromeSlipstream,
  BiSwap,
  MDEX,
  Dfyn,
  AaveV2,
  AaveV3,
  IdleDao,
  KyberDmm,
  Weth,
  PolygonMigrator,
  MakerPsm,
  Nerve,
  GMX,
  JarvisV6,
  WooFiV2,
  ParaSwapLimitOrders,
  Solidly,
  SolidlyEthereum,
  SpiritSwapV2,
  Ramses,
  Thena,
  Chronos,
  Velodrome,
  VelodromeV2,
  Aerodrome,
  Equalizer,
  Velocimeter,
  Usdfi,
  Synthetix,
  CurveV1Factory,
  CurveV1StableNg,
  WstETH,
  ERC4626,
  Hashflow,
  Infusion,
  MaverickV1,
  MaverickV2,
  Camelot,
  SwaapV2,
  AngleTransmuter,
  AngleStakedStable,
  QuickPerps,
  NomiswapV2,
  SolidlyV3,
  Wombat,
  Swell,
  PharaohV1,
  Spark,
  SparkPsm,
  AaveV3Stata,
  AaveV3StataV2,
  OSwap,
  ConcentratorArusd,
  FxProtocolRusd,
  AaveGsm,
  LitePsm,
  UsualBond,
  StkGHO,
  SkyConverter,
  Cables,
  FluidDex,
  UsualMWrappedM,
  MWrappedM,
  WrappedMM,
  UsualMUsd0,
  UsualPP,
  Ekubo,
  AaveV3PtRollOver,
  RingV2,
  UsdcTransmuter,
  ApexDefi,
];

export type LegacyDexConstructor = new (dexHelper: IDexHelper) => IDexTxBuilder<
  any,
  any
>;

interface IGetDirectFunctionName {
  getDirectFunctionName?(): string[];
  getDirectFunctionNameV6?(): string[];
}

export class DexAdapterService {
  dexToKeyMap: {
    [key: string]: LegacyDexConstructor | DexConstructor<any, any, any>;
  } = {};
  directFunctionsNames: string[];
  directFunctionsNamesV6: string[];
  dexInstances: {
    [key: string]: IDexTxBuilder<any, any> | IDex<any, any, any>;
  } = {};
  isLegacy: { [dexKey: string]: boolean } = {};
  // dexKeys only has keys for non legacy dexes
  dexKeys: string[] = [];
  genericRFQDexKeys: Set<string> = new Set();
  uniswapV2Alias: string | null;

  public routeOptimizers: IRouteOptimizer<UnoptimizedRate>[] = [
    balancerV1Merge,
    balancerV2Merge,
    balancerV3Merge,
    uniswapMerge,
    curveV1Merge,
    uniswapV4Merge,
  ];

  constructor(
    public dexHelper: IDexHelper,
    public network: number,
    protected sellAdapters: Adapters = {},
    protected buyAdapters: Adapters = {},
  ) {
    LegacyDexes.forEach(DexAdapter => {
      DexAdapter.dexKeys.forEach(key => {
        this.dexToKeyMap[key.toLowerCase()] = DexAdapter;
        this.isLegacy[key.toLowerCase()] = true;
      });
    });

    const handleDex = (newDex: IDex<any, any, any>, key: string) => {
      const _key = key.toLowerCase();
      this.isLegacy[_key] = false;
      this.dexKeys.push(key);
      this.dexInstances[_key] = newDex;

      const sellAdaptersDex = (
        this.dexInstances[_key] as IDex<any, any, any>
      ).getAdapters(SwapSide.SELL);
      if (sellAdaptersDex)
        this.sellAdapters[_key] = sellAdaptersDex.map(({ name, index }) => ({
          adapter: this.dexHelper.config.data.adapterAddresses[name],
          index,
        }));

      const buyAdaptersDex = (
        this.dexInstances[_key] as IDex<any, any, any>
      ).getAdapters(SwapSide.BUY);
      if (buyAdaptersDex)
        this.buyAdapters[_key] = buyAdaptersDex.map(({ name, index }) => ({
          adapter: this.dexHelper.config.data.adapterAddresses[name],
          index,
        }));
    };

    Dexes.forEach(DexAdapter => {
      DexAdapter.dexKeysWithNetwork.forEach(({ key, networks }) => {
        if (networks.includes(network)) {
          const dex = new DexAdapter(network, key, dexHelper);
          handleDex(dex, key);
        }
      });
    });

    const rfqConfigs = dexHelper.config.data.rfqConfigs;
    Object.keys(dexHelper.config.data.rfqConfigs).forEach(rfqName => {
      const dex = new GenericRFQ(
        network,
        rfqName,
        dexHelper,
        rfqConfigs[rfqName],
      );
      handleDex(dex, rfqName);
      this.genericRFQDexKeys.add(rfqName.toLowerCase());
    });

    this.directFunctionsNames = [...LegacyDexes, ...Dexes]
      .flatMap(dexAdapter => {
        const _dexAdapter = dexAdapter as IGetDirectFunctionName;
        return _dexAdapter.getDirectFunctionName
          ? _dexAdapter.getDirectFunctionName()
          : [];
      })
      .filter(x => !!x)
      .map(v => v.toLowerCase());

    // include GenericRFQ, because it has direct method for v6
    this.directFunctionsNamesV6 = [...LegacyDexes, ...Dexes, GenericRFQ]
      .flatMap(dexAdapter => {
        const _dexAdapter = dexAdapter as IGetDirectFunctionName;
        return _dexAdapter.getDirectFunctionNameV6
          ? _dexAdapter.getDirectFunctionNameV6()
          : [];
      })
      .filter(x => !!x)
      .map(v => v.toLowerCase());

    this.uniswapV2Alias =
      this.network in UniswapV2Alias
        ? UniswapV2Alias[this.network].toLowerCase()
        : null;
  }

  getTxBuilderDexByKey(dexKey: string): IDexTxBuilder<any, any> {
    let _dexKey = this.getDexKeySpecial(dexKey);

    if (!this.dexInstances[_dexKey]) {
      const DexAdapter = this.dexToKeyMap[_dexKey];
      if (!DexAdapter)
        throw new Error(
          `${dexKey} dex is not supported for network(${this.network})!`,
        );

      this.dexInstances[_dexKey] = new (DexAdapter as LegacyDexConstructor)(
        this.dexHelper,
      );
    }

    return this.dexInstances[_dexKey];
  }

  isDirectFunctionName(functionName: string): boolean {
    return this.directFunctionsNames.includes(functionName.toLowerCase());
  }

  isDirectFunctionNameV6(functionName: string): boolean {
    return this.directFunctionsNamesV6.includes(functionName.toLowerCase());
  }

  getAllDexKeys() {
    return _.uniq(this.dexKeys);
  }

  getDexByKey(key: string): IDex<any, any, any> {
    const _key = key.toLowerCase();
    if (!(_key in this.isLegacy) || this.isLegacy[_key])
      throw new Error(`Invalid Dex Key ${key}`);

    return this.dexInstances[_key] as IDex<any, any, any>;
  }

  getAllDexAdapters(side: SwapSide = SwapSide.SELL) {
    return side === SwapSide.SELL ? this.sellAdapters : this.buyAdapters;
  }

  getDexKeySpecial(dexKey: string, isAdapters: boolean = false) {
    dexKey = dexKey.toLowerCase();
    if (this.genericRFQDexKeys.has(dexKey)) {
      return dexKey;
    }
    if ('uniswapforkoptimized' === dexKey) {
      if (!this.uniswapV2Alias)
        throw new Error(
          `${dexKey} dex is not supported for network(${this.network})!`,
        );
      return this.uniswapV2Alias;
    }
    return dexKey;
  }

  getAdapter(dexKey: string, side: SwapSide) {
    const specialDexKey = this.getDexKeySpecial(dexKey, true);
    return side === SwapSide.SELL
      ? this.sellAdapters[specialDexKey]
      : this.buyAdapters[specialDexKey];
  }

  doesPreProcessingRequireSequentiality(dexKey: string): boolean {
    try {
      const dex = this.getDexByKey(dexKey);
      return !!dex.needsSequentialPreprocessing;
    } catch (e) {
      return false;
    }
  }
}

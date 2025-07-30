import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network } from '../../constants';

import { UniformDistribution } from './ldf/UniformDistribution';
import { GeometricDistribution } from './ldf/GeometricDistribution';
import { DoubleGeometricDistribution } from './ldf/DoubleGeometricDistribution';
import { CarpetedGeometricDistribution } from './ldf/CarpetedGeometricDistribution';
import { CarpetedDoubleGeometricDistribution } from './ldf/CarpetedDoubleGeometricDistribution';
import { FeeOverrideHooklet } from './hooklet/FeeOverrideHooklet';

export const BunniV2Config: DexConfigMap<DexParams> = {
  BunniV2: {
    [Network.MAINNET]: {
      poolManager: '0x000000000004444c5dc75cB358380D2e3dE08A90',
      quoter: '0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203',
      router: '0x66a9893cc07d91d95644aedd05d03f95e1dba8af',
      bunniHub: '0x000000000049C7bcBCa294E63567b4D21EB765f1', // v1.2.1
      floodPlain: '0x0000000000f0D1C07cA806aB9154199E2E627Ea6',
      bunniHook: {
        address: '0x000052423c1dB6B7ff8641b85A7eEfc7B2791888', // v1.2.1
        deploymentBlock: 22684594n,
      },
      liquidityDensityFunctions: {
        ['0x00000000d5248262c18C5a8c706B2a3E740B8760'.toLowerCase()]:
          UniformDistribution,
        ['0x00000000B79037C909ff75dAFbA91b374bE2124f'.toLowerCase()]:
          GeometricDistribution,
        ['0x000000004a3e16323618D0E43e93b4DD64151eDB'.toLowerCase()]:
          DoubleGeometricDistribution,
        ['0x000000007cA9919151b275FABEA64A4f557Aa1F6'.toLowerCase()]:
          CarpetedGeometricDistribution,
        ['0x000000000b757686c9596caDA54fa28f8C429E0d'.toLowerCase()]:
          CarpetedDoubleGeometricDistribution,
      },
      hooklets: {
        ['0x0000e819b8A536Cf8e5d70B9C49256911033000C'.toLowerCase()]:
          FeeOverrideHooklet, // v1.0.0
        ['0x00eCE5a72612258f20eB24573C544f9dD8c5000C'.toLowerCase()]:
          FeeOverrideHooklet, // v1.0.1
      },
      subgraphURL: '5NFnHtgpdzB3JhVyiKQgnV9dZsewqJtX5HZfAT9Kg66r',
    },
    [Network.ARBITRUM]: {
      poolManager: '0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32',
      quoter: '0x3972c00f7ed4885e145823eb7c655375d275a1c5',
      router: '0xa51afafe0263b40edaef0df8781ea9aa03e381a3',
      bunniHub: '0x000000000049C7bcBCa294E63567b4D21EB765f1', // v1.2.1
      floodPlain: '0x0000000000f0D1C07cA806aB9154199E2E627Ea6',
      bunniHook: {
        address: '0x0000EB22c45bDB564F985acE0B4d05a64fa71888', // v1.2.1
        deploymentBlock: 351214280n,
      },
      liquidityDensityFunctions: {
        ['0x00000000Ca63Db33B83c0048De8B29e0FF3eb085'.toLowerCase()]:
          UniformDistribution,
        ['0x00000000Cf810fBCDd50699c7934E6a3bA76C6f7'.toLowerCase()]:
          GeometricDistribution,
        ['0x000000008F092B3A2eD144A4b9A6E17c4C90d8be'.toLowerCase()]:
          DoubleGeometricDistribution,
        ['0x00000000db3bb322a6c5866C3f0290a4b3eC858A'.toLowerCase()]:
          CarpetedGeometricDistribution,
        ['0x00000000f5cf92Bf887e22E1800fA15A2375B4b9'.toLowerCase()]:
          CarpetedDoubleGeometricDistribution,
      },
      hooklets: {
        ['0x0000e819b8A536Cf8e5d70B9C49256911033000C'.toLowerCase()]:
          FeeOverrideHooklet, // v1.0.0
        ['0x00eCE5a72612258f20eB24573C544f9dD8c5000C'.toLowerCase()]:
          FeeOverrideHooklet, // v1.0.1
      },
      subgraphURL: '96tZMr51QupqWYamom12Yki5AqCJEiHWbVUpzUpvu9oB',
    },
    [Network.BASE]: {
      poolManager: '0x498581fF718922c3f8e6A244956aF099B2652b2b',
      quoter: '0x0d5e0f971ed27fbff6c2837bf31316121532048d',
      router: '0x6ff5693b99212da76ad316178a184ab56d299b43',
      bunniHub: '0x000000000049C7bcBCa294E63567b4D21EB765f1', // v1.2.1
      floodPlain: '0x0000000000f0D1C07cA806aB9154199E2E627Ea6',
      bunniHook: {
        address: '0x000052423c1dB6B7ff8641b85A7eEfc7B2791888', // v1.2.1
        deploymentBlock: 31446454n,
      },
      liquidityDensityFunctions: {
        ['0x00000000d5248262c18C5a8c706B2a3E740B8760'.toLowerCase()]:
          UniformDistribution,
        ['0x00000000B79037C909ff75dAFbA91b374bE2124f'.toLowerCase()]:
          GeometricDistribution,
        ['0x000000004a3e16323618D0E43e93b4DD64151eDB'.toLowerCase()]:
          DoubleGeometricDistribution,
        ['0x000000007cA9919151b275FABEA64A4f557Aa1F6'.toLowerCase()]:
          CarpetedGeometricDistribution,
        ['0x000000000b757686c9596caDA54fa28f8C429E0d'.toLowerCase()]:
          CarpetedDoubleGeometricDistribution,
      },
      hooklets: {
        ['0x0000e819b8A536Cf8e5d70B9C49256911033000C'.toLowerCase()]:
          FeeOverrideHooklet, // v1.0.0
        ['0x00eCE5a72612258f20eB24573C544f9dD8c5000C'.toLowerCase()]:
          FeeOverrideHooklet, // v1.0.1
      },
      subgraphURL: '3oawHiCt7L9wJTEY9DynwAEmoThy8bvRhuMZdaaAooqW',
    },
    [Network.BSC]: {
      poolManager: '0x28e2Ea090877bF75740558f6BFB36A5ffeE9e9dF',
      quoter: '0x9F75dD27D6664c475B90e105573E550ff69437B0',
      router: '0x1906c1d672b88cD1B9aC7593301cA990F94Eae07',
      bunniHub: '0x000000000049C7bcBCa294E63567b4D21EB765f1', // v1.2.1
      floodPlain: '0x0000000000f0D1C07cA806aB9154199E2E627Ea6',
      bunniHook: {
        address: '0x000052423c1dB6B7ff8641b85A7eEfc7B2791888', // v1.2.1
        deploymentBlock: 51294769n,
      },
      liquidityDensityFunctions: {
        ['0x00000000d5248262c18C5a8c706B2a3E740B8760'.toLowerCase()]:
          UniformDistribution,
        ['0x00000000B79037C909ff75dAFbA91b374bE2124f'.toLowerCase()]:
          GeometricDistribution,
        ['0x000000004a3e16323618D0E43e93b4DD64151eDB'.toLowerCase()]:
          DoubleGeometricDistribution,
        ['0x000000007cA9919151b275FABEA64A4f557Aa1F6'.toLowerCase()]:
          CarpetedGeometricDistribution,
        ['0x000000000b757686c9596caDA54fa28f8C429E0d'.toLowerCase()]:
          CarpetedDoubleGeometricDistribution,
      },
      hooklets: {
        ['0x0000e819b8A536Cf8e5d70B9C49256911033000C'.toLowerCase()]:
          FeeOverrideHooklet, // v1.0.0
        ['0x00eCE5a72612258f20eB24573C544f9dD8c5000C'.toLowerCase()]:
          FeeOverrideHooklet, // v1.0.1
      },
      subgraphURL: 'FfnRstqDWGGevsbf9rRg1vNctrb38Hd791zzaaKc7AGz',
    },
    [Network.UNICHAIN]: {
      poolManager: '0x1F98400000000000000000000000000000000004',
      quoter: '0x333E3C607B141b18fF6de9f258db6e77fE7491E0',
      router: '0xEf740bf23aCaE26f6492B10de645D6B98dC8Eaf3',
      bunniHub: '0x000000000049C7bcBCa294E63567b4D21EB765f1', // v1.2.1
      floodPlain: '0x0000000000f0D1C07cA806aB9154199E2E627Ea6',
      bunniHook: {
        address: '0x000052423c1dB6B7ff8641b85A7eEfc7B2791888', // v1.2.1
        deploymentBlock: 18937832n,
      },
      liquidityDensityFunctions: {
        ['0x00000000d5248262c18C5a8c706B2a3E740B8760'.toLowerCase()]:
          UniformDistribution,
        ['0x00000000B79037C909ff75dAFbA91b374bE2124f'.toLowerCase()]:
          GeometricDistribution,
        ['0x000000004a3e16323618D0E43e93b4DD64151eDB'.toLowerCase()]:
          DoubleGeometricDistribution,
        ['0x000000007cA9919151b275FABEA64A4f557Aa1F6'.toLowerCase()]:
          CarpetedGeometricDistribution,
        ['0x000000000b757686c9596caDA54fa28f8C429E0d'.toLowerCase()]:
          CarpetedDoubleGeometricDistribution,
      },
      hooklets: {
        ['0x0000e819b8A536Cf8e5d70B9C49256911033000C'.toLowerCase()]:
          FeeOverrideHooklet, // v1.0.0
        ['0x00eCE5a72612258f20eB24573C544f9dD8c5000C'.toLowerCase()]:
          FeeOverrideHooklet, // v1.0.1
      },
      subgraphURL: 'J22JEPtqL847G44v7E5gTsxmNosoLtKQUDAvnhRhzj25',
    },
  },
};

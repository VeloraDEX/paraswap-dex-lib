import { DexParams } from './types';
import { DexConfigMap, AdapterMappings } from '../../types';
import { Network, SwapSide } from '../../constants';

// These map to the Balancer API poolType. Only Balancer supported pools will be added
export enum SUPPORTED_POOLS {
  WEIGHTED = 'WEIGHTED',
  STABLE = 'STABLE',
  GYROE = 'GYROE',
}

export const disabledPoolIds: Record<string, Record<number, string[]>> = {
  BalancerV3: {
    [Network.GNOSIS]: [],
  },
};

// Balancer API - aggregatorSpecific query serves all useful static pool data
export const apiUrl = 'https://test-api-v3.balancer.fi/';

// TODO Full config added after V3 release
export const BalancerV3Config: DexConfigMap<DexParams> = {
  BalancerV3: {
    [Network.SEPOLIA]: {
      vaultAddress: '0xbA1333333333a1BA1108E8412f11850A5C319bA9',
      apiNetworkName: 'SEPOLIA',
      balancerRouterAddress: '0x0BF61f706105EA44694f2e92986bD01C39930280',
      balancerBatchRouterAddress: '0xC85b652685567C1B074e8c0D4389f83a2E458b1C',
      hooks: [
        {
          type: 'DirectionalFee',
          apiName: 'DIRECTIONAL_FEE',
          address: '0xd68372e85d8a14afa5fdb3d506bf765939aaf382',
        },
        {
          type: 'StableSurge',
          apiName: 'STABLE_SURGE',
          factory: '0x9eB9867C1d4B6fd3a7D0dAd3101b5A153b1107Ec', // Pools with StableSurge hook will always be deployed from this factory
          address: '0xc0cbcdd6b823a4f22aa6bbdde44c17e754266aef', // Address of the hook that will be used by pools
        },
      ],
    },
    [Network.GNOSIS]: {
      vaultAddress: '0xbA1333333333a1BA1108E8412f11850A5C319bA9',
      apiNetworkName: 'GNOSIS',
      balancerRouterAddress: '0x84813aA3e079A665C0B80F944427eE83cBA63617',
      balancerBatchRouterAddress: '0xe2fa4e1d17725e72dcdAfe943Ecf45dF4B9E285b',
      hooks: [
        {
          type: 'StableSurge',
          apiName: 'STABLE_SURGE',
          factory: '0x268E2EE1413D768b6e2dc3F5a4ddc9Ae03d9AF42', // Pools with StableSurge hook will always be deployed from this factory
          address: '0xe4f1878eC9710846E2B529C1b5037F8bA94583b1', // Address of the hook that will be used by pools
        },
      ],
    },
    [Network.MAINNET]: {
      vaultAddress: '0xbA1333333333a1BA1108E8412f11850A5C319bA9',
      apiNetworkName: 'MAINNET',
      balancerRouterAddress: '0x5C6fb490BDFD3246EB0bB062c168DeCAF4bD9FDd',
      balancerBatchRouterAddress: '0x136f1EFcC3f8f88516B9E94110D56FDBfB1778d1',
      hooks: [
        {
          type: 'StableSurge',
          apiName: 'STABLE_SURGE',
          factory: '0xD53F5d8d926fb2a0f7Be614B16e649B8aC102D83', // Pools with StableSurge hook will always be deployed from this factory
          address: '0xb18fA0cb5DE8cecB8899AAE6e38b1B7ed77885dA', // Address of the hook that will be used by pools
        },
      ],
    },
    [Network.ARBITRUM]: {
      vaultAddress: '0xbA1333333333a1BA1108E8412f11850A5C319bA9',
      apiNetworkName: 'ARBITRUM',
      balancerRouterAddress: '0x0f08eEf2C785AA5e7539684aF04755dEC1347b7c',
      balancerBatchRouterAddress: '0xaD89051bEd8d96f045E8912aE1672c6C0bF8a85E',
      hooks: [
        {
          type: 'StableSurge',
          apiName: 'STABLE_SURGE',
          factory: '0x86e67E115f96DF37239E0479441303De0de7bc2b', // Pools with StableSurge hook will always be deployed from this factory
          address: '0x0Fa0f9990D7969a7aE6f9961d663E4A201Ed6417', // Address of the hook that will be used by pools
        },
      ],
    },
    [Network.BASE]: {
      vaultAddress: '0xbA1333333333a1BA1108E8412f11850A5C319bA9',
      apiNetworkName: 'BASE',
      balancerRouterAddress: '0x76578ecf9a141296Ec657847fb45B0585bCDa3a6',
      balancerBatchRouterAddress: '0x85a80afee867aDf27B50BdB7b76DA70f1E853062',
      hooks: [
        {
          type: 'StableSurge',
          apiName: 'STABLE_SURGE',
          factory: '0x4fb47126Fa83A8734991E41B942Ac29A3266C968', // Pools with StableSurge hook will always be deployed from this factory
          address: '0xb2007B8B7E0260042517f635CFd8E6dD2Dd7f007', // Address of the hook that will be used by pools
        },
      ],
    },
    [Network.AVALANCHE]: {
      vaultAddress: '0xbA1333333333a1BA1108E8412f11850A5C319bA9',
      apiNetworkName: 'AVALANCHE',
      balancerRouterAddress: '0xF39CA6ede9BF7820a952b52f3c94af526bAB9015',
      balancerBatchRouterAddress: '0xc9b36096f5201ea332Db35d6D195774ea0D5988f',
      hooks: [
        {
          type: 'StableSurge',
          apiName: 'STABLE_SURGE',
          factory: '0x18CC3C68A5e64b40c846Aa6E45312cbcBb94f71b', // Pools with StableSurge hook will always be deployed from this factory
          address: '0x86705ee19c0509ff68f1118c55ee2ebde383d122', // Address of the hook that will be used by pools
        },
      ],
    },
    [Network.OPTIMISM]: {
      vaultAddress: '0xbA1333333333a1BA1108E8412f11850A5C319bA9',
      apiNetworkName: 'OPTIMISM',
      balancerRouterAddress: '0xe2fa4e1d17725e72dcdAfe943Ecf45dF4B9E285b',
      balancerBatchRouterAddress: '0xaD89051bEd8d96f045E8912aE1672c6C0bF8a85E',
      hooks: [
        {
          type: 'StableSurge',
          apiName: 'STABLE_SURGE',
          factory: '0x3BEb058DE1A25dd24223fd9e1796df8589429AcE', // Pools with StableSurge hook will always be deployed from this factory
          address: '0xF39CA6ede9BF7820a952b52f3c94af526bAB9015', // Address of the hook that will be used by pools
        },
      ],
    },
  },
};

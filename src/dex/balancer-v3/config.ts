import { DexParams } from './types';
import { DexConfigMap, AdapterMappings } from '../../types';
import { Network, SwapSide } from '../../constants';

// These map to the Balancer API poolType. Only Balancer supported pools will be added
export enum SUPPORTED_POOLS {
  WEIGHTED = 'WEIGHTED',
  STABLE = 'STABLE',
  GYROE = 'GYROE',
  QUANT_AMM_WEIGHTED = 'QUANT_AMM_WEIGHTED',
  RECLAMM = 'RECLAMM',
}

// pools should be lowercased
export const disabledPoolIds: Record<string, Record<number, string[]>> = {
  BalancerV3: {
    [Network.MAINNET]: ['0xe388f1c31662a25b2c771fa7620682338f9eb667'],
    [Network.GNOSIS]: [],
    [Network.BASE]: ['0x15ebbf604b5fa847bdac208af1719d4dc78d2994'],
  },
};

// Balancer API - aggregatorSpecific query serves all useful static pool data
export const apiUrl = 'https://api-v3.balancer.fi/';

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
          hookAddress: '0xd68372e85d8a14afa5fdb3d506bf765939aaf382',
        },
        {
          type: 'StableSurge',
          apiName: 'STABLE_SURGE',
          factoryAddress: '0x9eB9867C1d4B6fd3a7D0dAd3101b5A153b1107Ec', // Pools with StableSurge hook will always be deployed from this factory
          factoryDeploymentBlock: 7549387,
          hookAddress: '0xc0cbcdd6b823a4f22aa6bbdde44c17e754266aef', // Address of the hook that will be used by pools
        },
        {
          type: 'StableSurge', // StableSurgeV3 - Is same as V1/V2 with changes: introduce additional safety guardrails and additional protocol fee config options
          apiName: 'STABLE_SURGE',
          factoryAddress: '0x8573CAF1EC065c5956006d2b34117D2DBa326955', // Pools with StableSurge hook will always be deployed from this factory
          factoryDeploymentBlock: 10058895,
          hookAddress: '0xc0cbcdd6b823a4f22aa6bbdde44c17e754266aef', // Address of the hook that will be used by pools
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
          factoryAddress: '0x268E2EE1413D768b6e2dc3F5a4ddc9Ae03d9AF42', // Pools with StableSurge hook will always be deployed from this factory
          factoryDeploymentBlock: 38432088,
          hookAddress: '0xe4f1878eC9710846E2B529C1b5037F8bA94583b1', // Address of the hook that will be used by pools
        },
        {
          type: 'StableSurge', // StableSurgeV2 - Is same as V1 with changes: up to 50k amp factor (vs 5k on v1) and ability to set a swap fee manager
          apiName: 'STABLE_SURGE',
          factoryAddress: '0x45fB5aF0a1aD80Ea16C803146eb81844D9972373', // Pools with StableSurge hook will always be deployed from this factory
          factoryDeploymentBlock: 39390487,
          hookAddress: '0x90BD26fbb9dB17D75b56E4cA3A4c438FA7C93694', // Address of the hook that will be used by pools
        },
        {
          type: 'StableSurge', // StableSurgeV3 - Is same as V1/V2 with changes: introduce additional safety guardrails and additional protocol fee config options
          apiName: 'STABLE_SURGE',
          factoryAddress: '0x59D55FA503Faea8D95935a561f34153C273255DD', // Pools with StableSurge hook will always be deployed from this factory
          factoryDeploymentBlock: 44200063,
          hookAddress: '0x90BD26fbb9dB17D75b56E4cA3A4c438FA7C93694', // Address of the hook that will be used by pools
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
          factoryAddress: '0xD53F5d8d926fb2a0f7Be614B16e649B8aC102D83', // Pools with StableSurge hook will always be deployed from this factory
          factoryDeploymentBlock: 21791079,
          hookAddress: '0xb18fA0cb5DE8cecB8899AAE6e38b1B7ed77885dA', // Address of the hook that will be used by pools
        },
        {
          type: 'StableSurge', // StableSurgeV2 - Is same as V1 with changes: up to 50k amp factor (vs 5k on v1) and ability to set a swap fee manager
          apiName: 'STABLE_SURGE',
          factoryAddress: '0x355bD33F0033066BB3DE396a6d069be57353AD95', // Pools with StableSurge hook will always be deployed from this factory
          factoryDeploymentBlock: 22197594,
          hookAddress:
            '0xBDbADc891BB95DEE80eBC491699228EF0f7D6fF1'.toLowerCase(), // Address of the hook that will be used by pools
        },
        {
          type: 'StableSurge', // StableSurgeV3 - Is same as V1/V2 with changes: introduce additional safety guardrails and additional protocol fee config options
          apiName: 'STABLE_SURGE',
          factoryAddress: '0x187a05fb9e4234Dd310ae74215743560D1BAA6Ac', // Pools with StableSurge hook will always be deployed from this factory
          factoryDeploymentBlock: 24249983,
          hookAddress:
            '0xBDbADc891BB95DEE80eBC491699228EF0f7D6fF1'.toLowerCase(), // Address of the hook that will be used by pools
        },
      ],
      quantAmmUpdateWeightRunnerAddress:
        '0x21Ae9576a393413D6d91dFE2543dCb548Dbb8748',
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
          factoryAddress: '0x86e67E115f96DF37239E0479441303De0de7bc2b', // Pools with StableSurge hook will always be deployed from this factory
          factoryDeploymentBlock: 303403113,
          hookAddress: '0x0Fa0f9990D7969a7aE6f9961d663E4A201Ed6417', // Address of the hook that will be used by pools
        },
        {
          type: 'StableSurge', // StableSurgeV2 - Is same as V1 with changes: up to 50k amp factor (vs 5k on v1) and ability to set a swap fee manager
          apiName: 'STABLE_SURGE',
          factoryAddress: '0x201efd508c8DfE9DE1a13c2452863A78CB2a86Cc', // Pools with StableSurge hook will always be deployed from this factory
          factoryDeploymentBlock: 322937794,
          hookAddress: '0x7c1b7A97BfAcD39975dE53e989A16c7BC4C78275', // Address of the hook that will be used by pools
        },
        {
          type: 'StableSurge', // StableSurgeV3 - Is same as V1/V2 with changes: introduce additional safety guardrails and additional protocol fee config options
          apiName: 'STABLE_SURGE',
          factoryAddress: '0x8A8B9f35765899B3a0291700141470D79EA2eA88', // Pools with StableSurge hook will always be deployed from this factory
          factoryDeploymentBlock: 422088458,
          hookAddress: '0x7c1b7A97BfAcD39975dE53e989A16c7BC4C78275', // Address of the hook that will be used by pools
        },
        {
          type: 'Akron',
          apiName: 'AKRON',
          hookAddress: '0xD221aFFABdD3C1281ea14C5781DEc6B0fCA8937E',
        },
      ],
      quantAmmUpdateWeightRunnerAddress:
        '0x8Ca4e2a74B84c1feb9ADe19A0Ce0bFcd57e3f6F7',
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
          factoryAddress: '0x4fb47126Fa83A8734991E41B942Ac29A3266C968', // Pools with StableSurge hook will always be deployed from this factory
          factoryDeploymentBlock: 26049433,
          hookAddress: '0xb2007B8B7E0260042517f635CFd8E6dD2Dd7f007', // Address of the hook that will be used by pools
        },
        {
          type: 'StableSurge', // StableSurgeV2 - Is same as V1 with changes: up to 50k amp factor (vs 5k on v1) and ability to set a swap fee manager
          apiName: 'STABLE_SURGE',
          factoryAddress: '0x8e3fEaAB11b7B351e3EA1E01247Ab6ccc847dD52', // Pools with StableSurge hook will always be deployed from this factory
          factoryDeploymentBlock: 28502516,
          hookAddress: '0xDB8d758BCb971e482B2C45f7F8a7740283A1bd3A', // Address of the hook that will be used by pools
        },
        {
          type: 'StableSurge', // StableSurgeV3 - Is same as V1/V2 with changes: introduce additional safety guardrails and additional protocol fee config options
          apiName: 'STABLE_SURGE',
          factoryAddress: '0x6623d1CEEaB236ae93aCAfB285dDFB77336B6981', // Pools with StableSurge hook will always be deployed from this factory
          factoryDeploymentBlock: 40904686,
          hookAddress: '0xDB8d758BCb971e482B2C45f7F8a7740283A1bd3A', // Address of the hook that will be used by pools
        },
        {
          type: 'Akron',
          apiName: 'AKRON',
          hookAddress: '0xA45570815dbE7BF7010c41f1f74479bE322D02bd',
        },
      ],
      quantAmmUpdateWeightRunnerAddress:
        '0x8Ca4e2a74B84c1feb9ADe19A0Ce0bFcd57e3f6F7',
    },
    [Network.PLASMA]: {
      vaultAddress: '0xbA1333333333a1BA1108E8412f11850A5C319bA9',
      apiNetworkName: 'PLASMA',
      balancerRouterAddress: '0x9dA18982a33FD0c7051B19F0d7C76F2d5E7e017c',
      balancerBatchRouterAddress: '0x85a80afee867aDf27B50BdB7b76DA70f1E853062',
      hooks: [
        {
          type: 'StableSurge', // StableSurgeV2 - Is same as V1 with changes: up to 50k amp factor (vs 5k on v1) and ability to set a swap fee manager
          apiName: 'STABLE_SURGE',
          factoryAddress: '0x6B5dA774890Db7B7b96C6f44e6a4b0F657399E2e', // Pools with StableSurge hook will always be deployed from this factory
          factoryDeploymentBlock: 783985,
          hookAddress: '0x6817149cb753BF529565B4D023d7507eD2ff4Bc0', // Address of the hook that will be used by pools
        },
        {
          type: 'StableSurge', // StableSurgeV3 - Is same as V1/V2 with changes: introduce additional safety guardrails and additional protocol fee config options
          apiName: 'STABLE_SURGE',
          factoryAddress: '0x7c1b7A97BfAcD39975dE53e989A16c7BC4C78275', // Pools with StableSurge hook will always be deployed from this factory
          factoryDeploymentBlock: 11668367,
          hookAddress: '0x6817149cb753BF529565B4D023d7507eD2ff4Bc0', // Address of the hook that will be used by pools
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
          type: 'StableSurge', // StableSurgeV2 (No V1 release on Avalanche) - Is same as V1 with changes: up to 50k amp factor (vs 5k on v1) and ability to set a swap fee manager
          apiName: 'STABLE_SURGE',
          factoryAddress: '0x18CC3C68A5e64b40c846Aa6E45312cbcBb94f71b', // Pools with StableSurge hook will always be deployed from this factory
          factoryDeploymentBlock: 59966276,
          hookAddress: '0x86705Ee19c0509Ff68F1118C55ee2ebdE383D122', // Address of the hook that will be used by pools
        },
        {
          type: 'StableSurge', // StableSurgeV3 - Is same as V1/V2 with changes: introduce additional safety guardrails and additional protocol fee config options
          apiName: 'STABLE_SURGE',
          factoryAddress: '0x8D217CB74f675B46cC2767C8cF0aAB53BE1c4818', // Pools with StableSurge hook will always be deployed from this factory
          factoryDeploymentBlock: 75904552,
          hookAddress: '0x86705Ee19c0509Ff68F1118C55ee2ebdE383D122', // Address of the hook that will be used by pools
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
          type: 'StableSurge', // StableSurgeV2 (No V1 release on Optimism) - Is same as V1 with changes: up to 50k amp factor (vs 5k on v1) and ability to set a swap fee manager
          apiName: 'STABLE_SURGE',
          factoryAddress: '0x3BEb058DE1A25dd24223fd9e1796df8589429AcE', // Pools with StableSurge hook will always be deployed from this factory
          factoryDeploymentBlock: 134097700,
          hookAddress: '0xF39CA6ede9BF7820a952b52f3c94af526bAB9015', // Address of the hook that will be used by pools
        },
        {
          type: 'StableSurge', //StableSurgeV3 - Is same as V1/V2 with changes: introduce additional safety guardrails and additional protocol fee config options
          apiName: 'STABLE_SURGE',
          factoryAddress: '0xFD214210587Fb84798cbE7F37235e12898f3128f', // Pools with StableSurge hook will always be deployed from this factory
          factoryDeploymentBlock: 146500110,
          hookAddress: '0xF39CA6ede9BF7820a952b52f3c94af526bAB9015', // Address of the hook that will be used by pools
        },
      ],
    },
    [Network.SONIC]: {
      vaultAddress: '0xbA1333333333a1BA1108E8412f11850A5C319bA9',
      apiNetworkName: 'SONIC',
      balancerRouterAddress: '0x93db4682A40721e7c698ea0a842389D10FA8Dae5', // Router V2
      balancerBatchRouterAddress: '0x7761659F9e9834ad367e4d25E0306ba7A4968DAf', // Batch Router
      hooks: [
        {
          type: 'StableSurge',
          apiName: 'STABLE_SURGE',
          factoryAddress: '0x6187F6C78ca4d89490d959e9c629B93214e6776e', // Pools with StableSurge hook will always be deployed from this factory
          factoryDeploymentBlock: 20250121,
          hookAddress: '0x8A83Aa9bb7C4Cff14ae0aEcec0fB9ef234901c0C', // Address of the hook that will be used by pools
        },
        {
          type: 'StableSurge', // StableSurgeV2 - Is same as V1 with changes: up to 50k amp factor (vs 5k on v1) and ability to set a swap fee manager
          apiName: 'STABLE_SURGE',
          factoryAddress: '0x3D9319BB29DAF6081D01DC56b6203EfcC90f0bAD', // Pools with StableSurge hook will always be deployed from this factory
          factoryDeploymentBlock: 20250404,
          hookAddress: '0x049919Ae32E50aEe5ea1A0998a841d175ec6f1b3', // Address of the hook that will be used by pools
        },
        {
          type: 'StableSurge', // StableSurgeV3 - Is same as V1/V2 with changes: introduce additional safety guardrails and additional protocol fee config options
          apiName: 'STABLE_SURGE',
          factoryAddress: '0x8e2E3058702FEB83D45dD27311dEd693f7CD162b', // Pools with StableSurge hook will always be deployed from this factory
          factoryDeploymentBlock: 61251981,
          hookAddress: '0x049919Ae32E50aEe5ea1A0998a841d175ec6f1b3', // Address of the hook that will be used by pools
        },
      ],
    },
  },
};

import { Config, Address, Token } from './types';

import { Network, PORT_TEST_SERVER, ETHER_ADDRESS } from './constants';
import { isETHAddress } from './utils';
import { RFQConfig } from './dex/generic-rfq/types';

// Hardcoded and environment values from which actual config is derived
type BaseConfig = {
  network: number;
  networkName: string;
  isTestnet: boolean;
  mainnetNetwork?: number;
  nativeTokenName?: string;
  nativeTokenSymbol: string;
  wrappedNativeTokenName?: string;
  wrappedNativeTokenSymbol?: string;
  wrappedNativeTokenAddress: Address;
  hasEIP1559: boolean;
  augustusAddress: Address;
  augustusV6Address: Address;
  augustusRFQAddress: Address;
  tokenTransferProxyAddress: Address;
  multicallV2Address: Address;
  privateHttpProvider?: string;
  adapterAddresses: { [name: string]: Address };
  executorsAddresses?: { [name: string]: Address };
  uniswapV2ExchangeRouterAddress: Address;
  uniswapV3EventLoggingSampleRate?: number;
  rfqConfigs: Record<string, RFQConfig>;
  rpcPollingMaxAllowedStateDelayInBlocks: number;
  rpcPollingBlocksBackToTriggerUpdate: number;
  hashFlowAuthToken?: string;
  hashFlowDisabledMMs: string[];
  swaapV2AuthToken?: string;
  dexalotAuthToken?: string;
  bebopAuthName?: string;
  bebopAuthToken?: string;
  nativeApiKey?: string;
  forceRpcFallbackDexs: string[];
};

const baseConfigs: { [network: number]: BaseConfig } = {
  [Network.MAINNET]: {
    network: Network.MAINNET,
    networkName: 'Ethereum Mainnet',
    isTestnet: false,
    nativeTokenName: 'Ether',
    nativeTokenSymbol: 'ETH',
    wrappedNativeTokenAddress: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    hasEIP1559: true,
    augustusAddress: '0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57',
    augustusRFQAddress: '0xe92b586627ccA7a83dC919cc7127196d70f55a06',
    tokenTransferProxyAddress: '0x216b4b4ba9f3e719726886d34a177484278bfcae',
    multicallV2Address: '0x5BA1e12693Dc8F9c48aAD8770482f4739bEeD696',
    privateHttpProvider: process.env.HTTP_PROVIDER_1,
    augustusV6Address: '0x6a000f20005980200259b80c5102003040001068',
    executorsAddresses: {
      Executor01: '0x000010036C0190E009a000d0fc3541100A07380A',
      Executor02: '0x00C600b30fb0400701010F4b080409018B9006E0',
      Executor03: '0x0e5891850bb3f03090f03010000806f080040100',
    },
    adapterAddresses: {
      Adapter01: '0x9bE264469eF954c139Da4A45Cf76CbCC5e3A6A73',
      Adapter02: '0xFC2Ba6E830a04C25e207B8214b26d8C713F6881F',
      Adapter03: '0x80F5509eDD9A7AAfd14Cf2B0436dC23385F760d7',
      Adapter04: '0x369A2FDb910d432f0a07381a5E3d27572c876713',
      Adapter05: '0x3329dfa55A40B450952FBE0203167Ae6908E656d',
      Adapter06: '0xAeb7B3688a658C3f3B1AEd94d69b7b8045D64B57',
      BuyAdapter: '0x736518161516c1cfBD5bf5e7049FCBDC9b933987',
      BuyAdapter02: '0x2299568c3299e7420033deA9009233FF89F5C485',
    },
    uniswapV2ExchangeRouterAddress:
      '0xF9234CB08edb93c0d4a4d4c70cC3FfD070e78e07',
    rpcPollingMaxAllowedStateDelayInBlocks: 0,
    rpcPollingBlocksBackToTriggerUpdate: 0,
    swaapV2AuthToken: process.env.API_KEY_SWAAP_V2_AUTH_TOKEN || '',
    hashFlowAuthToken: process.env.API_KEY_HASHFLOW_AUTH_TOKEN || '',
    bebopAuthName: process.env.API_KEY_BEBOP_AUTH_NAME || '',
    bebopAuthToken: process.env.API_KEY_BEBOP_AUTH_TOKEN || '',
    nativeApiKey: process.env.API_KEY_NATIVE || '',
    hashFlowDisabledMMs:
      process.env[`HASHFLOW_DISABLED_MMS_1`]?.split(',') || [],
    uniswapV3EventLoggingSampleRate: 0,
    rfqConfigs: {
      DummyParaSwapPool: {
        maker: process.env.TEST_ADDRESS!,
        minTradeUsd: null,
        tokensConfig: {
          reqParams: {
            url: `http://localhost:${PORT_TEST_SERVER}/tokens`,
            method: 'GET',
          },
          secret: {
            domain: 'paraswap-test',
            accessKey: 'access',
            secretKey: 'secret',
          },
          intervalMs: 1000 * 60 * 60 * 10, // every 10 minutes
          dataTTLS: 1000 * 60 * 60 * 11, // ttl 11 minutes
        },
        pairsConfig: {
          reqParams: {
            url: `http://localhost:${PORT_TEST_SERVER}/pairs`,
            method: 'GET',
          },
          secret: {
            domain: 'paraswap-test',
            accessKey: 'access',
            secretKey: 'secret',
          },
          intervalMs: 1000 * 60 * 60 * 10, // every 10 minutes
          dataTTLS: 1000 * 60 * 60 * 11, // ttl 11 minutes
        },
        rateConfig: {
          reqParams: {
            url: `http://localhost:${PORT_TEST_SERVER}/prices`,
            method: 'GET',
          },
          secret: {
            domain: 'paraswap-test',
            accessKey: 'access',
            secretKey: 'secret',
          },
          intervalMs: 1000 * 60 * 60 * 1, // every 1 minute
          dataTTLS: 1000 * 60 * 60 * 1, // ttl 1 minute
        },
        firmRateConfig: {
          url: `http://localhost:${PORT_TEST_SERVER}/firm`,
          method: 'POST',
          secret: {
            domain: 'paraswap-test',
            accessKey: 'access',
            secretKey: 'secret',
          },
        },
      },
    },
    forceRpcFallbackDexs: [],
  },
  [Network.BSC]: {
    network: Network.BSC,
    networkName: 'Binance Smart Chain Mainnet',
    isTestnet: false,
    nativeTokenSymbol: 'BNB',
    wrappedNativeTokenAddress: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
    hasEIP1559: false,
    augustusAddress: '0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57',
    augustusRFQAddress: '0x8DcDfe88EF0351f27437284D0710cD65b20288bb',
    tokenTransferProxyAddress: '0x216b4b4ba9f3e719726886d34a177484278bfcae',
    multicallV2Address: '0xC50F4c1E81c873B2204D7eFf7069Ffec6Fbe136D',
    privateHttpProvider: process.env.HTTP_PROVIDER_56,
    augustusV6Address: '0x6a000f20005980200259b80c5102003040001068',
    dexalotAuthToken: process.env.API_KEY_DEXALOT_AUTH_TOKEN || '',
    bebopAuthName: process.env.API_KEY_BEBOP_AUTH_NAME || '',
    bebopAuthToken: process.env.API_KEY_BEBOP_AUTH_TOKEN || '',
    executorsAddresses: {
      Executor01: '0x000010036C0190E009a000d0fc3541100A07380A',
      Executor02: '0x00C600b30fb0400701010F4b080409018B9006E0',
      Executor03: '0x0e5891850bb3f03090f03010000806f080040100',
    },
    hashFlowAuthToken: process.env.API_KEY_HASHFLOW_AUTH_TOKEN || '',
    swaapV2AuthToken: process.env.API_KEY_SWAAP_V2_AUTH_TOKEN || '',
    nativeApiKey: process.env.API_KEY_NATIVE || '',
    hashFlowDisabledMMs:
      process.env[`HASHFLOW_DISABLED_MMS_56`]?.split(',') || [],
    adapterAddresses: {
      BscAdapter01: '0xA31d9C571DF00e0F428B0bD24c34D103E8112222',
      BscAdapter02: '0xb9768a1C6e4917E30927beeC4b2874d45fD333Cf',
      BscAdapter03: '0x34D41cE301257a4615D4F5AD260FA91D03925243',
      BscBuyAdapter: '0x56cc27eCfb42E22a413E785086E708dA87aF8103',
    },
    rpcPollingMaxAllowedStateDelayInBlocks: 1,
    rpcPollingBlocksBackToTriggerUpdate: 1,
    uniswapV2ExchangeRouterAddress:
      '0x53e693c6C7FFC4446c53B205Cf513105Bf140D7b',
    rfqConfigs: {},
    forceRpcFallbackDexs: [],
  },
  [Network.POLYGON]: {
    network: Network.POLYGON,
    networkName: 'Polygon Mainnet',
    isTestnet: false,
    nativeTokenName: 'Matic',
    nativeTokenSymbol: 'MATIC',
    wrappedNativeTokenAddress: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
    hasEIP1559: true,
    augustusAddress: '0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57',
    augustusRFQAddress: '0xF3CD476C3C4D3Ac5cA2724767f269070CA09A043',
    tokenTransferProxyAddress: '0x216b4b4ba9f3e719726886d34a177484278bfcae',
    multicallV2Address: '0x275617327c958bD06b5D6b871E7f491D76113dd8',
    privateHttpProvider: process.env.HTTP_PROVIDER_137,
    augustusV6Address: '0x6a000f20005980200259b80c5102003040001068',
    executorsAddresses: {
      Executor01: '0x000010036C0190E009a000d0fc3541100A07380A',
      Executor02: '0x00C600b30fb0400701010F4b080409018B9006E0',
      Executor03: '0x0e5891850bb3f03090f03010000806f080040100',
    },
    bebopAuthName: process.env.API_KEY_BEBOP_AUTH_NAME || '',
    bebopAuthToken: process.env.API_KEY_BEBOP_AUTH_TOKEN || '',
    hashFlowAuthToken: process.env.API_KEY_HASHFLOW_AUTH_TOKEN || '',
    hashFlowDisabledMMs:
      process.env[`HASHFLOW_DISABLED_MMS_137`]?.split(',') || [],
    adapterAddresses: {
      PolygonAdapter01: '0xE44769f42E1e9592f86B82f206407a8f7C84b4ed',
      PolygonAdapter02: '0xC5A6637aA6D3E0fCBE870c2B5a5377988097f3F4',
      PolygonAdapter03: '0x5A9037E0DCa7a8f30C1E6925e92eb402B7F6250E',
      PolygonBuyAdapter: '0xb96aB183767219d3b5B72D0f8DC96e2201653fB0',
    },
    uniswapV2ExchangeRouterAddress:
      '0xf3938337F7294fEf84e9B2c6D548A93F956Cc281',
    uniswapV3EventLoggingSampleRate: 0,
    rfqConfigs: {},
    rpcPollingMaxAllowedStateDelayInBlocks: 2,
    rpcPollingBlocksBackToTriggerUpdate: 1,
    swaapV2AuthToken: process.env.API_KEY_SWAAP_V2_AUTH_TOKEN || '',
    forceRpcFallbackDexs: [],
  },
  [Network.AVALANCHE]: {
    network: Network.AVALANCHE,
    networkName: 'Avalanche Mainnet C-Chain',
    isTestnet: false,
    nativeTokenName: 'Avax',
    nativeTokenSymbol: 'AVAX',
    wrappedNativeTokenAddress: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7',
    hasEIP1559: true,
    augustusAddress: '0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57',
    augustusRFQAddress: '0x34302c4267d0dA0A8c65510282Cc22E9e39df51f',
    tokenTransferProxyAddress: '0x216b4b4ba9f3e719726886d34a177484278bfcae',
    multicallV2Address: '0xd7Fc8aD069f95B6e2835f4DEff03eF84241cF0E1',
    privateHttpProvider: process.env.HTTP_PROVIDER_43114,
    bebopAuthName: process.env.API_KEY_BEBOP_AUTH_NAME || '',
    bebopAuthToken: process.env.API_KEY_BEBOP_AUTH_TOKEN || '',
    hashFlowAuthToken: process.env.API_KEY_HASHFLOW_AUTH_TOKEN || '',
    hashFlowDisabledMMs:
      process.env[`HASHFLOW_DISABLED_MMS_43114`]?.split(',') || [],
    dexalotAuthToken: process.env.API_KEY_DEXALOT_AUTH_TOKEN || '',
    augustusV6Address: '0x6a000f20005980200259b80c5102003040001068',
    executorsAddresses: {
      Executor01: '0x000010036C0190E009a000d0fc3541100A07380A',
      Executor02: '0x00C600b30fb0400701010F4b080409018B9006E0',
      Executor03: '0x0e5891850bb3f03090f03010000806f080040100',
    },
    adapterAddresses: {
      AvalancheAdapter01: '0x745Ec73855CeC7249E5fF4c9DD81cc65b4D297a9',
      AvalancheAdapter02: '0x5FC6a951c5e279d77c4d37F4aa14DaE0187BFD2A',
      AvalancheBuyAdapter: '0x40D9aF198DbfA04734558d53831362059f7Bdcb5',
    },
    uniswapV2ExchangeRouterAddress:
      '0x53e693c6C7FFC4446c53B205Cf513105Bf140D7b',
    rfqConfigs: {},
    rpcPollingMaxAllowedStateDelayInBlocks: 2,
    rpcPollingBlocksBackToTriggerUpdate: 1,
    forceRpcFallbackDexs: [],
    swaapV2AuthToken: process.env.API_KEY_SWAAP_V2_AUTH_TOKEN || '',
  },
  [Network.SONIC]: {
    network: Network.SONIC,
    networkName: 'Sonic Mainnet',
    isTestnet: false,
    nativeTokenName: 'Sonic',
    nativeTokenSymbol: 'S',
    wrappedNativeTokenAddress: '0x039e2fb66102314ce7b64ce5ce3e5183bc94ad38',
    hasEIP1559: true,
    augustusAddress: '0x0000000000000000000000000000000000000000',
    augustusRFQAddress: '0x92EaD5bACf6F0E995FA46Ad8215A9b11f67ca241',
    tokenTransferProxyAddress: '0x0000000000000000000000000000000000000000',
    multicallV2Address: '0xcA11bde05977b3631167028862bE2a173976CA11', // v3
    privateHttpProvider: process.env.HTTP_PROVIDER_146,
    hashFlowAuthToken: process.env.API_KEY_HASHFLOW_AUTH_TOKEN || '',
    hashFlowDisabledMMs:
      process.env[`HASHFLOW_DISABLED_MMS_146`]?.split(',') || [],
    augustusV6Address: '0x6a000f20005980200259b80c5102003040001068',
    executorsAddresses: {
      Executor01: '0x67dd00d00d000003a383b096091f0a3060000d08',
      Executor02: '0x700602C7b720200a09000f38B0d00Ee00c54f000',
      Executor03: '0x0e5891850bb3f03090f03010000806f080040100',
    },
    adapterAddresses: {},
    uniswapV2ExchangeRouterAddress:
      '0xCd8eA16F74d96E1000df8a57267e098c58399e8b',
    rfqConfigs: {},
    rpcPollingMaxAllowedStateDelayInBlocks: 2,
    rpcPollingBlocksBackToTriggerUpdate: 1,
    forceRpcFallbackDexs: [],
  },
  [Network.ARBITRUM]: {
    network: Network.ARBITRUM,
    networkName: 'Arbitrum One',
    isTestnet: false,
    nativeTokenName: 'Ether',
    nativeTokenSymbol: 'ETH',
    wrappedNativeTokenAddress: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    hasEIP1559: false,
    augustusAddress: '0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57',
    augustusRFQAddress: '0x0927FD43a7a87E3E8b81Df2c44B03C4756849F6D',
    tokenTransferProxyAddress: '0x216b4b4ba9f3e719726886d34a177484278bfcae',
    multicallV2Address: '0x7eCfBaa8742fDf5756DAC92fbc8b90a19b8815bF',
    privateHttpProvider: process.env.HTTP_PROVIDER_42161,
    hashFlowAuthToken: process.env.API_KEY_HASHFLOW_AUTH_TOKEN || '',
    swaapV2AuthToken: process.env.API_KEY_SWAAP_V2_AUTH_TOKEN || '',
    nativeApiKey: process.env.API_KEY_NATIVE || '',
    hashFlowDisabledMMs:
      process.env[`HASHFLOW_DISABLED_MMS_42161`]?.split(',') || [],
    augustusV6Address: '0x6a000f20005980200259b80c5102003040001068',
    executorsAddresses: {
      Executor01: '0x000010036C0190E009a000d0fc3541100A07380A',
      Executor02: '0x00C600b30fb0400701010F4b080409018B9006E0',
      Executor03: '0x0e5891850bb3f03090f03010000806f080040100',
    },
    dexalotAuthToken: process.env.API_KEY_DEXALOT_AUTH_TOKEN || '',
    bebopAuthName: process.env.API_KEY_BEBOP_AUTH_NAME || '',
    bebopAuthToken: process.env.API_KEY_BEBOP_AUTH_TOKEN || '',
    adapterAddresses: {
      ArbitrumAdapter01: '0x369A2FDb910d432f0a07381a5E3d27572c876713',
      ArbitrumAdapter02: '0x58a5f0b73969800FAFf8556cD2187E3FCE71A6cb',
      ArbitrumAdapter03: '0x033683deBC0860AbF6F502E1b5F381CFc11C7615',
      ArbitrumBuyAdapter: '0x23A85545632C7f11A53d64AaB532dc06c5731278',
      ArbitrumBuyAdapter02: '0x78A7BcEFc470b7070E03684E567c43Af97487443',
    },
    uniswapV2ExchangeRouterAddress:
      '0xB41dD984730dAf82f5C41489E21ac79D5e3B61bC',
    uniswapV3EventLoggingSampleRate: 0,
    rfqConfigs: {},
    rpcPollingMaxAllowedStateDelayInBlocks: 4,
    rpcPollingBlocksBackToTriggerUpdate: 3,
    forceRpcFallbackDexs: [],
  },
  [Network.OPTIMISM]: {
    network: Network.OPTIMISM,
    networkName: 'Optimistic Ethereum',
    isTestnet: false,
    nativeTokenName: 'Ether',
    nativeTokenSymbol: 'ETH',
    wrappedNativeTokenAddress: '0x4200000000000000000000000000000000000006',
    hasEIP1559: false,
    augustusAddress: '0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57',
    augustusRFQAddress: '0x0927FD43a7a87E3E8b81Df2c44B03C4756849F6D',
    tokenTransferProxyAddress: '0x216b4b4ba9f3e719726886d34a177484278bfcae',
    multicallV2Address: '0x2DC0E2aa608532Da689e89e237dF582B783E552C',
    privateHttpProvider: process.env.HTTP_PROVIDER_10,
    augustusV6Address: '0x6a000f20005980200259b80c5102003040001068',
    executorsAddresses: {
      Executor01: '0x000010036C0190E009a000d0fc3541100A07380A',
      Executor02: '0x00C600b30fb0400701010F4b080409018B9006E0',
      Executor03: '0x0e5891850bb3f03090f03010000806f080040100',
    },
    hashFlowAuthToken: process.env.API_KEY_HASHFLOW_AUTH_TOKEN || '',
    swaapV2AuthToken: process.env.API_KEY_SWAAP_V2_AUTH_TOKEN || '',
    hashFlowDisabledMMs:
      process.env[`HASHFLOW_DISABLED_MMS_10`]?.split(',') || [],
    adapterAddresses: {
      OptimismAdapter01: '0x5dcf544b0c9689fa67dcb713fd2656d217e25a59',
      OptimismAdapter02: '0xb569288D1aC6B4914e0a9F556c8B4a9d52149BD6',
      OptimismBuyAdapter: '0xC1ad83d2DE4799C9b0175468ba69305f4e22EAbb',
    },
    uniswapV2ExchangeRouterAddress:
      '0xB41dD984730dAf82f5C41489E21ac79D5e3B61bC',
    uniswapV3EventLoggingSampleRate: 0,
    bebopAuthName: process.env.API_KEY_BEBOP_AUTH_NAME || '',
    bebopAuthToken: process.env.API_KEY_BEBOP_AUTH_TOKEN || '',
    rfqConfigs: {},
    rpcPollingMaxAllowedStateDelayInBlocks: 5,
    rpcPollingBlocksBackToTriggerUpdate: 3,
    forceRpcFallbackDexs: [],
  },
  [Network.GNOSIS]: {
    network: Network.GNOSIS,
    networkName: 'Gnosis',
    isTestnet: false,
    nativeTokenName: 'xDAI',
    nativeTokenSymbol: 'XDAI',
    wrappedNativeTokenAddress: '0xe91d153e0b41518a2ce8dd3d7944fa863463a97d',
    hasEIP1559: false,
    augustusAddress: '0x0000000000000000000000000000000000000000',
    tokenTransferProxyAddress: '0x0000000000000000000000000000000000000000',
    multicallV2Address: '0xca11bde05977b3631167028862be2a173976ca11',
    privateHttpProvider: process.env.HTTP_PROVIDER_100,
    adapterAddresses: {},
    augustusRFQAddress: '0x92EaD5bACf6F0E995FA46Ad8215A9b11f67ca241',
    augustusV6Address: '0x6a000f20005980200259b80c5102003040001068',
    executorsAddresses: {
      Executor01: '0x000010036c0190e009a000d0fc3541100a07380a',
      Executor02: '0x00c600b30fb0400701010f4b080409018b9006e0',
      Executor03: '0x0e5891850bb3f03090f03010000806f080040100',
    },
    rpcPollingMaxAllowedStateDelayInBlocks: 0,
    rpcPollingBlocksBackToTriggerUpdate: 0,
    hashFlowDisabledMMs: [],
    uniswapV3EventLoggingSampleRate: 0,
    rfqConfigs: {},
    forceRpcFallbackDexs: [],
    uniswapV2ExchangeRouterAddress:
      '0xfa39c1c670b48956eeF9fd0BbD0E81A290326330',
  },
  [Network.BASE]: {
    network: Network.BASE,
    networkName: 'Base',
    isTestnet: false,
    nativeTokenName: 'Ether',
    nativeTokenSymbol: 'ETH',
    wrappedNativeTokenAddress: '0x4200000000000000000000000000000000000006',
    hasEIP1559: false,
    augustusAddress: '0x59C7C832e96D2568bea6db468C1aAdcbbDa08A52',
    augustusRFQAddress: '0xa003dFBA51C9e1e56C67ae445b852bdEd7aC5EEd',
    tokenTransferProxyAddress: '0x93aAAe79a53759cD164340E4C8766E4Db5331cD7',
    multicallV2Address: '0xeDF6D2a16e8081F777eB623EeB4411466556aF3d',
    privateHttpProvider: process.env.HTTP_PROVIDER_8453,
    dexalotAuthToken: process.env.API_KEY_DEXALOT_AUTH_TOKEN || '',
    bebopAuthName: process.env.API_KEY_BEBOP_AUTH_NAME || '',
    bebopAuthToken: process.env.API_KEY_BEBOP_AUTH_TOKEN || '',
    hashFlowAuthToken: process.env.API_KEY_HASHFLOW_AUTH_TOKEN || '',
    swaapV2AuthToken: process.env.API_KEY_SWAAP_V2_AUTH_TOKEN || '',
    nativeApiKey: process.env.API_KEY_NATIVE || '',
    hashFlowDisabledMMs: [],
    augustusV6Address: '0x6a000f20005980200259b80c5102003040001068',
    executorsAddresses: {
      Executor01: '0x000010036C0190E009a000d0fc3541100A07380A',
      Executor02: '0x00C600b30fb0400701010F4b080409018B9006E0',
      Executor03: '0x0e5891850bb3f03090f03010000806f080040100',
    },
    adapterAddresses: {
      BaseAdapter01: '0xe53d24CD81cC81bbf271AD7B02D0d67f851D727c',
      BaseAdapter02: '0x2389726B55948d8D8944b0145204761215AaEc71',
      BaseBuyAdapter: '0xCbde94e645f3391f1AAA5c79019862284BDDB767',
    },
    uniswapV2ExchangeRouterAddress:
      '0x75d199EfB540e47D27D52c62Da3E7daC2B9e834F',
    uniswapV3EventLoggingSampleRate: 0,
    rfqConfigs: {},
    rpcPollingMaxAllowedStateDelayInBlocks: 5,
    rpcPollingBlocksBackToTriggerUpdate: 3,
    forceRpcFallbackDexs: [],
  },
  [Network.PLASMA]: {
    network: Network.PLASMA,
    networkName: 'Plasma',
    isTestnet: false,
    nativeTokenName: 'Plasma',
    nativeTokenSymbol: 'XPL',
    wrappedNativeTokenAddress: '0x6100e367285b01f48d07953803a2d8dca5d19873',
    hasEIP1559: true,
    augustusAddress: '0x0000000000000000000000000000000000000000',
    tokenTransferProxyAddress: '0x0000000000000000000000000000000000000000',
    multicallV2Address: '0xcA11bde05977b3631167028862bE2a173976CA11',
    privateHttpProvider: process.env.HTTP_PROVIDER_9745,
    adapterAddresses: {},
    augustusRFQAddress: '0x92EaD5bACf6F0E995FA46Ad8215A9b11f67ca241',
    augustusV6Address: '0x6a000f20005980200259b80c5102003040001068',
    executorsAddresses: {
      Executor01: '0x000010036C0190E009a000d0fc3541100A07380A',
      Executor02: '0x00C600b30fb0400701010F4b080409018B9006E0',
      Executor03: '0x0e5891850bb3f03090f03010000806f080040100',
    },
    rpcPollingMaxAllowedStateDelayInBlocks: 0,
    rpcPollingBlocksBackToTriggerUpdate: 0,
    hashFlowDisabledMMs: [],
    uniswapV3EventLoggingSampleRate: 0,
    rfqConfigs: {},
    forceRpcFallbackDexs: [],
    uniswapV2ExchangeRouterAddress:
      '0x0000000000000000000000000000000000000000',
  },
  [Network.SEPOLIA]: {
    network: Network.SEPOLIA,
    networkName: 'Sepolia',
    isTestnet: false,
    nativeTokenName: 'Ether',
    nativeTokenSymbol: 'ETH',
    wrappedNativeTokenAddress: '0x7b79995e5f793a07bc00c21412e50ecae098e7f9',
    hasEIP1559: true,
    augustusAddress: '0x0000000000000000000000000000000000000000',
    augustusRFQAddress: '0xF6322953d6bFcEACf77D90BC9a01B055249D44fE',
    tokenTransferProxyAddress: '0x0000000000000000000000000000000000000000',
    multicallV2Address: '0xcA11bde05977b3631167028862bE2a173976CA11',
    privateHttpProvider: process.env.HTTP_PROVIDER_11155111,
    augustusV6Address: '0x6a000f20005980200259b80c5102003040001068',
    adapterAddresses: {},
    rfqConfigs: {},
    hashFlowDisabledMMs: [],
    executorsAddresses: {
      Executor01: '0x000010036c0190e009a000d0fc3541100a07380a',
      Executor02: '0x00c600b30fb0400701010f4b080409018b9006e0',
      Executor03: '0x0e5891850bb3f03090f03010000806f080040100',
    },
    uniswapV2ExchangeRouterAddress:
      '0x0000000000000000000000000000000000000000',
    rpcPollingMaxAllowedStateDelayInBlocks: 0,
    rpcPollingBlocksBackToTriggerUpdate: 0,
    uniswapV3EventLoggingSampleRate: 0,
    forceRpcFallbackDexs: [],
  },
  [Network.UNICHAIN]: {
    network: Network.UNICHAIN,
    networkName: 'Unichain',
    isTestnet: false,
    nativeTokenName: 'Ether',
    nativeTokenSymbol: 'ETH',
    wrappedNativeTokenAddress: '0x4200000000000000000000000000000000000006',
    hasEIP1559: true,
    augustusAddress: '0x0000000000000000000000000000000000000000',
    tokenTransferProxyAddress: '0x0000000000000000000000000000000000000000',
    multicallV2Address: '0xcA11bde05977b3631167028862bE2a173976CA11',
    privateHttpProvider: process.env.HTTP_PROVIDER_130,
    adapterAddresses: {},
    augustusRFQAddress: '0x92EaD5bACf6F0E995FA46Ad8215A9b11f67ca241',
    augustusV6Address: '0x6a000f20005980200259b80c5102003040001068',
    executorsAddresses: {
      Executor01: '0x000010036C0190E009a000d0fc3541100A07380A',
      Executor02: '0x00C600b30fb0400701010F4b080409018B9006E0',
      Executor03: '0x0e5891850bb3f03090f03010000806f080040100',
    },
    rpcPollingMaxAllowedStateDelayInBlocks: 0,
    rpcPollingBlocksBackToTriggerUpdate: 0,
    hashFlowDisabledMMs: [],
    uniswapV3EventLoggingSampleRate: 0,
    rfqConfigs: {},
    forceRpcFallbackDexs: [],
    uniswapV2ExchangeRouterAddress:
      '0x21D2B4641c1802C5f9767FfED28708F3A76Ed0aa',
  },
};

// Should not be used, except by internal test code
export function generateConfig(network: number): Config {
  const baseConfig = baseConfigs[network];
  if (!baseConfig) {
    throw new Error(`No configuration found for network ${network}`);
  }
  const nativeTokenName =
    baseConfig.nativeTokenName || baseConfig.nativeTokenSymbol;
  if (!baseConfig.privateHttpProvider) {
    throw new Error(`Missing HTTP Provider for network ${network}`);
  }
  return {
    network: baseConfig.network,
    networkName: baseConfig.networkName,
    isTestnet: baseConfig.isTestnet,
    mainnetNetwork: baseConfig.mainnetNetwork,
    nativeTokenName,
    nativeTokenSymbol: baseConfig.nativeTokenSymbol,
    wrappedNativeTokenName:
      baseConfig.wrappedNativeTokenName || `Wrapped ${nativeTokenName}`,
    wrappedNativeTokenSymbol:
      baseConfig.wrappedNativeTokenSymbol || `W${baseConfig.nativeTokenSymbol}`,
    wrappedNativeTokenAddress: baseConfig.wrappedNativeTokenAddress,
    hasEIP1559: baseConfig.hasEIP1559,
    augustusAddress: baseConfig.augustusAddress,
    augustusV6Address: baseConfig.augustusV6Address,
    augustusRFQAddress: baseConfig.augustusRFQAddress,
    tokenTransferProxyAddress: baseConfig.tokenTransferProxyAddress,
    multicallV2Address: baseConfig.multicallV2Address,
    privateHttpProvider: baseConfig.privateHttpProvider,
    adapterAddresses: { ...baseConfig.adapterAddresses },
    executorsAddresses: { ...baseConfig.executorsAddresses },
    uniswapV2ExchangeRouterAddress: baseConfig.uniswapV2ExchangeRouterAddress,
    uniswapV3EventLoggingSampleRate: baseConfig.uniswapV3EventLoggingSampleRate,
    rfqConfigs: baseConfig.rfqConfigs,
    rpcPollingMaxAllowedStateDelayInBlocks:
      baseConfig.rpcPollingMaxAllowedStateDelayInBlocks,
    rpcPollingBlocksBackToTriggerUpdate:
      baseConfig.rpcPollingBlocksBackToTriggerUpdate,
    hashFlowAuthToken: baseConfig.hashFlowAuthToken,
    swaapV2AuthToken: baseConfig.swaapV2AuthToken,
    dexalotAuthToken: baseConfig.dexalotAuthToken,
    bebopAuthName: baseConfig.bebopAuthName,
    bebopAuthToken: baseConfig.bebopAuthToken,
    nativeApiKey: baseConfig.nativeApiKey,
    hashFlowDisabledMMs: baseConfig.hashFlowDisabledMMs,
    forceRpcFallbackDexs: baseConfig.forceRpcFallbackDexs,
    apiKeyTheGraph: process.env.API_KEY_THE_GRAPH || '',
  };
}

export class ConfigHelper {
  public masterBlockNumberCacheKey: string;

  constructor(
    public isSlave: boolean,
    public data: Config,
    masterCachePrefix: string,
  ) {
    this.masterBlockNumberCacheKey =
      `${masterCachePrefix}_${data.network}_bn`.toLowerCase();
  }

  wrapETH(token: string): string;
  wrapETH(token: Token): Token;
  wrapETH(token: Token | string): Token | string {
    if (typeof token === 'string')
      return isETHAddress(token) ? this.data.wrappedNativeTokenAddress : token;

    return isETHAddress(token.address)
      ? { address: this.data.wrappedNativeTokenAddress, decimals: 18 }
      : token;
  }

  unwrapETH(token: Token): Token {
    return this.isWETH(token.address)
      ? { address: ETHER_ADDRESS, decimals: 18 }
      : token;
  }

  isWETH(tokenAddress: Address): boolean {
    return (
      tokenAddress.toLowerCase() ===
      this.data.wrappedNativeTokenAddress.toLowerCase()
    );
  }
}

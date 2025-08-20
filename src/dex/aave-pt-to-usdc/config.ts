import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network } from '../../constants';

// Aave V3 PT to USDC

// Pendle V4 Router https://etherscan.io/address/0x888888888889758f76e7103c6cbf23abbf58f946#code
const PENDLE_ROUTER_ADDRESS = '0x888888888889758f76e7103c6cbf23abbf58f946';
// Pendle Oracle https://etherscan.io/address/0x9a9Fa8338dd5E5B2188006f1Cd2Ef26d921650C2
const ORACLE_ADDRESS = '0x9a9Fa8338dd5E5B2188006f1Cd2Ef26d921650C2';

// PT sUSDe 31 Jul 2025: https://etherscan.io/address/0x3b3fb9c57858ef816833dc91565efcd85d96f634
// PT eUSDe 14 Aug 2025: https://etherscan.io/address/0x14bdc3a3ae09f5518b923b69489cbcafb238e617
// PT USDe 31 Jul 2025: https://etherscan.io/address/0x917459337CaAC939D41d7493B3999f571D20D667

export const AavePtToUsdcConfig: DexConfigMap<DexParams> = {
  AavePtToUsdc: {
    [Network.MAINNET]: {
      pendleRouterAddress: PENDLE_ROUTER_ADDRESS,
      oracleAddress: ORACLE_ADDRESS,
      supportedPts: [
        {
          pt: {
            address: '0x9f56094c450763769ba0ea9fe2876070c0fd5f77',
            decimals: 18,
            name: 'PT-sUSDe-25SEP2025',
            expiry: 1764201600,
          },
          marketAddress: '0xa36b60a14a1a5247912584768c6e53e1a269a9f7', // V4 market address (for router)
          exitMarketAddress: '0xa36b60a14a1a5247912584768c6e53e1a269a9f7', // V4 market address (for exit-position API)
          underlyingAssetAddress: '0xc01cde799245a25e6eabc550b36a47f6f83cc0f1', // SY-sUSDe
          underlyingRawAddress: '0x9D39A5DE30e57443BfF2A8307A4256c8797A3497', // raw sUSDe
        },
        {
          pt: {
            address: '0xbc6736d346a5ebc0debc997397912cd9b8fae10a',
            decimals: 18,
            name: 'PT-USDe-31JUL2025',
            expiry: 1764201600,
          },
          marketAddress: '0x6d98a2b6cdbf44939362a3e99793339ba2016af4', // V4 market address (for router)
          exitMarketAddress: '0x9df192d13d61609d1852461c4850595e1f56e714', // V4 market address (for exit-position API)
          underlyingAssetAddress: '0xf3dbde762e5b67fad09d88da3dfd38a83f753ffe', // SY-USDe
          underlyingRawAddress: '0x4c9edd5852cd905f086c759e8383e09bff1e68b3', // raw USDe
        },
      ],
    },
  },
};

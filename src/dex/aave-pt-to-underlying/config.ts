import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network } from '../../constants';

// Pendle V4 Router https://etherscan.io/address/0x888888888889758f76e7103c6cbf23abbf58f946#code
const PENDLE_ROUTER_ADDRESS = '0x888888888889758f76e7103c6cbf23abbf58f946';
// Pendle Oracle https://etherscan.io/address/0x9a9Fa8338dd5E5B2188006f1Cd2Ef26d921650C2
const ORACLE_ADDRESS = '0x9a9Fa8338dd5E5B2188006f1Cd2Ef26d921650C2';

// PT sUSDe 25 Sep 2025: https://etherscan.io/address/0x9f56094c450763769ba0ea9fe2876070c0fd5f77
// PT USDe 25 Sep 2025: https://etherscan.io/address/0xbc6736d346a5ebc0debc997397912cd9b8fae10a
// sUSDe: https://etherscan.io/address/0x9d39a5de30e57443bff2a8307a4256c8797a3497
// USDe: https://etherscan.io/address/0x4c9edd5852cd905f086c759e8383e09bff1e68b3

export const AavePtToUnderlyingConfig: DexConfigMap<DexParams> = {
  AavePtToUnderlying: {
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
          marketAddress: '0xa36b60a14a1a5247912584768c6e53e1a269a9f7', // PT sUSDe 25 Sep 2025 market
          exitMarketAddress: '0xa36b60a14a1a5247912584768c6e53e1a269a9f7', // Same as market for now
          underlyingAssetAddress: '0x9D39A5DE30e57443BfF2A8307A4256c8797A3497', // sUSDe
          underlyingRawAddress: '0x9D39A5DE30e57443BfF2A8307A4256c8797A3497', // raw sUSDe
        },
        {
          pt: {
            address: '0xbc6736d346a5ebc0debc997397912cd9b8fae10a',
            decimals: 18,
            name: 'PT-USDe-25SEP2025',
            expiry: 1764201600,
          },
          marketAddress: '0x6d98a2b6cdbf44939362a3e99793339ba2016af4', // PT USDe market
          exitMarketAddress: '0x6d98a2b6cdbf44939362a3e99793339ba2016af4', // Same as market for now
          underlyingAssetAddress: '0x4c9edd5852cd905f086c759e8383e09bff1e68b3', // USDe
          underlyingRawAddress: '0x4c9edd5852cd905f086c759e8383e09bff1e68b3', // raw USDe
        },
      ],
    },
  },
};

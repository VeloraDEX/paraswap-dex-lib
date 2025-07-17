import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network } from '../../constants';

// Pendle V4 Router https://etherscan.io/address/0x888888888889758f76e7103c6cbf23abbf58f946#code
const PENDLE_ROUTER_ADDRESS = '0x888888888889758f76e7103c6cbf23abbf58f946';
// sUSDe PT 31 Jul 2025 https://etherscan.io/address/0x3b3fb9c57858ef816833dc91565efcd85d96f634
const OLD_PT_ADDRESS = '0x3b3fb9c57858ef816833dc91565efcd85d96f634';
// sUSDe PT 25 Sep 2025 https://etherscan.io/address/0x9f56094c450763769ba0ea9fe2876070c0fd5f77
const NEW_PT_ADDRESS = '0x9f56094c450763769ba0ea9fe2876070c0fd5f77';
// sUSDe Market 31 Jul 2025 https://etherscan.io/address/0x4339ffe2b7592dc783ed13cce310531ab366deac
const OLD_MARKET_ADDRESS = '0x4339ffe2b7592dc783ed13cce310531ab366deac';
// sUSDe Market 25 Sep 2025 https://etherscan.io/address/0xa36b60a14a1a5247912584768c6e53e1a269a9f7
const NEW_MARKET_ADDRESS = '0xa36b60a14a1a5247912584768c6e53e1a269a9f7';
// Pendle Oracle https://etherscan.io/address/0x9a9Fa8338dd5E5B2188006f1Cd2Ef26d921650C2
const ORACLE_ADDRESS = '0x9a9Fa8338dd5E5B2188006f1Cd2Ef26d921650C2';
// sUSDe Token https://etherscan.io/address/0x9D39A5DE30e57443BfF2A8307A4256c8797A3497
const UNDERLYING_TOKEN_ADDRESS = '0x9D39A5DE30e57443BfF2A8307A4256c8797A3497';

export const AaveV3PtRollOverConfig: DexConfigMap<DexParams> = {
  AaveV3Pendle: {
    [Network.MAINNET]: {
      pendleRouterAddress: PENDLE_ROUTER_ADDRESS,
      oldPendleToken: {
        address: OLD_PT_ADDRESS,
        decimals: 18,
        name: 'PT-sUSDe-31JUL2025',
        expiry: 1753574400, // July 31, 2025
      },
      newPendleToken: {
        address: NEW_PT_ADDRESS,
        decimals: 18,
        name: 'PT-sUSDe-25SEP2025',
        expiry: 1758758400, // September 25, 2025
      },
      oldMarketAddress: OLD_MARKET_ADDRESS,
      newMarketAddress: NEW_MARKET_ADDRESS,
      oracleAddress: ORACLE_ADDRESS,
      underlyingAssetAddress: UNDERLYING_TOKEN_ADDRESS,
    },
  },
};

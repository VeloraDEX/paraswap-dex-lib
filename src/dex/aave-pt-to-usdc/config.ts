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
            address: '0x3b3fb9c57858ef816833dc91565efcd85d96f634',
            decimals: 18,
            name: 'PT-sUSDe-31JUL2025',
            expiry: 1753929600,
          },
          marketAddress: '0x4339ffe2b7592dc783ed13cce310531ab366deac', // V4 market address (for router)
          exitMarketAddress: '0xEd8f8f8E5B1C0Bd3cBB0C7cE6c2b6B1E5C7D3A3B', // V2 market address (for exit-position API)
          underlyingAssetAddress: '0x5cb12D1CeE6C1353FdEF5e6627D2C1cCd0eE2A9d', // SY-sUSDe
          underlyingRawAddress: '0x9D39A5DE30e57443BfF2A8307A4256c8797A3497', // raw sUSDe
        },
        {
          pt: {
            address: '0x14bdc3a3ae09f5518b923b69489cbcafb238e617',
            decimals: 18,
            name: 'PT-eUSDe-14AUG2025',
            expiry: 1755196800,
          },
          marketAddress: '0xe93b4a93e80bd3065b290394264af5d82422ee70', // V4 market address (for router)
          exitMarketAddress: '0xEd8f8f8E5B1C0Bd3cBB0C7cE6c2b6B1E5C7D3A3B', // V2 market address (for exit-position API)
          underlyingAssetAddress: '0x90d2af7d622ca3141efa4d8f1f24d86e5974cc8f', // eUSDe
          underlyingRawAddress: '0x90d2af7d622ca3141efa4d8f1f24d86e5974cc8f', // raw eUSDe
        },
        {
          pt: {
            address: '0x917459337CaAC939D41d7493B3999f571D20D667',
            decimals: 18,
            name: 'PT-USDe-31JUL2025',
            expiry: 1753929600,
          },
          marketAddress: '0x9df192d13d61609d1852461c4850595e1f56e714', // V4 market address (for router)
          exitMarketAddress: '0xEd8f8f8E5B1C0Bd3cBB0C7cE6c2b6B1E5C7D3A3B', // V2 market address (for exit-position API)
          underlyingAssetAddress: '0x4c9edd5852cd905f086c759e8383e09bff1e68b3', // USDe
          underlyingRawAddress: '0x4c9edd5852cd905f086c759e8383e09bff1e68b3', // raw USDe
        },
      ],
    },
  },
};

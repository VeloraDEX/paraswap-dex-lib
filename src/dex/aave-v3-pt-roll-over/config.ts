import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network } from '../../constants';

// Pendle V4 Router
const PENDLE_ROUTER_ADDRESS = '0x888888888889758f76e7103c6cbf23abbf58f946';
// sUSDe PT 29 May 2025
const OLD_PT_ADDRESS = '0xb7de5dfcb74d25c2f21841fbd6230355c50d9308';
// sUSDe PT 31 Jul 2025
const NEW_PT_ADDRESS = '0x3b3fb9c57858ef816833dc91565efcd85d96f634';
// sUSDe Market 29 May 2025
const OLD_MARKET_ADDRESS = '0xb162b764044697cf03617c2efbcb1f42e31e4766';
// sUSDe Market 31 Jul 2025
const NEW_MARKET_ADDRESS = '0x4339ffe2b7592dc783ed13cce310531ab366deac';
// Pendle Oracle
const ORACLE_ADDRESS = '0x9a9Fa8338dd5E5B2188006f1Cd2Ef26d921650C2';

export const AaveV3PtRollOverConfig: DexConfigMap<DexParams> = {
  AaveV3PtRollOver: {
    [Network.MAINNET]: {
      chainId: 1,
      pendleSdkBaseUrl: 'https://api-v2.pendle.finance',
      defaultSlippageForQuoting: 0.01, // 1%
      pendleRouterAddress: PENDLE_ROUTER_ADDRESS,
      oldPtAddress: {
        address: OLD_PT_ADDRESS,
        decimals: 18,
      },
      newPtAddress: {
        address: NEW_PT_ADDRESS,
        decimals: 18,
      },
      oldMarketAddress: OLD_MARKET_ADDRESS,
      newMarketAddress: NEW_MARKET_ADDRESS,
      oracleAddress: ORACLE_ADDRESS,
      decimals: 18,
      // Mapping of AAVE underlying assets to their aToken addresses
      aaveAssetMapping: {
        USDC: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
        aUSDC: '0x98c23e9d8f34fefb1b7bd6a91b7ff122f4e16f5c', // aUSDC
        USDT: '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
        aUSDT: '0x3Ed3B47Dd13EC9a98b44e6204A523E766B225811', // aUSDT
        DAI: '0x6b175474e89094c44da98b954eedeac495271d0f', // DAI
        aDAI: '0x028171bCA77440897B824Ca71D1c56caC55b68A3', // aDAI
        WETH: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH
        aWETH: '0x030ba81f1c18d280636f32af80b9aad02cf0854e', // aWETH
        sUSDe: '0x9D39A5DE30e57443BfF2A8307A4256c8797A3497', // sUSDe underlying for PT tokens
      },
    },
  },
};

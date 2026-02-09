import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network } from '../../constants';

export const BebopConfig: DexConfigMap<DexParams> = {
  Bebop: {
    [Network.MAINNET]: {
      settlementAddress: '0xbbbbbBB520d69a9775E85b458C58c648259FAD5F',
      chainName: 'ethereum',
      middleTokens: [
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
        '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
        '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
      ],
    },
    [Network.ARBITRUM]: {
      settlementAddress: '0xbbbbbBB520d69a9775E85b458C58c648259FAD5F',
      chainName: 'arbitrum',
      middleTokens: [
        '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', // USDC.e
        '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC
        '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', // USDT
        '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // WETH
      ],
    },
    [Network.BASE]: {
      settlementAddress: '0xbbbbbBB520d69a9775E85b458C58c648259FAD5F',
      chainName: 'base',
      middleTokens: [
        '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC
        '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA', // USDbC
        '0x4200000000000000000000000000000000000006', // WETH
      ],
    },
    [Network.OPTIMISM]: {
      settlementAddress: '0xbbbbbBB520d69a9775E85b458C58c648259FAD5F',
      chainName: 'optimism',
      middleTokens: ['0x7F5c764cBc14f9669B88837ca1490cCa17c31607'],
    },
    [Network.BSC]: {
      settlementAddress: '0xbbbbbBB520d69a9775E85b458C58c648259FAD5F',
      chainName: 'bsc',
      middleTokens: ['0x55d398326f99059fF775485246999027B3197955'],
    },
    [Network.POLYGON]: {
      settlementAddress: '0xbbbbbBB520d69a9775E85b458C58c648259FAD5F',
      chainName: 'polygon',
      middleTokens: ['0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'],
    },
    [Network.AVALANCHE]: {
      settlementAddress: '0xbbbbbBB520d69a9775E85b458C58c648259FAD5F',
      chainName: 'avalanche',
      middleTokens: [
        '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', // USDC
        '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', // USDT
      ],
    },
  },
};

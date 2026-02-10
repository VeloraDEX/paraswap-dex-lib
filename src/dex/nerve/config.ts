import { SwapSide } from '@paraswap/core';
import { DexParams } from './types';
import { AdapterMappings, DexConfigMap } from '../../types';
import { Network } from '../../constants';
import nervePoolABI from '../../abi/nerve/nerve-pool.json';
import axialPoolABI from '../../abi/nerve/axial-pool.json';
import ironV2PoolABI from '../../abi/nerve/iron-v2-pool.json';

export const threePoolName = 'ThreePool';

// The order of the coins must be places with the same indexes as in contracts
export const NerveConfig: DexConfigMap<DexParams> = {
  Nerve: {
    [Network.BSC]: {
      poolConfigs: {
        [threePoolName]: {
          name: threePoolName,
          address: '0x1B3771a66ee31180906972580adE9b81AFc5fCDc',
          coins: [
            {
              address: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', // 0 - BUSD
              decimals: 18,
            },
            {
              address: '0x55d398326f99059fF775485246999027B3197955', // 1 - USDT
              decimals: 18,
            },
            {
              address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', // 2 - USDC
              decimals: 18,
            },
          ],
          isMetapool: false,
          isUSDPool: true,
          lpToken: {
            address: '0xf2511b5E4FB0e5E2d123004b672BA14850478C14',
            decimals: 18,
          },
        },
        BTC: {
          name: 'BTC',
          address: '0x6C341938bB75dDe823FAAfe7f446925c66E6270c',
          coins: [
            {
              address: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c', // 0 - bBTC
              decimals: 18,
            },
            {
              address: '0x54261774905f3e6E9718f2ABb10ed6555cae308a', // 1 - anyBTC
              decimals: 8,
            },
          ],
          isMetapool: false,
          isUSDPool: false,
          lpToken: {
            address: '0xD1D5Af92C606C6F2eC59D453f57A6FCc188D7dB5',
            decimals: 18,
          },
        },
        ETH: {
          name: 'ETH',
          address: '0x146CD24dCc9f4EB224DFd010c5Bf2b0D25aFA9C0',
          coins: [
            {
              address: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8', // 0 - bETH
              decimals: 18,
            },
            {
              address: '0x6F817a0cE8F7640Add3bC0c1C2298635043c2423', // 1 - anyETH
              decimals: 18,
            },
          ],
          isMetapool: false,
          isUSDPool: false,
          lpToken: {
            address: '0x0d283BF16A9bdE49cfC48d8dc050AF28b71bdD90',
            decimals: 18,
          },
        },
        // fUSDT: {
        //   name: 'fUSDT',
        //   address: '0xd0fBF0A224563D5fFc8A57e4fdA6Ae080EbCf3D3',
        //   coins: [
        //     '0x049d68029688eAbF473097a2fC38ef61633A3C7A', // 0 - fUSDT
        //     '0xf2511b5E4FB0e5E2d123004b672BA14850478C14', // 1 - 3Pool-LP
        //   ],
        //   isMetapool: true,
        //   lpTokenAddress: '0x2e91A0CECf28c5E518bB2E7fdcd9F8e2cd511c10',
        // },
        // UST: {
        //   name: 'UST',
        //   address: '0x2dcCe1586b1664f41C72206900e404Ec3cA130e0',
        //   coins: [
        //     '0x23396cF899Ca06c4472205fC903bDB4de249D6fC', // 0 - wUST
        //     '0xf2511b5E4FB0e5E2d123004b672BA14850478C14', // 1 - 3Pool-LP
        //   ],
        //   isMetapool: true,
        //   lpTokenAddress: '0x35Ce243e0DC9eD77e3C348Bb2742095F78e1Cb70',
        // },
        // rUSD: {
        //   name: 'rUSD',
        //   address: '0x0eafaa7ed9866c1f08ac21dd0ef3395e910f7114',
        //   coins: [
        //     '0x07663837218A003e66310a01596af4bf4e44623D', // 0 - rUSD
        //     '0xf2511b5E4FB0e5E2d123004b672BA14850478C14', // 1 - 3Pool-LP
        //   ],
        //   isMetapool: true,
        //   lpTokenAddress: '0x870ee4d19c12A789c61de69E3E5eFb42383E4434',
        // },
      },
      abi: nervePoolABI,
    },
  },
  IronV2: {
    [Network.POLYGON]: {
      poolConfigs: {
        IS3USD_POLYGON: {
          name: 'IS3USD_POLYGON',
          address: '0x837503e8A8753ae17fB8C8151B8e6f586defCb57',
          coins: [
            {
              address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', // 0 - USDC
              decimals: 6,
            },
            {
              address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', // 1 - USDT
              decimals: 6,
            },
            {
              address: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', // 2 - DAI
              decimals: 18,
            },
          ],
          isMetapool: false,
          isUSDPool: true,
          lpToken: {
            address: '0xb4d09ff3dA7f9e9A2BA029cb0A81A989fd7B8f17',
            decimals: 18,
          },
        },
      },
      abi: ironV2PoolABI,
    },
  },
  Synapse: {
    [Network.MAINNET]: {
      poolConfigs: {
        stableSwapPool: {
          name: 'stableSwapPool',
          address: '0x1116898dda4015ed8ddefb84b6e8bc24528af2d8',
          coins: [
            {
              address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', // 0 - DAI
              decimals: 18,
            },
            {
              address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // 1 - USDC
              decimals: 6,
            },
            {
              address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', // 2 - USDT
              decimals: 6,
            },
          ],
          isMetapool: false,
          isUSDPool: true,
          lpToken: {
            address: '0x1B84765dE8B7566e4cEAF4D0fD3c5aF52D3DdE4F',
            decimals: 18,
          },
        },
      },
      abi: axialPoolABI,
    },
  },
};

export const NERVE_GAS_COST = 200 * 1000;

export const Adapters: Record<number, AdapterMappings> = {
  [Network.BSC]: {
    [SwapSide.SELL]: [{ name: 'BscAdapter01', index: 4 }],
  },
  [Network.AVALANCHE]: {
    [SwapSide.SELL]: [{ name: 'AvalancheAdapter01', index: 3 }],
  },
  [Network.POLYGON]: {
    [SwapSide.SELL]: [{ name: 'PolygonAdapter01', index: 7 }],
  },
  [Network.MAINNET]: {
    [SwapSide.SELL]: [{ name: 'Adapter02', index: 8 }],
  },
  [Network.ARBITRUM]: {
    [SwapSide.SELL]: [{ name: 'ArbitrumAdapter01', index: 8 }],
  },
};

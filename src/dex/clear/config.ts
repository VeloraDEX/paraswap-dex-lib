import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network, SwapSide } from '../../constants';

// TODO: Update adapter indices after getting them from ParaSwap team
export const Adapters: {
  [chainId: number]: { [side: string]: { name: string; index: number }[] };
} = {
  // TODO: Add adapter configuration for each network Clear is deployed on
  // Example:
  // [Network.MAINNET]: {
  //   [SwapSide.SELL]: [
  //     {
  //       name: 'Adapter01',
  //       index: 0, // TODO: Get actual index from ParaSwap
  //     },
  //   ],
  //   [SwapSide.BUY]: [
  //     {
  //       name: 'BuyAdapter',
  //       index: 0, // TODO: Get actual index from ParaSwap
  //     },
  //   ],
  // },
};

export const ClearConfig: DexConfigMap<DexParams> = {
  Clear: {
    // Arbitrum Sepolia (Testnet)
    // NOTE: Using Network.SEPOLIA as Network.ARBITRUM_SEPOLIA doesn't exist in ParaSwap constants
    // TODO: Add proper Arbitrum Sepolia constant or use ARBITRUM for mainnet
    [Network.SEPOLIA]: {
      factoryAddress: '0x6f73CCe0210Fe9e1B8c650739C06E8a400d09E68',
      swapAddress: '0x5B69f9D067077c3FBb22Bd732d2c34A9731fC162', // ClearSwap proxy
      oracleAddress: '0x50c2584E2f32533e9307df9eE0Beb229fC20f517', // ClearOracle proxy
      accessManagerAddress: '0x3C2Fd22Ad486293e1F59dA6e42B28EC8DC1D63C7',
      subgraphURL: 'https://api-arb-sepolia-clear.trevee.xyz/graphql',
      poolGasCost: 150 * 1000, // TODO: Get real gas estimate
      feeCode: 0, // TODO: Get actual fee (if any)
    },

    // TODO: Add mainnet configs when available
    // [Network.ETHEREUM]: {
    //   factoryAddress: '0x...', // TODO
    //   swapAddress: '0x...', // TODO
    //   oracleAddress: '0x...', // TODO
    //   subgraphURL: '...', // TODO
    //   poolGasCost: 150 * 1000,
    //   feeCode: 0,
    // },
    // [Network.SONIC]: {
    //   factoryAddress: '0x...', // TODO
    //   swapAddress: '0x...', // TODO
    //   oracleAddress: '0x...', // TODO
    //   subgraphURL: '...', // TODO
    //   poolGasCost: 150 * 1000,
    //   feeCode: 0,
    // },
  },
};

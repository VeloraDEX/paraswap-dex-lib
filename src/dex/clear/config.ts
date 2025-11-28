import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network, SwapSide } from '../../constants';

// TODO: Update adapter indices after getting them from ParaSwap team
export const ClearAdapters: {
  [chainId: number]: {
    [side in SwapSide]?: { name: string; index: number }[];
  };
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
  clear: {
    // Arbitrum Sepolia (Testnet)
    [Network.ARBITRUM_SEPOLIA]: {
      factoryAddress: '0x514Ed620137c62484F426128317e5AA86edd7475',
      swapAddress: '0x5144E17c86d6e1B25F61a036024a65bC4775E37e', // ClearSwap proxy
      oracleAddress: '0x716A0b9E20Bd10b82840733De144fAb69bbAEda3', // ClearOracle proxy
      accessManagerAddress: '0x2101BC8FaF1D12bEdc3a73e73BE418a8c3b18E1B',
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

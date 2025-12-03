import { Adapter, DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network, SwapSide } from '../../constants';

// TODO: Update adapter indices after getting them from ParaSwap team
export const ClearAdaptersConfig: {
  [chainId: number]: {
    [side in SwapSide]?: Adapter[];
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
    // Ethereum Mainnet
    [Network.MAINNET]: {
      factoryAddress: '0xcEAc924839ba0ef49613d8FF10609434939bEb5b',
      swapAddress: '0xC12247E25bf2ec1a1d43eFa7b5f9e6b579B32F40', // ClearSwap proxy
      oracleAddress: '0xA84933DEE05514258E4C2b54468389539567634F', // ClearOracle proxy
      accessManagerAddress: '0x42d3E0D351cD3E8aE25b1632611d4411E8d801D9',
      subgraphURL: 'https://api-eth-mainnet-clear.trevee.xyz/graphql',
      poolGasCost: 150_000,
      feeCode: 0,
    },

    // Arbitrum Sepolia (Testnet)
    [Network.ARBITRUM_SEPOLIA]: {
      factoryAddress: '0xd4CE4e5dd7F855A6D02510f7477EF439948338B1',
      swapAddress: '0x799E139f31CE15760A73B22f2DA7f3e402037EaE', // ClearSwap proxy
      oracleAddress: '0x5a1703857B441b205d1f2071766788F86889271f', // ClearOracle proxy
      accessManagerAddress: '0x3Be1099f5DBC321A537fC57197a351193DaF0b5B',
      subgraphURL: 'https://api-arb-sepolia-clear.trevee.xyz/graphql',
      poolGasCost: 150_000,
      feeCode: 0,
    },
  },
};

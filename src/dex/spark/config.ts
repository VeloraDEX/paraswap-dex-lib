import {
  SparkData,
  SparkParams,
  SparkSDaiFunctions,
  SparkSUSDSFunctions,
  SparkSUSDSPsmFunctions,
} from './types';
import {
  Address,
  DexConfigMap,
  DexExchangeParam,
  NumberAsString,
} from '../../types';
import { Network } from '../../constants';
import { SwapSide } from '@paraswap/core';
import PotAbi from '../../abi/maker-psm/pot.json';
import SavingsUSDSAbi from '../../abi/sdai/SavingsUSDS.abi.json';
import SavingsDaiAbi from '../../abi/sdai/SavingsDai.abi.json';
import SparkPSM3Abi from '../../abi/sdai/PSM3.abi.json';
import SSRAuthOracleAbi from '../../abi/sdai/SSRAuthOracle.abi.json';
import { Interface } from '@ethersproject/abi';

export const SDaiConfig: DexConfigMap<SparkParams> = {
  Spark: {
    [Network.MAINNET]: {
      sdaiAddress: '0x83F20F44975D03b1b09e64809B757c47f942BEeA',
      daiAddress: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      potAddress: '0x197E90f9FAD81970bA7976f33CbD77088E5D7cf7',
      savingsRate: {
        symbol: 'dsr',
        // bytes32 repr of "dsr" string
        topic:
          '0x6473720000000000000000000000000000000000000000000000000000000000',
      },
      poolInterface: new Interface(PotAbi),
      exchangeInterface: new Interface(SavingsDaiAbi),
      swapFunctions: SparkSDaiFunctions,
      referralCode: null,
    },
  },
  sUSDS: {
    [Network.MAINNET]: {
      sdaiAddress: '0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD', // sUSDS
      daiAddress: '0xdC035D45d973E3EC169d2276DDab16f1e407384F', // USDS
      potAddress: '0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD', // no separate pot, sUSDS is the pot
      savingsRate: {
        symbol: 'ssr',
        // bytes32 repr of "ssr" string
        topic:
          '0x7373720000000000000000000000000000000000000000000000000000000000',
      },
      poolInterface: new Interface(SavingsUSDSAbi),
      exchangeInterface: new Interface(SavingsUSDSAbi),
      swapFunctions: SparkSUSDSFunctions,
      referralCode: '1004',
    },
  },
};

export const Adapters: {
  [chainId: number]: {
    [side: string]: { name: string; index: number }[];
  };
} = {
  [Network.MAINNET]: {
    [SwapSide.SELL]: [{ name: 'Adapter06', index: 1 }],
    [SwapSide.BUY]: [{ name: 'BuyAdapter02', index: 4 }],
  },
};

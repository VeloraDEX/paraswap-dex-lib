import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network } from '../../constants';
import DaiUsdsConverterABI from '../../abi/sky-converter/DaiUsdsConverter.json';
import MkrSkyConverterABI from '../../abi/sky-converter/MkrSkyConverter.json';
import { Interface } from '@ethersproject/abi';

export const SkyConverterConfig: DexConfigMap<DexParams> = {
  DaiUsds: {
    [Network.MAINNET]: {
      converterAddress: '0x3225737a9Bbb6473CB4a45b7244ACa2BeFdB276A',
      oldTokenAddress: '0x6b175474e89094c44da98b954eedeac495271d0f',
      newTokenAddress: '0xdC035D45d973E3EC169d2276DDab16f1e407384F',
      oldToNewFunctionName: 'daiToUsds',
      newToOldFunctionName: 'usdsToDai',
      newTokenRateMultiplier: 1n, // constant, never to be updated
      converterIface: new Interface(DaiUsdsConverterABI),
    },
  },
  MkrSky: {
    [Network.MAINNET]: {
      converterAddress: '0xA1Ea1bA18E88C381C724a75F23a130420C403f9a',
      oldTokenAddress: '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2',
      newTokenAddress: '0x56072C95FAA701256059aa122697B133aDEd9279',
      oldToNewFunctionName: 'mkrToSky',
      newTokenRateMultiplier: 24_000n, // constant, never to be updated
      converterIface: new Interface(MkrSkyConverterABI),
      converterFee: true,
    },
  },
};

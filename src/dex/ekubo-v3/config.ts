import { Network } from '../../constants';
import { DexConfigMap } from '../../types';
import { DexParams } from './types';

export const DEX_KEY = 'EkuboV3';

export const CORE_ADDRESS = '0x00000000000014aA86C5d3c41765bb24e11bd701';
export const ORACLE_ADDRESS = '0x517E506700271AEa091b02f42756F5E174Af5230';
export const MEV_CAPTURE_ADDRESS = '0x5555fF9Ff2757500BF4EE020DcfD0210CFfa41Be';
export const TWAMM_ADDRESS = '0xd4F1060cB9c1A13e1d2d20379b8aa2cF7541eD9b';
export const QUOTE_DATA_FETCHER_ADDRESS =
  '0x5a3f0f1da4ac0c4b937d5685f330704c8e8303f1';
export const TWAMM_DATA_FETCHER_ADDRESS =
  '0xc07e5b80750247c8b5d7234a9c79dfc58785392b';
export const ROUTER_ADDRESS = '0xd26f20001a72a18C002b00e6710000d68700ce00';

export const EKUBO_CONFIG: DexConfigMap<DexParams> = {
  [DEX_KEY]: {
    [Network.MAINNET]: {
      subgraphId: '6MLKVikss1iYdhhggAR1w6Vqw2Z386AqNLMZYr8qaeG9',
    },
  },
};

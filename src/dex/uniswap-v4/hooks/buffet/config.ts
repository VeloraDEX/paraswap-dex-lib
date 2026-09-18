import { Network, NULL_ADDRESS } from '../../../../constants';
import { HookConfig } from '../types';
import { HookParams } from './types';

export const BASE_USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';

export const BuffetHookConfig: HookConfig<HookParams> = {
  [Network.BASE]: {
    hookAddress: '0x880bfa436d722bfde337eafc7c22123c17b90088',
    priceEngine: '0xf57fe1e9a830126e5239fe07589e6995e4a35a36',
    poolManager: '0x498581ff718922c3f8e6a244956af099b2652b2b',
    poolId:
      '0xaf36a3b872ece56b04af777bf6867cf79b91cb0212f12c92f27fd1bb27dd25a2',
    token0: NULL_ADDRESS,
    token1: BASE_USDC,
    fee: '100',
    tickSpacing: '1',
  },
};

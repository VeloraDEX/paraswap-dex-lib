import { DexConfigMap } from '../../types';
import { mainnets } from '@airswap/constants';
//@ts-ignore
import registryBlocks from '@airswap/registry/deploys-blocks';
import { AirSwapDeployment } from './types';

const AirSwap: any = {};
let length = mainnets.length;
while (length--) {
  AirSwap[mainnets[length]] = {
    swapERC20Address: '0x0C9b31Dc37718417608CE22bb1ba940f702BF90B',
    registryAddress: '0x339Eb75235CBf823C6352D529A258226ecF59cfF',
    registryBlock: registryBlocks[mainnets[length]],
    domainName: 'SWAP_ERC20',
    domainVersion: '4.1',
  };
}

export const AirSwapConfig: DexConfigMap<AirSwapDeployment> = {
  AirSwap,
};

import { Network } from '../../constants';
import { Address } from '../../types';

export const TesseraConfig: Record<number, { routerAddress: Address }> = {
  [Network.BASE]: {
    routerAddress: '0x55555522005BcAE1c2424D474BfD5ed477749E3e',
  },
  [Network.BSC]: {
    routerAddress: '0x55555522005BcAE1c2424D474BfD5ed477749E3e',
  },
};

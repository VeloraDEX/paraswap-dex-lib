import { Network } from '../../constants';
import { Address } from '../../types';

export const TesseraConfig: Record<number, { routerAddress: Address }> = {
  [Network.BASE]: {
    routerAddress: '0x55555522005bcae1c2424d474bfd5ed477749e3e',
  },
  [Network.BSC]: {
    routerAddress: '0x55555522005bcae1c2424d474bfd5ed477749e3e',
  },
};

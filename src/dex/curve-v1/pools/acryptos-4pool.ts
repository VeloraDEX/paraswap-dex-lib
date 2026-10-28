import { Address } from '../../../types';
import { SidechainPool } from './sidechain-pool';
import StableSwapAcryptos4Pool from '../../../abi/curve-v1/StableSwapAcryptos4Pool.json';
import { IDexHelper } from '../../../dex-helper';
import { bigNumberify } from '../../../utils';

// ACS4USD on BSC
const pool = 'acryptos4pool';
export const address: Address =
  '0xb3F0C9ea1F05e312093Fdb031E789A756659B0AC'.toLowerCase();
const tokenAddress: Address = '0x83D69Ef5c9837E21E2389D47d791714F5771F29b';
const N_COINS: number = 4;
const PRECISION_MUL = ['1', '1', '1', '1'].map(bigNumberify);
const COINS = [
  '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
  '0x55d398326f99059fF775485246999027B3197955',
  '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3',
  '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
];

export class Acryptos4Pool extends SidechainPool {
  constructor(parentName: string, dexHelper: IDexHelper) {
    super(
      parentName,
      dexHelper,
      pool,
      address,
      tokenAddress,
      StableSwapAcryptos4Pool,
      N_COINS,
      PRECISION_MUL,
      COINS,
      'Acryptos4Pool',
    );
  }
}

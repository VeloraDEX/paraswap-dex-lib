import { Address } from '../../../types';
import { SidechainPool } from './sidechain-pool';
import StableSwapOptimism3Pool from '../../../abi/curve-v1/StableSwapOptimism3Pool.json';
import { IDexHelper } from '../../../dex-helper';
import { bigNumberify } from '../../../utils';

const pool = 'optimism3pool';
export const address: Address =
  '0x1337BedC9D22ecbe766dF105c9623922A27963EC'.toLowerCase();
// The pool is its own LP token
const tokenAddress: Address = address;
const N_COINS: number = 3;
const PRECISION_MUL = ['1', '1000000000000', '1000000000000'].map(bigNumberify);
const COINS = [
  '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
  '0x7F5c764cBc14f9669B88837ca1490cCa17c31607',
  '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
];

export class Optimism3Pool extends SidechainPool {
  constructor(parentName: string, dexHelper: IDexHelper) {
    super(
      parentName,
      dexHelper,
      pool,
      address,
      tokenAddress,
      StableSwapOptimism3Pool,
      N_COINS,
      PRECISION_MUL,
      COINS,
      'Optimism3Pool',
    );
  }
}

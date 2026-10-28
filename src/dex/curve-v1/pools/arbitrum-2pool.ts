import { Address } from '../../../types';
import { SidechainPool } from './sidechain-pool';
import StableSwapArbitrum2Pool from '../../../abi/curve-v1/StableSwapArbitrum2Pool.json';
import { IDexHelper } from '../../../dex-helper';
import { bigNumberify } from '../../../utils';

const pool = 'arbitrum2pool';
export const address: Address =
  '0x7f90122BF0700F9E7e1F688fe926940E8839F353'.toLowerCase();
// The pool is its own LP token
const tokenAddress: Address = address;
const N_COINS: number = 2;
const PRECISION_MUL = ['1000000000000', '1000000000000'].map(bigNumberify);
const COINS = [
  '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
  '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
];

export class Arbitrum2Pool extends SidechainPool {
  constructor(parentName: string, dexHelper: IDexHelper) {
    super(
      parentName,
      dexHelper,
      pool,
      address,
      tokenAddress,
      StableSwapArbitrum2Pool,
      N_COINS,
      PRECISION_MUL,
      COINS,
      'Arbitrum2Pool',
    );
  }
}

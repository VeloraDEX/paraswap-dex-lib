import { Address } from '../../../types';
import { SidechainPool } from './sidechain-pool';
import StableSwapGnosis3Pool from '../../../abi/curve-v1/StableSwapGnosis3Pool.json';
import { IDexHelper } from '../../../dex-helper';
import { bigNumberify } from '../../../utils';

const pool = 'gnosis3pool';
export const address: Address =
  '0x7f90122BF0700F9E7e1F688fe926940E8839F353'.toLowerCase();
const tokenAddress: Address = '0x1337BedC9D22ecbe766dF105c9623922A27963EC';
const N_COINS: number = 3;
const PRECISION_MUL = ['1', '1000000000000', '1000000000000'].map(bigNumberify);
const COINS = [
  '0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d',
  '0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83',
  '0x4ECaBa5870353805a9F068101A40E0f32ed605C6',
];

export class Gnosis3Pool extends SidechainPool {
  constructor(parentName: string, dexHelper: IDexHelper) {
    super(
      parentName,
      dexHelper,
      pool,
      address,
      tokenAddress,
      StableSwapGnosis3Pool,
      N_COINS,
      PRECISION_MUL,
      COINS,
      'Gnosis3Pool',
    );
  }
}

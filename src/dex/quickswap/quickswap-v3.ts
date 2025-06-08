import { SwapSide } from '@paraswap/core';
import { Address } from '../../types';
import { IDexTxBuilder } from '../idex';
import { UniswapV3, UniswapV3Param } from '../uniswap-v3';
import { IDexHelper } from '../../dex-helper';
import _ from 'lodash';
import { QuickSwapConfig } from './config';
import { solidityPacked } from 'ethers';

const defaultConfig = _.pick(QuickSwapConfig, ['ThenaFusion']).ThenaFusion;

export type QuickSwapV3Data = {
  // ExactInputSingleParams
  deadline?: number;
  path: {
    tokenIn: Address;
    tokenOut: Address;
  }[];
};

// Naming is deprecated, this is stands for AlgebraV1 (rpc)
export class QuickSwapV3
  extends UniswapV3
  implements IDexTxBuilder<QuickSwapV3Data, UniswapV3Param>
{
  static dexKeys = ['quickswapv3'];

  constructor(
    dexHelper: IDexHelper,
    dexKey = 'quickswapv3',
    router = defaultConfig[dexHelper.config.data.network].router,
  ) {
    super(dexHelper, dexKey, router);
  }

  // override parent as QuickSwapV3 handles fees dynamically.
  protected encodePath(
    path: {
      tokenIn: Address;
      tokenOut: Address;
      fee: number;
    }[],
    side: SwapSide,
  ): string {
    if (path.length === 0) {
      return '0x';
    }

    const { _path, types } = path.reduce(
      (
        { _path, types }: { _path: string[]; types: string[] },
        curr,
        index,
      ): { _path: string[]; types: string[] } => {
        if (index === 0) {
          return {
            types: ['address', 'address'],
            _path: [curr.tokenIn, curr.tokenOut],
          };
        } else {
          return {
            types: [...types, 'address'],
            _path: [..._path, curr.tokenOut],
          };
        }
      },
      { _path: [], types: [] },
    );

    return side === SwapSide.BUY
      ? solidityPacked(types.reverse(), _path.reverse())
      : solidityPacked(types, _path);
  }
}

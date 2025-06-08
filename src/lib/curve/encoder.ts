import { Address } from '@paraswap/core';
import { CurveV1SwapType } from '../../dex/curve-v1/types';
import { CurveV2SwapType } from '../../dex/curve-v2/types';

export const packCurveData = (
  address: Address,
  approve: boolean,
  wrapFlag: number,
  swapType: CurveV2SwapType | CurveV1SwapType,
): bigint => {
  let packedData = BigInt(address);

  packedData |= BigInt(approve ? 1 : 0) << 160n;
  packedData |= BigInt(wrapFlag) << 161n;
  packedData |= BigInt(swapType) << 162n;

  return packedData;
};

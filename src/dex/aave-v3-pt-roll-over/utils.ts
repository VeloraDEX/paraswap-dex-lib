import { BytesLike } from 'ethers';
import { MultiResult } from '../../lib/multi-wrapper';
import { generalDecoder } from '../../lib/decoders';

export function oracleStateDecoder(
  result: MultiResult<BytesLike> | BytesLike,
): boolean {
  return generalDecoder(
    result,
    ['bool', 'uint16', 'bool'],
    false,
    value => Boolean(value[2]) && !Boolean(value[0]),
  );
}

export function ptToAssetRateDecoder(
  result: MultiResult<BytesLike> | BytesLike,
): bigint {
  return generalDecoder(result, ['uint256'], 0n, value => value[0].toBigInt());
}

import { Result } from '@ethersproject/abi';
import BigNumber from 'bignumber.js';
import { BigNumber as EthersBigNumber } from 'ethers';
import { BytesLike, defaultAbiCoder } from 'ethers/lib/utils';
import _, { parseInt } from 'lodash';
import { BN_0 } from '../bignumber-constants';
import { NULL_ADDRESS } from '../constants';
import { MultiResult } from './multi-wrapper';

const isMultiResult = (
  result: MultiResult<BytesLike> | BytesLike,
): result is MultiResult<BytesLike> => {
  return (
    typeof result === 'object' &&
    result !== null &&
    'success' in result &&
    'returnData' in result
  );
};

export const extractSuccessAndValue = (
  result: MultiResult<BytesLike> | BytesLike,
): [boolean, BytesLike] => {
  return isMultiResult(result)
    ? [result.success, result.returnData]
    : [true, result];
};

export function generalDecoder<T>(
  result: MultiResult<BytesLike> | BytesLike,
  types: string[],
  defaultValue: T | undefined,
  parser?: (v: Result) => T,
): T {
  const [isSuccess, toDecode] = extractSuccessAndValue(result);

  if (!isSuccess || toDecode === '0x') {
    if (defaultValue === undefined) {
      throw new Error(`Failed to decode result: ${result}`);
    }
    return defaultValue;
  }

  const decoded = defaultAbiCoder.decode(types, toDecode);
  return parser ? parser(decoded) : decoded[0];
}

export const uint256ToBigInt = (
  result: MultiResult<BytesLike> | BytesLike,
): bigint => {
  return generalDecoder(result, ['uint256'], 0n, value => value[0].toBigInt());
};

export const uint128ToBigNumber = (
  result: MultiResult<BytesLike> | BytesLike,
): EthersBigNumber => {
  return generalDecoder(result, ['uint128'], 0n, value => value[0]);
};

export const int24ToNumber = (
  result: MultiResult<BytesLike> | BytesLike,
): number => {
  return generalDecoder(result, ['int24'], 0n, value => value[0]);
};

export const uint256ArrayDecode = (
  result: MultiResult<BytesLike> | BytesLike,
): bigint => {
  const [isSuccess, toDecode] = extractSuccessAndValue(result);

  if (!isSuccess || toDecode === '0x') {
    return 0n;
  }
  return defaultAbiCoder
    .decode(['uint256[]'], toDecode)[0]
    .map((r: any) => r.toBigInt());
};

export const uin256DecodeToBigNumber = (
  result: MultiResult<BytesLike> | BytesLike,
): BigNumber => {
  const [isSuccess, toDecode] = extractSuccessAndValue(result);

  if (!isSuccess || toDecode === '0x') {
    return BN_0;
  }
  return new BigNumber(
    defaultAbiCoder.decode(['uint256'], toDecode)[0].toString(),
  );
};

export const uint256DecodeToNumber = (
  result: MultiResult<BytesLike> | BytesLike,
): number => {
  const [isSuccess, toDecode] = extractSuccessAndValue(result);

  if (!isSuccess || toDecode === '0x') {
    return 0;
  }
  return parseInt(defaultAbiCoder.decode(['uint256'], toDecode)[0], 10);
};

export const uin256DecodeToFloat = (
  result: MultiResult<BytesLike> | BytesLike,
): number => {
  const [isSuccess, toDecode] = extractSuccessAndValue(result);

  if (!isSuccess || toDecode === '0x') {
    return 0;
  }
  return parseFloat(defaultAbiCoder.decode(['uint256'], toDecode)[0]);
};

export const uin128DecodeToFloat = (
  result: MultiResult<BytesLike> | BytesLike,
): number => {
  const [isSuccess, toDecode] = extractSuccessAndValue(result);

  if (!isSuccess || toDecode === '0x') {
    return 0;
  }
  return parseFloat(defaultAbiCoder.decode(['uint128'], toDecode)[0]);
};

export const uin128DecodeToInt = (
  result: MultiResult<BytesLike> | BytesLike,
): number => {
  const [isSuccess, toDecode] = extractSuccessAndValue(result);

  if (!isSuccess || toDecode === '0x') {
    return 0;
  }
  return parseInt(defaultAbiCoder.decode(['uint128'], toDecode)[0], 10);
};

export const booleanDecode = (
  result: MultiResult<BytesLike> | BytesLike,
): boolean => {
  const [isSuccess, toDecode] = extractSuccessAndValue(result);

  if (!isSuccess || toDecode === '0x') {
    return false;
  }
  return defaultAbiCoder.decode(['bool'], toDecode)[0];
};

export const addressDecode = (
  result: MultiResult<BytesLike> | BytesLike,
): string => {
  return generalDecoder(result, ['address'], NULL_ADDRESS, v =>
    v[0].toLowerCase(),
  );
};

export const addressArrayDecode = (
  result: MultiResult<BytesLike> | BytesLike,
): string => {
  return generalDecoder(result, ['address[]'], [], v =>
    v[0].map((a: string) => a.toLowerCase()),
  );
};

export const stringDecode = (
  result: MultiResult<BytesLike> | BytesLike,
): string => {
  return generalDecoder(result, ['string'], '');
};

export const bytes32ToString = (
  result: MultiResult<BytesLike> | BytesLike,
): string => {
  return generalDecoder(result, ['bytes32'], '', value =>
    value[0].toLowerCase(),
  );
};

export const uint8ToNumber = (
  result: MultiResult<BytesLike> | BytesLike,
): number => {
  return generalDecoder(result, ['uint8'], 0, value =>
    parseInt(value[0].toString(), 10),
  );
};

export const uint24ToNumber = (
  result: MultiResult<BytesLike> | BytesLike,
): number => {
  return generalDecoder(result, ['uint24'], 0, value =>
    parseInt(value[0].toString(), 10),
  );
};

export const uint24ToBigInt = (
  result: MultiResult<BytesLike> | BytesLike,
): bigint => {
  return generalDecoder(result, ['uint24'], 0n, value =>
    BigInt(value[0].toString()),
  );
};

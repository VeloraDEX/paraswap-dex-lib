import BigNumber from 'bignumber.js';
import { getAddress } from 'ethers/lib/utils';
import { SwapSide } from '@paraswap/core';
import { BI_MAX_UINT256, BI_POWS } from './bigint-constants';
import { ETHER_ADDRESS, Network } from './constants';
import { DexConfigMap, Logger, TransferFeeParams } from './types';
import _ from 'lodash';
import { MultiResult } from './lib/multi-wrapper';
import { Contract } from 'web3-eth-contract';
import Web3 from 'web3';
import { AxiosError } from 'axios';

export const isAxiosError = (e: any): e is AxiosError => {
  return e.isAxiosError === true;
};

export const isETHAddress = (address: string) =>
  address.toLowerCase() === ETHER_ADDRESS.toLowerCase();

export const prependWithOx = (str: string) =>
  str.startsWith('0x') ? str : '0x' + str;

export const uuidToBytes16 = (uuid: string) => '0x' + uuid.replace(/-/g, '');

export function toUnixTimestamp(date: Date | number): number {
  const timestamp = date instanceof Date ? date.getTime() : date;
  return Math.floor(timestamp / 1000);
}

// This function guarantees that the distribution adds up to exactly 100% by
// applying rounding in the other direction for numbers with the most error.
export function convertToBasisPoints(dist: number[]): number[] {
  const BPS = 10000;
  const sumDist = dist.reduce((a, b) => a + b, 0);
  const basisPoints = dist.map(n => (n * BPS) / sumDist);
  const rounded = basisPoints.map(n => Math.round(n));
  const sumRounded = rounded.reduce((a, b) => a + b, 0);
  if (sumRounded === BPS) {
    return rounded;
  }
  const errors = basisPoints.map((n, i) => ({
    error: rounded[i] - n,
    index: i,
  }));
  if (sumRounded < BPS) {
    errors.sort((a, b) => a.error - b.error);
    for (let i = 0; i < BPS - sumRounded; ++i) {
      ++rounded[errors[i].index];
    }
  } else {
    errors.sort((a, b) => b.error - a.error);
    for (let i = 0; i < sumRounded - BPS; ++i) {
      --rounded[errors[i].index];
    }
  }
  return rounded;
}

export function getDexKeysWithNetwork<T>(
  dexConfig: DexConfigMap<T>,
): { key: string; networks: Network[] }[] {
  return Object.entries(dexConfig).map(([dKey, dValue]) => ({
    key: dKey,
    networks: Object.keys(dValue).map(n => parseInt(n)),
  }));
}

// This is needed in order to not modify existing logic and use this wrapper
// to be safe if we receive not cached decimals
export function getBigIntPow(decimals: number): bigint {
  const value = BI_POWS[decimals];
  // It is not accurate to create 10 ** 23 and more decimals from number type
  return value === undefined ? BigInt(`1${'0'.repeat(decimals)}`) : value;
}

export function stringifyWithBigInt(obj: unknown): string {
  return JSON.stringify(
    obj,
    (_key, value) => (typeof value === 'bigint' ? value.toString() : value), // return everything else unchanged
  );
}

export function _require(
  b: boolean,
  message: string,
  values?: Record<string, unknown>,
  condition?: string,
): void {
  if (!b) {
    let receivedValues = '';
    if (values && condition) {
      const keyValueStr = Object.entries(values)
        .map(([k, v]) => `${k}=${stringifyWithBigInt(v)}`)
        .join(', ');
      receivedValues = `Values: ${keyValueStr}. Condition: ${condition} violated. `;
    }
    throw new Error(
      `${receivedValues}Error message: ${message ? message : 'undefined'}`,
    );
  }
}

interface SliceCallsInput<T, U> {
  inputArray: T[];
  execute: (inputSlice: T[], sliceIndex: number) => U;
  sliceLength: number;
}

// author: @velenir. source: https://github.com/paraswap/paraswap-volume-tracker/blob/ceaf5e267c9720b190b19c17465b438f57f41851/src/lib/utils/helpers.ts#L20
export function sliceCalls<T, U>({
  inputArray,
  execute,
  sliceLength,
}: SliceCallsInput<T, U>): [U, ...U[]] {
  if (sliceLength >= inputArray.length) return [execute(inputArray, 0)];
  const results: U[] = [];

  for (
    let i = 0, sliceIndex = 0;
    i < inputArray.length;
    i += sliceLength, ++sliceIndex
  ) {
    const inputSlice = inputArray.slice(i, i + sliceLength);
    const resultOfSlice = execute(inputSlice, sliceIndex);
    results.push(resultOfSlice);
  }

  return results as [U, ...U[]];
}

// We assume that the rate always gets worse when be go bigger in volume.
// Both oldVolume and newVolume are sorted
// Considering these assumption, whenever we don't have a price we consider
// the price for the next volume price available and interpolate linearly.
// Interpolate can be useful in two cases
// -> you have a smaller chunked prices and you want go to a higher chunked prices
// -> you have a linear prices and you want go to a not skewed prices
// -> could be used by the order book exchanges as an orderbook works almost with the same principles.
// p = p[i-1] + (p[i] - p[i-1])/(q[i]-q[i-1])*(v-q[i-1])
export function interpolate(
  oldVolume: bigint[],
  oldPrices: bigint[],
  newVolume: bigint[],
  side: SwapSide,
): bigint[] {
  let maxPrice = oldPrices[0];
  let isValid = [true];
  for (let p of oldPrices.slice(1)) {
    if (p >= maxPrice) {
      maxPrice = p;
      isValid.push(true);
    } else {
      isValid.push(false);
    }
  }

  let i = 0;
  return newVolume.map(v => {
    if (v === 0n) return 0n;

    while (i < oldVolume.length && v > oldVolume[i]) i++;

    // if we don't have any more prices for a bigger volume return last price for sell and infinity for buy
    if (i >= oldVolume.length) {
      return !isValid[oldPrices.length - 1]
        ? 0n
        : side === SwapSide.SELL
        ? oldPrices[oldPrices.length - 1]
        : BI_MAX_UINT256;
    }

    if (!isValid[i]) return 0n;

    // if the current volume is equal to oldVolume then just use that
    if (oldVolume[i] === v) return oldPrices[i];

    if (i > 0 && !isValid[i - 1]) return 0n;

    // As we know that derivative of the prices can't go up we apply a linear interpolation
    const lastOldVolume = i > 0 ? oldVolume[i - 1] : 0n;
    const lastOldPrice = i > 0 ? oldPrices[i - 1] : 0n;

    // Old code - this doesn't work because slope can be very small and gets
    // rounded badly in bignumber.js, so need to do the division later
    //const slope = oldPrices[i]
    //  .minus(lastOldPrice)
    //  .div(oldVolume[i].minus(lastOldVolume));
    //return lastOldPrice.plus(slope.times(v.minus(lastOldVolume)));

    return (
      lastOldPrice +
      ((oldPrices[i] - lastOldPrice) * (v - lastOldVolume)) /
        (oldVolume[i] - lastOldVolume)
    );
  });
}

export const bigIntify = (val: any) => BigInt(val);

export const bigNumberify = (val: any) => new BigNumber(val);

export const stringify = (val: any) => val.toString();

export const catchParseLogError = (e: any, logger: Logger) => {
  if (e instanceof Error) {
    if (!e.message.includes('no matching event')) {
      logger.error('Failed parse event', e);
    }
  }
};

export const isSampled = (sampleRate?: number) => {
  if (!sampleRate) return false;
  return Math.random() < sampleRate;
};

const PREFIX_BIG_INT = 'bi@';
const PREFIX_BIG_NUMBER = 'bn@';

const stringCheckerBuilder = (prefix: string) => {
  return (obj: any) => {
    if (!_.isString(obj)) {
      return false;
    }
    for (let i = 0; i < prefix.length; ++i) {
      if (prefix[i] !== obj[i]) {
        return false;
      }
    }
    return true;
  };
};

const checkerStringWithBigIntPrefix = stringCheckerBuilder(PREFIX_BIG_INT);
const checkerStringWithBigNumberPrefix =
  stringCheckerBuilder(PREFIX_BIG_NUMBER);

const casterToStringbuilder = (prefix: string, obj: any) =>
  prefix.concat(obj.toString());

const casterBigIntToString = (obj: BigInt) =>
  casterToStringbuilder(PREFIX_BIG_INT, obj);
const casterBigNumberToString = (obj: BigNumber) =>
  casterToStringbuilder(PREFIX_BIG_NUMBER, obj);

const checkerBigInt = (obj: any) => typeof obj === 'bigint';
const checkerBigNumber = (obj: any) => obj instanceof BigNumber;

const stringCasterBuilder = (
  prefix: string,
  constructor: (str: string) => any,
) => {
  return (obj: string) => {
    return constructor(obj.slice(prefix.length));
  };
};

const casterStringToBigInt = stringCasterBuilder(
  PREFIX_BIG_INT,
  (str: string) => BigInt(str),
);

const casterStringToBigNumber = stringCasterBuilder(
  PREFIX_BIG_NUMBER,
  (str: string) => new BigNumber(str),
);

type TypeSerializer = {
  checker: (obj: any) => boolean;
  caster: (obj: any) => any;
};

export function deepTypecast(obj: any, types: TypeSerializer[]): any {
  return _.forEach(obj, (val: any, key: any, obj: any) => {
    for (const type of types) {
      if (type.checker(val)) {
        const cast = type.caster(val);
        obj[key] = cast;
        return;
      }
    }
    const isObject = _.isObject(val);
    if (isObject) {
      deepTypecast(val, types);
    } else {
      obj[key] = val;
    }
  });
}

export class Utils {
  static Serialize(data: any): string {
    return JSON.stringify(
      deepTypecast(_.cloneDeep(data), [
        {
          checker: checkerBigInt,
          caster: casterBigIntToString,
        },
        {
          checker: checkerBigNumber,
          caster: casterBigNumberToString,
        },
      ]),
    );
  }

  static Parse(data: any): any {
    return deepTypecast(_.cloneDeep(JSON.parse(data)), [
      {
        checker: checkerStringWithBigIntPrefix,
        caster: casterStringToBigInt,
      },
      {
        checker: checkerStringWithBigNumberPrefix,
        caster: casterStringToBigNumber,
      },
    ]);
  }

  static timeoutPromise<T>(
    promise: Promise<T>,
    timeout: number,
    message: string,
  ): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((resolve, reject) => {
        setTimeout(() => reject(message), timeout);
      }),
    ]);
  }
}

export const isSrcTokenTransferFeeToBeExchanged = (
  transferFees?: TransferFeeParams,
): boolean => {
  return !!(transferFees?.srcFee || transferFees?.srcDexFee);
};

// This function is throwing error if address is not correct
export const normalizeAddress = (address: string) => {
  return getAddress(address).toLowerCase();
};

// In some case we need block timestamp, but instead of real one, we can use
// just current time in BigInt
export function currentBigIntTimestampInS() {
  return BigInt(Math.floor(Date.now() / 1000));
}

export const isDestTokenTransferFeeToBeExchanged = (
  transferFees?: TransferFeeParams,
): boolean => {
  return !!(transferFees?.destFee || transferFees?.destDexFee);
};

export const isTruthy = <T>(x: T | undefined | null | '' | false | 0): x is T =>
  !!x;

type MultiCallParams = {
  target: any;
  callData: any;
};

type BlockAndTryAggregateResult = {
  blockNumber: number;
  results: MultiResult<any>[];
};

export const blockAndTryAggregate = async (
  mandatory: boolean,
  multi: Contract,
  calls: MultiCallParams[],
  blockNumber: number | 'latest',
): Promise<BlockAndTryAggregateResult> => {
  const results = await multi.methods
    .tryBlockAndAggregate(mandatory, calls)
    .call(undefined, blockNumber);

  return {
    blockNumber: Number(results.blockNumber),
    results: results.returnData.map((res: any) => ({
      returnData: res.returnData,
      success: res.success,
    })),
  };
};

export const isContractAddress = async (web3: Web3, addr: string) => {
  const contractCode = await web3.eth.getCode(addr);

  return contractCode !== '0x';
};

const toUintN = (n: number) => (x: bigint) => BigInt.asUintN(n, x);
const toIntN = (n: number) => (x: bigint) => BigInt.asIntN(n, x);

// INT
export const int16 = toIntN(16);
export const int32 = toIntN(32);
export const int64 = toIntN(64);
export const int128 = toIntN(128);
export const int256 = toIntN(256);

// UINT
export const uint16 = toUintN(16);
export const uint32 = toUintN(32);
export const uint64 = toUintN(64);
export const uint128 = toUintN(128);
export const uint256 = toUintN(256);

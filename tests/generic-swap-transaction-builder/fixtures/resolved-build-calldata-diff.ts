import type { TxObject } from '../../../src/types';
import { AUGUSTUS_V6_INTERFACE } from './resolved-build-deps';

export function expectTxObjectToEqual(
  actual: TxObject,
  expected: TxObject,
): void {
  try {
    expect(actual).toEqual(expected);
  } catch (error) {
    if (actual.data !== expected.data) {
      throw new Error(
        `${
          error instanceof Error ? error.message : String(error)
        }\n${formatCalldataDiff(actual.data, expected.data)}`,
      );
    }

    throw error;
  }
}

function formatCalldataDiff(actualData: string, expectedData: string): string {
  try {
    const actual = AUGUSTUS_V6_INTERFACE.parseTransaction({ data: actualData });
    const expected = AUGUSTUS_V6_INTERFACE.parseTransaction({
      data: expectedData,
    });
    const actualArgs = actual.args.map(normalizeDecodedValue);
    const expectedArgs = expected.args.map(normalizeDecodedValue);
    const firstDifferentIndex = expectedArgs.findIndex(
      (expectedArg, index) =>
        JSON.stringify(expectedArg) !== JSON.stringify(actualArgs[index]),
    );

    return [
      `Decoded calldata mismatch: actual ${actual.name}, expected ${expected.name}`,
      `First different param index: ${firstDifferentIndex}`,
      `Actual param: ${JSON.stringify(actualArgs[firstDifferentIndex])}`,
      `Expected param: ${JSON.stringify(expectedArgs[firstDifferentIndex])}`,
    ].join('\n');
  } catch (decodeError) {
    return `Unable to decode calldata mismatch: ${
      decodeError instanceof Error ? decodeError.message : String(decodeError)
    }`;
  }
}

function normalizeDecodedValue(value: any): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeDecodedValue);
  }

  if (value?._isBigNumber) {
    return value.toString();
  }

  if (typeof value === 'object' && value !== null) {
    return Object.keys(value)
      .filter(key => Number.isNaN(Number(key)))
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = normalizeDecodedValue(value[key]);
        return acc;
      }, {});
  }

  return value;
}

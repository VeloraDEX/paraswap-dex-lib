import { Interface } from '@ethersproject/abi';
import { Logger } from 'log4js';
import { Contract } from 'web3-eth-contract';
import { UNLIMITED_RESERVES } from '../../constants';
import { MultiWrapper } from '../multi-wrapper';
import { directionalReserves, multicallBalances, toReserves } from './reserves';

const T0 = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const T1 = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

const erc20 = new Interface([
  'function balanceOf(address) view returns (uint256)',
]);

const encodeUint = (v: bigint) =>
  erc20.encodeFunctionResult('balanceOf', [v.toString()]);

const decodeUint = (data: any): bigint =>
  BigInt(erc20.decodeFunctionResult('balanceOf', data)[0].toString());

// Fake multicall contract: `returns[i]` is what call i yields on-chain.
// A chunk whose first call index is in `rejectChunksAt` fails as a whole,
// like an RPC transport error.
const fakeMultiWrapper = (
  returns: { success: boolean; returnData: string }[],
  rejectChunksAt: number[] = [],
) => {
  let offset = 0;
  const multi = {
    methods: {
      tryAggregate: (_mandatory: boolean, batch: unknown[]) => ({
        call: async () => {
          const start = offset;
          offset += batch.length;
          if (rejectChunksAt.includes(start)) throw new Error('rpc down');
          return returns.slice(start, start + batch.length);
        },
      }),
    },
  } as unknown as Contract;
  const logger = { warn: jest.fn(), error: jest.fn() } as unknown as Logger;
  return new MultiWrapper(multi, logger);
};

describe('pools-storage reserves helpers', () => {
  it('toReserves lowercases tokens and formats capacities', () => {
    expect(toReserves([T0, T1], [123n, UNLIMITED_RESERVES])).toEqual({
      [T0.toLowerCase()]: '123',
      [T1.toLowerCase()]: UNLIMITED_RESERVES,
    });
  });

  it('toReserves rejects mismatched lengths', () => {
    expect(() => toReserves([T0, T1], [1n])).toThrow();
  });

  it('directionalReserves builds src_dest keys', () => {
    expect(
      directionalReserves([
        { src: T0, dest: T1, capacity: UNLIMITED_RESERVES },
        { src: T1, dest: T0, capacity: 0n },
      ]),
    ).toEqual({
      [`${T0.toLowerCase()}_${T1.toLowerCase()}`]: UNLIMITED_RESERVES,
      [`${T1.toLowerCase()}_${T0.toLowerCase()}`]: '0',
    });
  });

  const call = (target: string) => ({
    target,
    callData: erc20.encodeFunctionData('balanceOf', [T0]),
    decodeFunction: decodeUint,
  });

  it('multicallBalances isolates a reverting call', async () => {
    const wrapper = fakeMultiWrapper([
      { success: true, returnData: encodeUint(1n) },
      { success: false, returnData: '0x' },
      { success: true, returnData: encodeUint(3n) },
    ]);
    const res = await multicallBalances(wrapper, [
      call(T0),
      call(T1),
      call(T0),
    ]);
    expect(res).toEqual([1n, null, 3n]);
  });

  it('multicallBalances isolates a successful call with malformed data', async () => {
    const wrapper = fakeMultiWrapper([
      { success: true, returnData: encodeUint(1n) },
      { success: true, returnData: '0x1234' },
      { success: true, returnData: encodeUint(3n) },
    ]);
    const res = await multicallBalances(wrapper, [
      call(T0),
      call(T1),
      call(T0),
    ]);
    expect(res).toEqual([1n, null, 3n]);
  });

  it('multicallBalances chunks and preserves order', async () => {
    const wrapper = fakeMultiWrapper(
      [1n, 2n, 3n, 4n, 5n].map(v => ({
        success: true,
        returnData: encodeUint(v),
      })),
    );
    const res = await multicallBalances(
      wrapper,
      [call(T0), call(T1), call(T0), call(T1), call(T0)],
      2,
    );
    expect(res).toEqual([1n, 2n, 3n, 4n, 5n]);
  });

  it('multicallBalances isolates a failed RPC chunk', async () => {
    const wrapper = fakeMultiWrapper(
      [1n, 2n, 3n, 4n, 5n].map(v => ({
        success: true,
        returnData: encodeUint(v),
      })),
      [2],
    );
    const res = await multicallBalances(
      wrapper,
      [call(T0), call(T1), call(T0), call(T1), call(T0)],
      2,
    );
    expect(res).toEqual([1n, 2n, null, null, 5n]);
  });

  it('multicallBalances rejects an invalid chunk size', async () => {
    const wrapper = fakeMultiWrapper([]);
    await expect(multicallBalances(wrapper, [call(T0)], 0)).rejects.toThrow(
      /chunk size/,
    );
    await expect(multicallBalances(wrapper, [call(T0)], 1.5)).rejects.toThrow(
      /chunk size/,
    );
  });

  it('multicallBalances returns [] for no calls', async () => {
    const wrapper = fakeMultiWrapper([]);
    expect(await multicallBalances(wrapper, [])).toEqual([]);
  });
});

import { Interface, defaultAbiCoder } from '@ethersproject/abi';
import ERC20ABI from '../../abi/erc20.json';
import { MultiCallParams, MultiWrapper } from '../multi-wrapper';
import {
  parseTokenPoolDescriptor,
  describesTokens,
  tokenPoolDescriptor,
  tokenPoolReserves,
} from './token-pools';

const A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const C = '0xcccccccccccccccccccccccccccccccccccccccc';
const POOL = '0xdddddddddddddddddddddddddddddddddddddddd';
const POOL2 = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const POOL3 = '0xffffffffffffffffffffffffffffffffffffffff';
const upper = (a: string) => '0x' + a.slice(2).toUpperCase();

const erc20 = new Interface(ERC20ABI);
const desc = (fields: object) => JSON.stringify(fields);

// Replies to balanceOf(pool) by `${token}:${pool}` with raw return data run
// through the call's decoder; missing → reverted call.
const fakeMultiWrapper = (
  tryAggregate: jest.Mock,
  returns: Record<string, string>,
) => {
  tryAggregate.mockImplementation(
    async (_m: boolean, calls: MultiCallParams<unknown>[]) =>
      calls.map(call => {
        const [owner] = erc20.decodeFunctionData('balanceOf', call.callData);
        const data = returns[`${call.target}:${owner.toLowerCase()}`];
        return data === undefined
          ? { success: false, returnData: null }
          : { success: true, returnData: call.decodeFunction(data) };
      }),
  );
  return { defaultBatchSize: 500, tryAggregate } as unknown as MultiWrapper;
};

const uint256 = (v: bigint) => defaultAbiCoder.encode(['uint256'], [v]);

describe('token pool descriptors', () => {
  it('lowercases and validates', () => {
    expect(
      parseTokenPoolDescriptor(desc({ a: upper(POOL), t0: upper(A), t1: B })),
    ).toEqual({ a: POOL, t0: A, t1: B });
    expect(parseTokenPoolDescriptor('nope')).toBeNull();
    expect(parseTokenPoolDescriptor('null')).toBeNull();
    expect(parseTokenPoolDescriptor(desc({ a: POOL, t0: A }))).toBeNull();
    expect(parseTokenPoolDescriptor(desc({ a: 'x', t0: A, t1: B }))).toBeNull();
    expect(
      parseTokenPoolDescriptor(desc({ a: POOL, t0: A, t1: A })),
    ).toBeNull();
  });

  it('describesTokens ignores order and case', () => {
    const d = tokenPoolDescriptor(POOL, A, B);
    expect(describesTokens(d, B, upper(A))).toBe(true);
    expect(describesTokens(d, A, C)).toBe(false);
  });
});

describe('tokenPoolReserves', () => {
  const tryAggregate = jest.fn();
  beforeEach(() => tryAggregate.mockReset());

  it('serves cached pools, fetches unknown ones, skips contradictions and failures', async () => {
    const multiWrapper = fakeMultiWrapper(tryAggregate, {
      [`${A}:${POOL2}`]: uint256(30n),
      [`${C}:${POOL2}`]: uint256(40n),
    });
    const cached = jest.fn((pool: { a: string }) => {
      if (pool.a === POOL) return { [A]: 1n, [B]: 2n };
      if (pool.a === C) return { [A]: 1n, [B]: 2n }; // known with other tokens
      return null;
    });
    const reserves = await tokenPoolReserves({
      dexKey: 'Dex',
      multiWrapper,
      cached,
      descriptors: [
        desc({ a: POOL, t0: B, t1: A }),
        desc({ a: POOL2, t0: A, t1: C }),
        desc({ a: C, t0: A, t1: C }),
        desc({ a: B, t0: A, t1: C }),
        desc({ a: POOL, t0: A, t1: B }),
        'garbage',
      ],
    });
    expect(reserves).toEqual([
      { dex: 'Dex', id: POOL, address: POOL, reserves: { [A]: '1', [B]: '2' } },
      {
        dex: 'Dex',
        id: POOL2,
        address: POOL2,
        reserves: { [A]: '30', [C]: '40' },
      },
    ]);
    expect(cached).toHaveBeenCalledTimes(4);
    expect(tryAggregate).toHaveBeenCalledTimes(1);
    expect(
      tryAggregate.mock.calls[0][1].map(
        (c: MultiCallParams<unknown>) => c.target,
      ),
    ).toEqual([A, C, A, C]);
  });

  it('keeps encoded zero balances but drops empty, truncated or failed returns', async () => {
    const multiWrapper = fakeMultiWrapper(tryAggregate, {
      [`${A}:${POOL}`]: uint256(0n),
      [`${B}:${POOL}`]: uint256(5n),
      [`${A}:${POOL2}`]: '0x', // address without code
      [`${B}:${POOL2}`]: uint256(5n),
      [`${A}:${POOL3}`]: '0x1234', // truncated
      [`${B}:${POOL3}`]: uint256(5n),
      [`${A}:${C}`]: uint256(7n), // B reverts
    });
    const reserves = await tokenPoolReserves({
      dexKey: 'Dex',
      multiWrapper,
      cached: () => null,
      descriptors: [
        desc({ a: POOL, t0: A, t1: B }),
        desc({ a: POOL2, t0: A, t1: B }),
        desc({ a: POOL3, t0: A, t1: B }),
        desc({ a: C, t0: A, t1: B }),
      ],
    });
    expect(reserves).toEqual([
      { dex: 'Dex', id: POOL, address: POOL, reserves: { [A]: '0', [B]: '5' } },
    ]);
  });

  it('decodes MultiResult-shaped return data as well', async () => {
    const multiWrapper = {
      defaultBatchSize: 500,
      tryAggregate: async (_m: boolean, calls: MultiCallParams<unknown>[]) =>
        calls.map((call, i) => ({
          success: true,
          returnData: call.decodeFunction({
            success: true,
            returnData: uint256(BigInt(i + 1)),
          }),
        })),
    } as unknown as MultiWrapper;
    const reserves = await tokenPoolReserves({
      dexKey: 'Dex',
      multiWrapper,
      cached: () => null,
      descriptors: [desc({ a: POOL, t0: A, t1: B })],
    });
    expect(reserves[0].reserves).toEqual({ [A]: '1', [B]: '2' });
  });

  it('returns nothing and makes no call for an empty or unusable batch', async () => {
    const multiWrapper = fakeMultiWrapper(tryAggregate, {});
    expect(
      await tokenPoolReserves({
        dexKey: 'Dex',
        multiWrapper,
        descriptors: ['x', desc({ a: POOL })],
        cached: () => null,
      }),
    ).toEqual([]);
    expect(tryAggregate).not.toHaveBeenCalled();
  });
});

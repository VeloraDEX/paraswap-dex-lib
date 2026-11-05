import BigNumber from 'bignumber.js';
import Web3 from 'web3';
import { defaultAbiCoder } from '@ethersproject/abi';
import { keccak256 } from '@ethersproject/keccak256';
import { LunarBase } from './lunar-base';
import * as pools from './lunar-base-pool';
import { LunarBaseConfig } from './config';
import {
  ETHER_ADDRESS,
  Network,
  NULL_ADDRESS,
  SwapSide,
} from '../../constants';
import { LunarBasePoolState } from './types';

const pool = LunarBaseConfig.LunarBase[Network.BASE].pools[0];
const executor = '0x3d546f0181b78b97c1a3c33cab23aa443e26eab4';
const origin = '0x1111111111111111111111111111111111111111';
const recipient = '0x2222222222222222222222222222222222222222';
const accessSlot = BigInt(
  '0x9832e62c6c6e13b4465b385de9f563995a2974f4f839176dcccf0b12e5c11200',
);
const hex32 = (n: bigint) => '0x' + n.toString(16).padStart(64, '0');

function setup(blacklisted = false, scale = 10n) {
  const state: LunarBasePoolState = {
    model: 'punishment',
    anchorPrice: 1n << 96n,
    feeAskX24: 1 << 22,
    feeBidX24: 1 << 22,
    latestUpdateBlock: 100,
    reserveX: 1_000_000n,
    reserveY: 1_000_000n,
    blockDelay: 10,
    maxPunishmentX24: 0,
    concentrationK: 0,
    blacklistFeeMultiplier: 2n,
    executorsWhitelist: { [executor]: true },
    paused: false,
  };
  const getState = jest
    .spyOn(pools, 'getOnChainState')
    .mockResolvedValue(state);
  const getStorageAt = jest.fn(async (_pool: string, slot: string) =>
    slot === hex32(accessSlot + 3n)
      ? hex32((scale << 64n) | 5n)
      : hex32(blacklisted ? 1n : 0n),
  );
  const helper: any = {
    provider: {
      getBlock: jest.fn().mockResolvedValue({
        number: 100,
        baseFeePerGas: 100,
        timestamp: 1000,
      }),
      getStorageAt,
    },
    web3Provider: new Web3(),
    config: {
      data: {
        network: Network.BASE,
        augustusAddress: recipient,
        augustusV6Address: recipient,
        wrappedNativeTokenAddress: '0x4200000000000000000000000000000000000006',
        executorsAddresses: { Executor01: executor, Executor02: executor },
      },
      isWETH: () => false,
    },
    getLogger: () => console,
  };
  const dex = new LunarBase(Network.BASE, 'LunarBase', helper);
  const exchange = {
    exchange: 'LunarBase',
    srcAmount: '10000',
    destAmount: '7500',
    percent: 100,
    data: {
      pool: pool.address,
      tokenIn: NULL_ADDRESS,
      tokenOut: pool.tokenY.address,
      isXToY: true,
    },
  };
  const options = {
    txOrigin: origin,
    userAddress: recipient,
    executionContractAddress: executor,
    slippageFactor: new BigNumber('0.99'),
    gasPrice: '100',
  };
  const preprocess = (extra = {}) =>
    (dex as any).preProcessTransaction(
      exchange,
      { address: ETHER_ADDRESS, decimals: 18 },
      pool.tokenY,
      SwapSide.SELL,
      { ...options, ...extra },
    );
  return { dex, exchange, preprocess, options, getState, getStorageAt, state };
}

afterEach(() => jest.restoreAllMocks());

describe('LunarBase execution fees', () => {
  it('accepts a whitelisted executor below the tax threshold', async () => {
    const { preprocess } = setup();
    await expect(preprocess()).resolves.toBeDefined();
  });
  it('checks the actual tx.origin even for a whitelisted executor', async () => {
    const { preprocess } = setup(true);
    await expect(preprocess()).rejects.toThrow(/slippage/i);
  });
  it('reads the origin blacklist instead of userAddress or recipient', async () => {
    const { preprocess, getStorageAt } = setup();
    await preprocess();
    const expected = keccak256(
      defaultAbiCoder.encode(['address', 'uint256'], [origin, accessSlot + 2n]),
    );
    expect(getStorageAt).toHaveBeenCalledWith(pool.address, expected, 100);
  });
  it('charges the multiplier for the actual non-whitelisted executor', async () => {
    const { preprocess, getState, state } = setup();
    getState.mockResolvedValue({
      ...state,
      executorsWhitelist: { [executor]: false },
    });
    await expect(preprocess()).rejects.toThrow(/slippage/i);
  });
  it('does not treat blacklist as a ban when the quote covers its fee', async () => {
    const { preprocess } = setup(true);
    await expect(
      preprocess({ slippageFactor: new BigNumber('0.6') }),
    ).resolves.toBeDefined();
  });
  it('does not reuse a prior successful fee-policy check', async () => {
    const { preprocess, getStorageAt } = setup();
    await preprocess();
    getStorageAt.mockImplementation(async (_pool, slot) =>
      slot === hex32(accessSlot + 3n) ? hex32((10n << 64n) | 5n) : hex32(1n),
    );
    await expect(preprocess()).rejects.toThrow(/slippage/i);
  });
  it('fails closed when the current access policy cannot be read', async () => {
    const { preprocess, getStorageAt } = setup();
    getStorageAt.mockRejectedValue(new Error('RPC unavailable'));
    await expect(preprocess()).rejects.toThrow('RPC unavailable');
  });
  it('includes MEV tax before checking slippage', async () => {
    const { preprocess } = setup();
    await expect(preprocess({ gasPrice: '106' })).rejects.toThrow(/slippage/i);
  });
  it('uses the maxFee cap when deriving EIP-1559 priority', async () => {
    const { preprocess } = setup();
    await expect(
      preprocess({
        gasPrice: undefined,
        maxPriorityFeePerGas: '6',
        maxFeePerGas: '102',
      }),
    ).resolves.toBeDefined();
    await expect(
      preprocess({
        gasPrice: undefined,
        maxPriorityFeePerGas: '6',
        maxFeePerGas: '106',
      }),
    ).rejects.toThrow(/slippage/i);
  });
  it('requires gas context when MEV tax is enabled', async () => {
    const { preprocess } = setup();
    await expect(preprocess({ gasPrice: undefined })).rejects.toThrow(/gas/i);
  });
  it('rejects mixed, negative and incomplete gas parameters', async () => {
    const { preprocess } = setup();
    for (const gas of [
      { gasPrice: '-1' },
      { gasPrice: '100', maxFeePerGas: '200' },
      { gasPrice: undefined, maxPriorityFeePerGas: '6' },
      { gasPrice: undefined, maxFeePerGas: '99', maxPriorityFeePerGas: '6' },
    ]) {
      await expect(preprocess(gas)).rejects.toThrow(/gas|fee/i);
    }
  });
  it('re-reads the fee policy at build time and checks the chosen executor', async () => {
    const { dex, exchange, getState } = setup(true);
    await expect(
      (dex as any).getDexParam(
        ETHER_ADDRESS,
        pool.tokenY.address,
        '10000',
        '1',
        recipient,
        exchange.data,
        SwapSide.SELL,
        executor,
        {
          executionContext: {
            txOrigin: origin,
            gasPrice: '100',
            minimumAmountOut: '7425',
          },
        },
      ),
    ).rejects.toThrow(/slippage/i);
    expect(getState).toHaveBeenCalledWith(
      expect.anything(),
      pool.address,
      [executor],
      100,
    );
  });
  it('rejects a standalone build with missing origin context', async () => {
    const { dex, exchange } = setup();
    await expect(
      (dex as any).getDexParam(
        ETHER_ADDRESS,
        pool.tokenY.address,
        '10000',
        '1',
        recipient,
        exchange.data,
        SwapSide.SELL,
        executor,
      ),
    ).rejects.toThrow(/context|origin/i);
  });
  it('allows missing gas parameters only when MEV tax is disabled', async () => {
    const { preprocess } = setup(false, 0n);
    await expect(preprocess({ gasPrice: undefined })).resolves.toBeDefined();
  });
});

/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Interface } from '@ethersproject/abi';
import { DummyDexHelper, IDexHelper } from '../../../../dex-helper';
import { Network, SwapSide } from '../../../../constants';
import { BI_POWS } from '../../../../bigint-constants';
import QuoterAbi from '../../../../abi/uniswap-v4/quoter.abi.json';
import { UniswapV4Config } from '../../config';
import { PoolKey, Pool, PoolState } from '../../types';
import { UniswapV4Pool } from '../../uniswap-v4-pool';
import { UniswapV4 } from '../../uniswap-v4';
import { uniswapV4PoolMath } from '../../contract-math/uniswap-v4-pool-math';
import { ArrakisPrivateHook } from './arrakis-private-hook';

jest.setTimeout(300 * 1000);

const dexKey = 'UniswapV4';
const network = Network.MAINNET;
const config = UniswapV4Config[dexKey][network];

const quoterIface = new Interface(QuoterAbi);

// real mainnet private vault pool: USDC / DGLD
const poolKey: PoolKey = {
  currency0: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
  currency1: '0xa9299c296d7830a99414d1e5546f5171fa01e9c8', // DGLD
  fee: '8388608', // DYNAMIC_FEE_FLAG
  tickSpacing: 5,
  hooks: '0xa4e6f5500e88691fdcb289aa0e99067481434880',
};

const poolId =
  '0xde31d7cdc7f4db844e87bb67a139ff78afbb8d32e38cce429dbc3a66f1f76dc9';

async function quoteOnChain(
  dexHelper: IDexHelper,
  blockNumber: number,
  amounts: bigint[],
  zeroForOne: boolean,
  side: SwapSide,
  quoter: string = config.quoter,
  key: PoolKey = poolKey,
): Promise<bigint[]> {
  const funcName =
    side === SwapSide.SELL ? 'quoteExactInputSingle' : 'quoteExactOutputSingle';

  const calls = amounts.map(amount => ({
    target: quoter,
    callData: quoterIface.encodeFunctionData(funcName, [
      {
        poolKey: key,
        zeroForOne,
        exactAmount: amount.toString(),
        hookData: '0x',
      },
    ]),
  }));

  const results = (
    await dexHelper.multiContract.methods.aggregate(calls).call({}, blockNumber)
  ).returnData;

  return results.map((result: string) => {
    const parsed = quoterIface.decodeFunctionResult(funcName, result);
    return BigInt(parsed[0]._hex);
  });
}

describe('ArrakisPrivateHook pricing vs on-chain quoter (Mainnet)', () => {
  let dexHelper: DummyDexHelper;
  let blockNumber: number;
  let hook: ArrakisPrivateHook;
  let eventPool: UniswapV4Pool;
  let poolState: PoolState;

  const pool: Pool = { id: poolId, key: poolKey };

  beforeAll(async () => {
    dexHelper = new DummyDexHelper(network);
    blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();

    const logger = dexHelper.getLogger(dexKey);

    hook = new ArrakisPrivateHook(dexHelper, network, logger);
    hook.registerPool(poolId, poolKey);
    await hook.initialize(blockNumber);

    eventPool = new UniswapV4Pool(
      dexHelper,
      dexKey,
      network,
      config,
      logger,
      '',
      poolId,
      poolKey.currency0,
      poolKey.currency1,
      poolKey.fee,
      poolKey.hooks,
      poolKey.tickSpacing.toString(),
      hook,
    );

    poolState = await eventPool.generateState(blockNumber);
  });

  const cases: [string, boolean, SwapSide, bigint[]][] = [
    [
      'SELL USDC -> DGLD',
      true,
      SwapSide.SELL,
      [1n, 2n, 3n].map(i => i * 10n * BI_POWS[6]),
    ],
    [
      'SELL DGLD -> USDC',
      false,
      SwapSide.SELL,
      [1n, 2n, 3n].map(i => (i * BI_POWS[18]) / 1000n),
    ],
    [
      'BUY USDC -> DGLD',
      true,
      SwapSide.BUY,
      [1n, 2n, 3n].map(i => (i * BI_POWS[18]) / 1000n),
    ],
    [
      'BUY DGLD -> USDC',
      false,
      SwapSide.BUY,
      [1n, 2n, 3n].map(i => i * 10n * BI_POWS[6]),
    ],
  ];

  cases.forEach(([label, zeroForOne, side, amounts]) => {
    it(label, async () => {
      const outputs = uniswapV4PoolMath.queryOutputs(
        pool,
        poolState,
        amounts,
        zeroForOne,
        side,
        hook,
      );

      const expected = await quoteOnChain(
        dexHelper,
        blockNumber,
        amounts,
        zeroForOne,
        side,
      );

      console.log(`${label} amounts: `, amounts);
      console.log(`${label} outputs: `, outputs);
      console.log(`${label} expected: `, expected);

      expect(outputs).toEqual(expected);
    });
  });
});

// Base uses the static UniswapV4PoolsList instead of the subgraph, so this
// exercises the full dex flow: static list discovery -> hook registration ->
// event-based pricing, compared against the on-chain quoter
describe('ArrakisPrivateHook via UniswapV4 dex (Base, static pools list)', () => {
  const baseNetwork = Network.BASE;
  const baseConfig = UniswapV4Config[dexKey][baseNetwork];

  const basePoolKey: PoolKey = {
    currency0: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC
    currency1: '0xe908475f8beb7a138b0dc6eb5a05cb27068ffb9a', // DGLD
    fee: '8388608', // DYNAMIC_FEE_FLAG
    tickSpacing: 5,
    hooks: '0xa4e6f5500e88691fdcb289aa0e99067481434880',
  };

  const basePoolId =
    '0x68ab198bc4c61c8c691a3e35d1b3a5248d8e04acb9e28a1bb2ef0d3fa564fe93';

  const USDC = {
    address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    decimals: 6,
  };
  const DGLD = {
    address: '0xe908475f8beb7a138b0dc6eb5a05cb27068ffb9a',
    decimals: 18,
  };

  let dexHelper: DummyDexHelper;
  let uniswapV4: UniswapV4;
  let blockNumber: number;

  beforeAll(async () => {
    dexHelper = new DummyDexHelper(baseNetwork);
    blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();

    uniswapV4 = new UniswapV4(baseNetwork, dexKey, dexHelper);
    await uniswapV4.initializePricing(blockNumber);
  });

  it('getPoolIdentifiers includes the Arrakis pool', async () => {
    const pools = await uniswapV4.getPoolIdentifiers(
      USDC,
      DGLD,
      SwapSide.SELL,
      blockNumber,
    );
    console.log('pool identifiers: ', pools);

    expect(pools).toContain(basePoolId);
  });

  const cases: [string, any, any, boolean, SwapSide, bigint[]][] = [
    [
      'SELL USDC -> DGLD',
      USDC,
      DGLD,
      true,
      SwapSide.SELL,
      [0n, 10n * BI_POWS[6], 20n * BI_POWS[6]],
    ],
    [
      'SELL DGLD -> USDC',
      DGLD,
      USDC,
      false,
      SwapSide.SELL,
      [0n, BI_POWS[18] / 1000n, (2n * BI_POWS[18]) / 1000n],
    ],
    [
      'BUY USDC -> DGLD',
      USDC,
      DGLD,
      true,
      SwapSide.BUY,
      [0n, BI_POWS[18] / 1000n, (2n * BI_POWS[18]) / 1000n],
    ],
  ];

  cases.forEach(([label, from, to, zeroForOne, side, amounts]) => {
    it(label, async () => {
      const prices = await uniswapV4.getPricesVolume(
        from,
        to,
        amounts,
        side,
        blockNumber,
        [basePoolId],
      );

      expect(prices).not.toBeNull();
      const poolPrices = prices!.find(p =>
        p.poolIdentifiers?.includes(basePoolId),
      );
      expect(poolPrices).toBeDefined();

      const expected = [0n].concat(
        await quoteOnChain(
          dexHelper,
          blockNumber,
          amounts.slice(1),
          zeroForOne,
          side,
          baseConfig.quoter,
          basePoolKey,
        ),
      );

      console.log(`${label} amounts: `, amounts);
      console.log(`${label} prices: `, poolPrices!.prices);
      console.log(`${label} expected: `, expected);

      expect(poolPrices!.prices).toEqual(expected);
    });
  });
});

import { Interface } from '@ethersproject/abi';
import { StaticJsonRpcProvider } from '@ethersproject/providers';
import { BigNumber } from 'ethers';
import { hexlify, hexZeroPad } from 'ethers/lib/utils';
import { SwapSide } from '@paraswap/core';
import { IDexHelper } from '../../dex-helper';
import { EkuboV3 } from './ekubo-v3';
import { EkuboV3PoolManager } from './ekubo-v3-pool-manager';
import { DEX_KEY, ROUTER_ADDRESS } from './config';
import { ekuboContracts } from './utils';
import { PoolKey, PoolConfig, ConcentratedPoolTypeConfig } from './pools/utils';
import { fixedSqrtRatioToFloat } from './pools/math/sqrt-ratio';
import { toSqrtRatio } from './pools/math/tick';
import {
  ZeroSeedLaunchPool,
  ZERO_SEED_LAUNCH_ABI,
  ZERO_SEED_LAUNCH_ROBINHOOD,
} from './pools/zero-seed-launch';
import RouterABI from '../../abi/ekubo-v3/mev-capture-router.json';

const key = new PoolKey(
  0n,
  256n,
  new PoolConfig(
    BigInt(ZERO_SEED_LAUNCH_ROBINHOOD),
    0n,
    new ConcentratedPoolTypeConfig(17990),
  ),
);
const lower = 9210880;
const upper = 13798330;
const liquidity = BigNumber.from('1121810267768648385525007');
const iface = new Interface(ZERO_SEED_LAUNCH_ABI);
const launchData = (
  controller = '0x0000000000000000000000000000000000000001',
) =>
  iface.encodeFunctionResult('getLaunch', [
    [
      controller,
      1000,
      '68913100933',
      '922337203685477580',
      '55340232221128654',
      lower,
      upper,
    ],
  ]);

function context(network = 4663) {
  const provider = new StaticJsonRpcProvider('http://127.0.0.1:8545', network);
  const header = { number: 42, hash: '0xabc', timestamp: 1000 };
  const getBlock = jest
    .spyOn(provider, 'getBlock')
    .mockResolvedValue(header as any);
  const call = jest.spyOn(provider, 'call').mockResolvedValue(launchData());
  const contracts = ekuboContracts(provider);
  const getQuoteData = jest.fn().mockResolvedValue([
    {
      tick: upper,
      sqrtRatio: BigNumber.from(fixedSqrtRatioToFloat(toSqrtRatio(upper))),
      liquidity: BigNumber.from(0),
      minTick: lower,
      maxTick: upper,
      ticks: [
        { number: lower, liquidityDelta: liquidity },
        { number: upper, liquidityDelta: liquidity.mul(-1) },
      ],
    },
  ]);
  contracts.core = {
    ...contracts.core,
    quoteDataFetcher: { getQuoteData } as any,
  };
  const logger = { warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as any;
  const helper = {
    provider,
    config: { data: { network } },
  } as unknown as IDexHelper;
  const pool = new ZeroSeedLaunchPool(
    DEX_KEY,
    helper,
    logger,
    contracts,
    42,
    key,
  );
  return {
    pool,
    helper,
    contracts,
    logger,
    header,
    getBlock,
    call,
    getQuoteData,
  };
}

describe('launch pinned state and discovery', () => {
  test('pins both state reads and encodes the bytes32 pool ID', async () => {
    const { pool, call, getBlock, getQuoteData } = context();
    await pool.updateState(42);
    expect(getBlock.mock.calls).toEqual([[42], [42]]);
    expect(getQuoteData).toHaveBeenCalledWith([key.toAbi()], 1, {
      blockTag: 42,
    });
    const [request, block] = call.mock.calls[0];
    expect(await block).toBe(42);
    expect(await request.to).toBe(ZERO_SEED_LAUNCH_ROBINHOOD);
    expect(await request.data).toBe(
      iface.encodeFunctionData('getLaunch', [
        hexZeroPad(hexlify(key.numId), 32),
      ]),
    );
    expect(pool.quote(10n ** 18n, key.token0, 42).calculatedAmount).toBe(
      932986871256060603067126n,
    );
    expect(() => pool.quote(1n, key.token0, 43)).toThrow('requested block');
  });

  test('rejects reorg, missing header, absent launch and unsupported chain', async () => {
    const reorg = context();
    reorg.getBlock
      .mockResolvedValueOnce(reorg.header as any)
      .mockResolvedValueOnce({ ...reorg.header, hash: '0xdef' } as any);
    await expect(reorg.pool.generateState(42)).rejects.toThrow('reorg');
    const missing = context();
    missing.getBlock.mockResolvedValue(null as any);
    await expect(missing.pool.generateState(42)).rejects.toThrow(
      'Missing pinned',
    );
    const unknown = context();
    unknown.call.mockResolvedValue(
      launchData('0x0000000000000000000000000000000000000000'),
    );
    await expect(unknown.pool.generateState(42)).rejects.toThrow(
      'Unknown launch',
    );
    const wrongChain = context(1);
    await expect(wrongChain.pool.generateState(42)).rejects.toThrow(
      'Unsupported launch',
    );
    expect(wrongChain.call).not.toHaveBeenCalled();
  });

  test.each([false, true])(
    'Core initialization discovery, forwarding enabled=%s',
    async enabled => {
      const { helper, contracts, logger, getQuoteData, header } = context();
      const manager = new EkuboV3PoolManager(
        DEX_KEY,
        logger,
        helper,
        contracts,
        'fixture',
        enabled,
      );
      const event = contracts.core.interface.encodeEventLog(
        contracts.core.interface.getEvent('PoolInitialized'),
        [
          hexZeroPad(hexlify(key.numId), 32),
          key.toAbi(),
          upper,
          fixedSqrtRatioToFloat(toSqrtRatio(upper)),
        ],
      );
      await manager.update(
        [
          {
            address: contracts.core.contract.address,
            blockNumber: 42,
            logIndex: 0,
            ...event,
          } as any,
        ],
        { 42: header as any },
        42,
      );
      expect(logger.error).not.toHaveBeenCalled();
      expect(manager.poolsByBI.has(key.numId)).toBe(enabled);
      expect(getQuoteData).toHaveBeenCalledTimes(enabled ? 1 : 0);
      if (enabled)
        expect(manager.poolsByBI.get(key.numId)).toBeInstanceOf(
          ZeroSeedLaunchPool,
        );
    },
  );
});

describe('launch forwarding configuration', () => {
  const data = {
    poolKeyAbi: key.toAbi(),
    isToken1: false,
    skipAhead: { '100': 1 },
  };
  const routerIface = new Interface(RouterABI);
  const build = (
    config: object,
    side = SwapSide.SELL,
    poolKeyAbi = data.poolKeyAbi,
  ) =>
    EkuboV3.prototype.getDexParam.call(
      { network: 4663, config, routerIface } as any,
      key.toAbi().token0,
      key.toAbi().token1,
      '100',
      '100',
      '0x0000000000000000000000000000000000000002',
      { ...data, poolKeyAbi },
      side,
      '0x0000000000000000000000000000000000000003',
    );

  test('requires explicit forwarding router and preserves the signed swap ABI', () => {
    expect(() => build({})).toThrow('forwarding router');
    const router = '0x0000000000000000000000000000000000000004';
    for (const side of [SwapSide.SELL, SwapSide.BUY]) {
      const result = build({ zeroSeedLaunchRouter: router }, side);
      expect(result.targetExchange).toBe(router);
      const decoded = routerIface.decodeFunctionData(
        'swapAllowPartialFill((address,address,bytes32),bytes32,address)',
        result.exchangeData,
      );
      expect(decoded[0].config).toBe(data.poolKeyAbi.config);
      expect(
        BigNumber.from('0x' + decoded[1].slice(26, 58))
          .fromTwos(128)
          .toString(),
      ).toBe(side === SwapSide.SELL ? '100' : '-100');
    }
    const regular = new PoolKey(
      key.token0,
      key.token1,
      new PoolConfig(0n, 0n, new ConcentratedPoolTypeConfig(17990)),
    );
    expect(build({}, SwapSide.SELL, regular.toAbi()).targetExchange).toBe(
      ROUTER_ADDRESS,
    );
  });
});

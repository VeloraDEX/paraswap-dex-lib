import { Interface } from '@ethersproject/abi';
import { LunarBase } from './lunar-base';
import { Network, SwapSide, ETHER_ADDRESS } from '../../constants';
import LunarRouterABI from '../../abi/lunar-base/lunar-router.json';
import { LunarBasePair } from './types';

const routerIface = new Interface(LunarRouterABI);

const WETH = '0x4200000000000000000000000000000000000006';
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const DAI = '0x50c5725949a6f0c72e6c4a641f24049a917db0cb';
const ROUTER = '0x19cef85d1248006e2dfb5a30ad7e5db39155f9fe';
const RECIPIENT = '0x1234567890123456789012345678901234567890';

const mkToken = (address: string, decimals = 18) => ({ address, decimals });

const mkPool = (overrides: Partial<any> = {}) => ({
  address: '0x1111111111111111111111111111111111111111',
  direction: true,
  fee: 3000000,
  baseFeeConfig: {
    baseFee: 3000000,
    wToken0: 500000000,
    wToken1: 500000000,
  },
  userModule: '0x0000000000000000000000000000000000000000',
  moduleMask: 1,
  reservesIn: '100000000000000000000',
  reservesOut: '100000000000',
  isNativeInput: false,
  isNativeOutput: false,
  ...overrides,
});

const mkDex = () => {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  const dexHelper = {
    getLogger: () => logger,
    web3Provider: {
      eth: {
        Contract: jest.fn(() => ({ methods: {} })),
      },
    },
    config: {
      data: {
        wrappedNativeTokenAddress: WETH,
        network: Network.BASE,
        augustusAddress: '0x0000000000000000000000000000000000000000',
        augustusV6Address: '0x0000000000000000000000000000000000000000',
      },
      wrapETH: (token: { address: string; decimals: number }) =>
        token.address.toLowerCase() === ETHER_ADDRESS
          ? { ...token, address: WETH }
          : token,
    },
  };

  return new LunarBase(
    Network.BASE,
    'LunarBase',
    dexHelper as any,
    '0x2222222222222222222222222222222222222222',
    ROUTER,
  );
};

describe('LunarBase', () => {
  it('uses router exact-output calldata for BUY even on non-native pools', () => {
    const lunarBase = mkDex();
    const pool = mkPool();

    const dexParam = lunarBase.getDexParam(
      USDC,
      DAI,
      '1000000',
      '500000000000000000',
      RECIPIENT,
      { router: ROUTER, pools: [pool], weth: WETH },
      SwapSide.BUY,
    );

    expect(dexParam.targetExchange.toLowerCase()).toBe(ROUTER);
    expect(dexParam.transferSrcTokenBeforeSwap).toBeUndefined();

    const decoded = routerIface.decodeFunctionData(
      'swapExactOutputSingle',
      dexParam.exchangeData,
    );
    const params = decoded[0];
    expect(params.amountOut.toString()).toBe('500000000000000000');
    expect(params.amountInMaximum.toString()).toBe('1000000');
  });

  it('does not treat WETH as native input for router calldata', () => {
    const lunarBase = mkDex();
    const pool = mkPool({
      isNativeInput: true,
      isNativeOutput: false,
    });

    const dexParam = lunarBase.getDexParam(
      WETH,
      USDC,
      '1000000000000000000',
      '0',
      RECIPIENT,
      { router: ROUTER, pools: [pool], weth: WETH },
      SwapSide.SELL,
    );

    const decoded = routerIface.decodeFunctionData(
      'swapExactInputSingle',
      dexParam.exchangeData,
    );
    const params = decoded[0];
    expect(params.tokenIn.toLowerCase()).toBe(WETH);
    expect(dexParam.spender?.toLowerCase()).toBe(ROUTER);
  });

  it('sets needWrapNative for ETH direct sells on non-native pools', () => {
    const lunarBase = mkDex();
    const pool = mkPool({ isNativeInput: false, isNativeOutput: false });

    const dexParam = lunarBase.getDexParam(
      ETHER_ADDRESS,
      USDC,
      '10000000000000000',
      '0',
      RECIPIENT,
      { router: ROUTER, pools: [pool], weth: WETH },
      SwapSide.SELL,
    );

    expect(dexParam.targetExchange.toLowerCase()).toBe(pool.address);
    expect(dexParam.transferSrcTokenBeforeSwap?.toLowerCase()).toBe(
      pool.address,
    );
    expect(dexParam.needWrapNative).toBe(true);
  });

  it('builds distinct identifiers for full fee configs and preserves zero fee', async () => {
    const lunarBase = mkDex();
    const fetchPoolsFromApiSpy = jest.spyOn(
      lunarBase as any,
      'fetchPoolsFromApi',
    );

    fetchPoolsFromApiSpy.mockResolvedValue({
      pools: [
        {
          token0: { address: WETH, symbol: 'WETH', decimals: 18 },
          token1: { address: USDC, symbol: 'USDC', decimals: 6 },
          pools: [
            {
              backend: {
                pair_address: '0x1111111111111111111111111111111111111111',
              },
              token0: { address: WETH, symbol: 'WETH', decimals: 18 },
              token1: { address: USDC, symbol: 'USDC', decimals: 6 },
              feeConfig: {
                baseFeeBps: 0,
                wToken0In: '500000000000000000000000',
                wToken1In: '500000000000000000000000',
              },
            },
            {
              backend: {
                pair_address: '0x2222222222222222222222222222222222222222',
              },
              token0: { address: WETH, symbol: 'WETH', decimals: 18 },
              token1: { address: USDC, symbol: 'USDC', decimals: 6 },
              feeConfig: {
                baseFeeBps: 30,
                wToken0In: '800000000000000000000000',
                wToken1In: '200000000000000000000000',
              },
            },
            {
              backend: {
                pair_address: '0x3333333333333333333333333333333333333333',
              },
              token0: { address: WETH, symbol: 'WETH', decimals: 18 },
              token1: { address: USDC, symbol: 'USDC', decimals: 6 },
              feeConfig: {
                baseFeeBps: 30,
                wToken0In: '200000000000000000000000',
                wToken1In: '800000000000000000000000',
              },
            },
          ],
        },
      ],
    });

    const identifiers = await lunarBase.getPoolIdentifiers(
      mkToken(WETH),
      mkToken(USDC, 6),
      SwapSide.SELL,
      1,
    );

    expect(identifiers.length).toBe(3);
    expect(new Set(identifiers).size).toBe(3);
    expect(identifiers.some(id => id.includes('_0_'))).toBe(true);
  });

  it('does not throw on reserve fetch mismatch in batchCatchUpPairs', async () => {
    const lunarBase = mkDex();
    const pair: LunarBasePair = {
      token0: { address: WETH, decimals: 18 },
      token1: { address: USDC, decimals: 6 },
      exchange: '0x1111111111111111111111111111111111111111',
      baseFeeConfig: {
        baseFee: 0,
        wToken0: 500000000,
        wToken1: 500000000,
      },
    };

    jest.spyOn(lunarBase, 'findPair').mockResolvedValue(pair);
    jest.spyOn(lunarBase, 'getManyPoolReserves').mockResolvedValue([]);
    const addPoolSpy = jest.spyOn(lunarBase, 'addPool').mockResolvedValue();

    await expect(
      lunarBase.batchCatchUpPairs([[mkToken(WETH), mkToken(USDC, 6)]], 1),
    ).resolves.toBeUndefined();
    expect(addPoolSpy).not.toHaveBeenCalled();
  });
});

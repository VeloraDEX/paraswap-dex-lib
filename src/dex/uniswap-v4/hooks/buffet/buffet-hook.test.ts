import { BuffetHook, getBuffetHookAmount, getBuffetQuote } from './buffet-hook';
import { BASE_USDC, BuffetHookConfig } from './config';
import { Network, NULL_ADDRESS } from '../../../../constants';
import { BuffetEngineState } from './types';

const WAD = 10n ** 18n;

const baseState: BuffetEngineState = {
  priceE6: 1632150671n,
  depth: 50000000000000n,
  expiryTs: 200n,
  ethBal: 10n * WAD,
  usdcBal: 16321506710n,
  blockTs: 100n,
};

describe('BuffetHook math', () => {
  it('only registers the configured Buffet PropAMM pool', () => {
    const config = BuffetHookConfig[Network.BASE];
    const dexHelper = {
      config: {
        data: {
          wrappedNativeTokenAddress:
            '0x4200000000000000000000000000000000000006',
        },
      },
    } as any;
    const logger = { debug: jest.fn() } as any;
    const hook = new BuffetHook(dexHelper, Network.BASE, logger);
    const poolKey = {
      currency0: config.token0,
      currency1: config.token1,
      fee: config.fee,
      tickSpacing: Number(config.tickSpacing),
      hooks: config.hookAddress,
    };

    expect(hook.registerPool(config.poolId, poolKey)).toBe(true);
    expect(
      hook.registerPool(config.poolId, {
        ...poolKey,
        fee: '500',
      }),
    ).toBe(false);
  });

  it('quotes ETH -> USDC exact input with spread-on path', () => {
    const price = getBuffetQuote(NULL_ADDRESS, WAD, true, baseState);
    expect(price).toEqual(1632036428n);
    expect(getBuffetHookAmount(true, true, WAD, price!)).toEqual(1632036428n);
  });

  it('quotes USDC -> ETH exact input with spread-on path', () => {
    const price = getBuffetQuote(BASE_USDC, 1000n * 10n ** 6n, true, baseState);
    expect(price).toEqual(1632252279n);
    expect(getBuffetHookAmount(false, true, 1000n * 10n ** 6n, price!)).toEqual(
      612650392874715661n,
    );
  });

  it('quotes ETH -> USDC exact output with ceil input rounding', () => {
    const price = getBuffetQuote(
      NULL_ADDRESS,
      1000n * 10n ** 6n,
      false,
      baseState,
    );
    expect(price).toEqual(1632049069n);
    expect(getBuffetHookAmount(true, false, 1000n * 10n ** 6n, price!)).toEqual(
      612726675315422150n,
    );
  });

  it('quotes USDC -> ETH exact output with ceil input rounding', () => {
    const price = getBuffetQuote(BASE_USDC, WAD, false, baseState);
    expect(price).toEqual(1632264922n);
    expect(getBuffetHookAmount(false, false, WAD, price!)).toEqual(1632264922n);
  });

  it('applies inventory impact when the hook is long ETH', () => {
    const price = getBuffetQuote(NULL_ADDRESS, WAD, true, {
      ...baseState,
      ethBal: 20n * WAD,
      usdcBal: 5000n * 10n ** 6n,
    });

    expect(price).toEqual(1631796767n);
    expect(getBuffetHookAmount(true, true, WAD, price!)).toEqual(1631796767n);
  });

  it('rejects expired engine state', () => {
    expect(
      getBuffetQuote(NULL_ADDRESS, WAD, true, {
        ...baseState,
        blockTs: baseState.expiryTs,
      }),
    ).toBeNull();
  });
});

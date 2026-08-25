import { normaliseRemoteDexExchangeParam } from '../src/generic-swap-transaction-builder';

const baseParam = {
  needWrapNative: true,
  exchangeData: '0xdeadbeef',
  targetExchange: '0x0000000000000000000000000000000000000001',
  dexFuncHasRecipient: true,
};

describe('normaliseRemoteDexExchangeParam', () => {
  it('keeps minDeadline returned by a remote dex', () => {
    const param = normaliseRemoteDexExchangeParam({
      ...baseParam,
      minDeadline: '1893456000',
    });

    expect(param.minDeadline).toBe('1893456000');
  });

  it('coerces a null minDeadline to undefined', () => {
    const param = normaliseRemoteDexExchangeParam({
      ...baseParam,
      minDeadline: null,
    });

    expect(param.minDeadline).toBeUndefined();
  });

  it('leaves minDeadline absent when it is not returned', () => {
    const param = normaliseRemoteDexExchangeParam(baseParam);

    expect(param).not.toHaveProperty('minDeadline');
  });
});

// Read at import time by src/config.ts; these tests make no RPC calls.
process.env.HTTP_PROVIDER_1 ??= 'http://localhost:8545';

import { DummyDexHelper } from '../../dex-helper/index';
import { Network } from '../../constants';
import { Fetcher } from '../../lib/fetcher/fetcher';
import { Native } from './native';
import { NATIVE_API_URL } from './constants';

const buildNative = (isSlave = false) => {
  const dexHelper = new DummyDexHelper(Network.MAINNET);
  (dexHelper.config.data as any).nativeApiKey = 'test-key';
  (dexHelper.config as any).isSlave = isSlave;
  return new Native(Network.MAINNET, 'Native', dexHelper);
};

describe('Native initializeBlacklist', () => {
  let polledUrls: string[];

  beforeEach(() => {
    polledUrls = [];
    jest
      .spyOn(Fetcher.prototype, 'startPolling')
      .mockImplementation(function (this: any) {
        this.stop = false;
        polledUrls.push(...this.getUrls());
      });
  });

  afterEach(() => jest.restoreAllMocks());

  it('polls the blacklist without the orderbook', () => {
    buildNative().initializeBlacklist();

    expect(polledUrls).toEqual([`${NATIVE_API_URL}/blacklist`]);
  });

  it('starts the blacklist polling once', () => {
    const native = buildNative();
    native.initializeBlacklist();
    native.initializeBlacklist();

    expect(polledUrls).toEqual([`${NATIVE_API_URL}/blacklist`]);
  });

  it('does not poll on a slave', () => {
    buildNative(true).initializeBlacklist();

    expect(polledUrls).toEqual([]);
  });
});

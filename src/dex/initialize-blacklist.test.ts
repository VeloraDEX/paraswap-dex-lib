// Read at import time by src/config.ts; these tests make no RPC calls.
process.env.HTTP_PROVIDER_1 ??= 'http://localhost:8545';
process.env.HTTP_PROVIDER_42161 ??= 'http://localhost:8545';

import { DummyDexHelper } from '../dex-helper/index';
import { Network } from '../constants';
import { Fetcher } from '../lib/fetcher/fetcher';
import { IDexHelper } from '../dex-helper/idex-helper';
import { Native } from './native/native';
import { NATIVE_API_URL } from './native/constants';
import { Dexalot } from './dexalot/dexalot';
import { DEXALOT_API_URL } from './dexalot/constants';
import { GenericRFQ } from './generic-rfq/generic-rfq';
import { FetcherParams, RFQConfig } from './generic-rfq/types';

const rfqFetcher = (url: string): FetcherParams => ({
  reqParams: { url, method: 'GET' },
  secret: { domain: 'mm', accessKey: 'key', secretKey: 'secret' },
  intervalMs: 1000,
  dataTTLS: 10,
});

const rfqConfig: RFQConfig = {
  tokensConfig: rfqFetcher('https://mm.test/tokens'),
  pairsConfig: rfqFetcher('https://mm.test/pairs'),
  rateConfig: rfqFetcher('https://mm.test/prices'),
  firmRateConfig: { url: 'https://mm.test/firm', method: 'POST' },
  blacklistConfig: rfqFetcher('https://mm.test/blacklist'),
  maker: '0x0000000000000000000000000000000000000001',
  minTradeUsd: null,
};

type BlacklistDex = { initializeBlacklist(): void };

const cases: {
  name: string;
  network: Network;
  build: (network: Network, dexHelper: IDexHelper) => BlacklistDex;
  blacklistUrl: string;
}[] = [
  {
    name: 'Native',
    network: Network.MAINNET,
    build: (network, dexHelper) => {
      (dexHelper.config.data as any).nativeApiKey = 'test-key';
      return new Native(network, 'Native', dexHelper);
    },
    blacklistUrl: `${NATIVE_API_URL}/blacklist`,
  },
  {
    name: 'Dexalot',
    network: Network.ARBITRUM,
    build: (network, dexHelper) => {
      (dexHelper.config.data as any).dexalotAuthToken = 'test-token';
      return new Dexalot(network, 'Dexalot', dexHelper);
    },
    blacklistUrl: `${DEXALOT_API_URL}/api/rfq/blacklist`,
  },
  {
    name: 'GenericRFQ',
    network: Network.MAINNET,
    build: (network, dexHelper) =>
      new GenericRFQ(network, 'ParaSwapPool', dexHelper, rfqConfig),
    blacklistUrl: 'https://mm.test/blacklist',
  },
];

describe.each(cases)(
  '$name initializeBlacklist',
  ({ network, build, blacklistUrl }) => {
    let polledUrls: string[];

    const buildDex = (isSlave = false) => {
      const dexHelper = new DummyDexHelper(network);
      (dexHelper.config as any).isSlave = isSlave;
      return build(network, dexHelper);
    };

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

    it('polls only the blacklist', () => {
      buildDex().initializeBlacklist();

      expect(polledUrls).toEqual([blacklistUrl]);
    });

    it('starts the blacklist polling once', () => {
      const dex = buildDex();
      dex.initializeBlacklist();
      dex.initializeBlacklist();

      expect(polledUrls).toEqual([blacklistUrl]);
    });

    it('does not poll on a slave', () => {
      buildDex(true).initializeBlacklist();

      expect(polledUrls).toEqual([]);
    });
  },
);

describe('GenericRFQ without a blacklist config', () => {
  it('polls nothing', () => {
    const polled = jest
      .spyOn(Fetcher.prototype, 'startPolling')
      .mockImplementation(() => undefined);
    const { blacklistConfig, ...config } = rfqConfig;

    new GenericRFQ(
      Network.MAINNET,
      'ParaSwapPool',
      new DummyDexHelper(Network.MAINNET),
      config,
    ).initializeBlacklist();

    expect(polled).not.toHaveBeenCalled();
    polled.mockRestore();
  });
});

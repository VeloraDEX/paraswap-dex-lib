import dotenv from 'dotenv';
dotenv.config();

import Web3 from 'web3';
import { generateConfig } from '../../config';
import { DummyRequestWrapper } from '../../dex-helper/dummy-dex-helper';
import { RequestConfig } from '../../dex-helper/irequest-wrapper';
import { Fetcher } from '../../lib/fetcher/fetcher';
import { getLogger } from '../../lib/log4js';
import { MultiWrapper } from '../../lib/multi-wrapper';
import { genericRFQAuthHttp } from './security';
import {
  BlackListResponse,
  FetcherParams,
  PairsResponse,
  RatesResponse,
  RFQFirmRateResponse,
  TokensResponse,
} from './types';
import {
  blacklistResponseValidator,
  firmRateWithTakerValidator,
  pairsResponseValidator,
  pricesResponse,
  tokensResponseValidator,
} from './validators';
import MultiV2Abi from '../../abi/multi-v2.json';
import { AbiItem } from 'web3-utils';
import { checkOrder } from './utils';
import { validateAndCast } from '../../lib/validators';

const network = 1;
const AugustusAddress = {
  1: '0xdef171fe48cf0115b1d80b88dc8eab59176fee57',
};

export const getEnv = (envName: string, optional: boolean = false): string => {
  if (!process.env[envName]) {
    if (optional) {
      return '';
    }

    throw new Error(`Missing ${envName}`);
  }

  return process.env[envName]!;
};

const web3 = new Web3(getEnv(`HTTP_PROVIDER_${network}`));

const config = generateConfig(network);
const multiWrapper = new MultiWrapper(
  new web3.eth.Contract(MultiV2Abi as AbiItem[], config.multicallV2Address),
  getLogger(`MultiWrapper-${network}`),
);

const url = getEnv('GENERIC_RFQ_URL');
const path = getEnv('GENERIC_RFQ_PATH_TO_OVERRIDE');

const authHttp = genericRFQAuthHttp(path);

const secret = {
  secretKey: atob(getEnv('GENERIC_RFQ_SECRET_KEY')),
  accessKey: getEnv('GENERIC_RFQ_ACCESS_KEY'),
  domain: 'paraswap',
};

const configTokens: FetcherParams = {
  reqParams: {
    url: `${url}/tokens`,
    method: 'GET',
  },
  secret: secret,
  intervalMs: 5 * 1000,
  dataTTLS: 10 * 1000,
};

const debug = true;

const requestWrapper = new DummyRequestWrapper();

const mainTokens = async () => {
  const logger = getLogger('tokens');
  const fetcher = new Fetcher<any>(
    requestWrapper,
    {
      info: {
        requestOptions: configTokens.reqParams,
        caster: (data: unknown) => {
          return validateAndCast<TokensResponse>(data, tokensResponseValidator);
        },
        authenticate: authHttp(configTokens.secret),
      },
      handler: (data: TokensResponse) => {
        logger.info(
          `Tokens OK. (Found ${Object.keys(data.tokens).length} elements)`,
        );

        if (!debug) return;

        logger.info(data);
      },
    },
    configTokens.intervalMs,
    logger,
  );

  fetcher.fetch(true);
};

const configPairs: FetcherParams = {
  reqParams: {
    url: `${url}/pairs`,
    method: 'GET',
  },
  secret: secret,
  intervalMs: 5 * 1000,
  dataTTLS: 10 * 1000,
};

const mainPairs = async () => {
  const logger = getLogger('pairs');
  const fetcher = new Fetcher<any>(
    requestWrapper,
    {
      info: {
        requestOptions: configPairs.reqParams,
        caster: (data: unknown) => {
          return validateAndCast<PairsResponse>(data, pairsResponseValidator);
        },
        authenticate: authHttp(configPairs.secret),
      },
      handler: (data: PairsResponse) => {
        logger.info(
          `Pairs OK. (Found ${Object.keys(data.pairs).length} elements)`,
        );

        if (!debug) return;

        logger.info(data);
      },
    },
    configPairs.intervalMs,
    logger,
  );
  fetcher.fetch(true);
};

const configPrices: FetcherParams = {
  reqParams: {
    url: `${url}/prices`,
    method: 'GET',
  },
  secret,
  intervalMs: 5 * 1000,
  dataTTLS: 10 * 1000,
};

const mainPrices = async () => {
  const logger = getLogger('prices');
  const fetcher = new Fetcher<any>(
    requestWrapper,
    {
      info: {
        requestOptions: configPrices.reqParams,
        caster: (data: unknown) => {
          return validateAndCast<RatesResponse>(data, pricesResponse);
        },
        authenticate: authHttp(configPrices.secret),
      },
      handler: (data: RatesResponse) => {
        logger.info(
          `Prices OK. (Found ${Object.keys(data.prices).length} elements)`,
        );

        if (!debug) return;
        Object.keys(data.prices).forEach(key => {
          const prices: any = data.prices[key];
          logger.info(key);
          logger.info('bids', prices.bids);
          logger.info('asks', prices.asks);
        });
      },
    },
    configPrices.intervalMs,
    logger,
  );

  fetcher.fetch(true);
};

const configBlacklist: FetcherParams = {
  reqParams: {
    url: `${url}/blacklist`,
    method: 'GET',
  },
  secret,
  intervalMs: 5 * 1000,
  dataTTLS: 10 * 1000,
};

const mainBlacklist = async () => {
  const logger = getLogger('blacklist');
  const fetcher = new Fetcher<any>(
    requestWrapper,
    {
      info: {
        requestOptions: configBlacklist.reqParams,
        caster: (data: unknown) => {
          return validateAndCast<BlackListResponse>(
            data,
            blacklistResponseValidator,
          );
        },
        authenticate: authHttp(configBlacklist.secret),
      },
      handler: (data: BlackListResponse) => {
        logger.info(
          `Blacklist OK. (Found ${
            Object.keys(data.blacklist).length
          } elements)`,
        );

        if (!debug) return;
        logger.info(data);
      },
    },
    configBlacklist.intervalMs,
    logger,
  );

  fetcher.fetch(true);
};

mainTokens();
mainPairs();
mainPrices();
mainBlacklist();

const mainFirm = async () => {
  const logger = getLogger('firm');

  const payload: RequestConfig = {
    url: `${url}/firm`,
    method: 'POST',
    data: {
      makerAsset: '__TO_FILL__',
      takerAsset: '__TO_FILL__',
      makerAmount: '__TO_FILL__', // either makerAmount or takerAmount have a value
      takerAmount: undefined,
      userAddress: '__TO_FILL__',
    },
  };

  if (
    payload.data['makerAsset'] === '__TO_FILL__' ||
    payload.data['takerAsset'] === '__TO_FILL__' ||
    payload.data['makerAmount'] === '__TO_FILL__' ||
    payload.data['takerAmount'] === '__TO_FILL__' ||
    payload.data['userAddress'] === '__TO_FILL__'
  ) {
    logger.error(`Please fill payload to test your api implementation`);
    return;
  }
  authHttp(secret)(payload);

  try {
    const res = await requestWrapper.request<unknown>(payload);

    const firmRateResp = validateAndCast<RFQFirmRateResponse>(
      res,
      firmRateWithTakerValidator(AugustusAddress[network]),
    );

    await checkOrder(
      network,
      config.multicallV2Address,
      multiWrapper,
      firmRateResp.order,
    );

    logger.info(res.data);
  } catch (e) {
    logger.info(e);
  }
};

// mainFirm();

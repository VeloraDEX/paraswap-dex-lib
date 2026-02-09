import dotenv from 'dotenv';
dotenv.config();

import {
  Network,
  ContractMethod,
  SwapSide,
  NULL_ADDRESS,
} from '../../constants';
import { generateConfig } from '../../config';
import { testE2E } from '../../../tests/utils-e2e';
import { getEnv } from './fetch-mm-api';
import { Tokens } from '../../../tests/constants-e2e';
import { RFQConfig } from './types';
import { testConfig } from './e2e-test-config';

jest.setTimeout(1000 * 60 * 3);

const buildConfigForGenericRFQ = (): RFQConfig => {
  const url = getEnv('GENERIC_RFQ_URL');

  const secret = {
    secretKey: Buffer.from(getEnv('GENERIC_RFQ_SECRET_KEY'), 'base64').toString(
      'binary',
    ),
    accessKey: getEnv('GENERIC_RFQ_ACCESS_KEY'),
    domain: 'paraswap',
  };

  const pathToRemove = getEnv('GENERIC_RFQ_PATH_TO_OVERRIDE', true);

  return {
    maker: getEnv('GENERIC_RFQ_MAKER_ADDRESS'),
    tokensConfig: {
      reqParams: {
        url: `${url}/tokens`,
        method: 'GET',
      },
      secret,
      intervalMs: 1000 * 60 * 60 * 10, // every 10 minutes
      dataTTLS: 1000 * 60 * 60 * 11, // ttl 11 minutes
    },
    pairsConfig: {
      reqParams: {
        url: `${url}/pairs`,
        method: 'GET',
      },
      secret,
      intervalMs: 1000 * 60 * 60 * 10, // every 10 minutes
      dataTTLS: 1000 * 60 * 60 * 11, // ttl 11 minutes
    },
    rateConfig: {
      reqParams: {
        url: `${url}/prices`,
        method: 'GET',
      },
      secret,
      intervalMs: 1000 * 2 * 1, // every 2 seconds
      dataTTLS: 1000 * 5 * 1, // ttl 5 seconds
    },
    firmRateConfig: {
      url: `${url}/firm`,
      method: 'POST',
      secret,
    },
    blacklistConfig: {
      reqParams: {
        url: `${url}/blacklist`,
        method: 'GET',
      },
      secret,
      intervalMs: 1000 * 60 * 60 * 10,
      dataTTLS: 1000 * 60 * 60 * 11,
    },
    pathToRemove,
  };
};

const dexKey = 'YOUR_NAME';

describe(`GenericRFQ ${dexKey} E2E`, () => {
  for (const [_network, testCases] of Object.entries(testConfig)) {
    const network = parseInt(_network, 10);
    const tokens = Tokens[network];
    const config = generateConfig(network);

    config.rfqConfigs[dexKey] = buildConfigForGenericRFQ();
    describe(`${Network[network]}`, () => {
      for (const testCase of testCases) {
        const srcToken = tokens[testCase.srcToken];
        const destToken = tokens[testCase.destToken];

        const contractMethod =
          testCase.swapSide === SwapSide.BUY
            ? ContractMethod.swapOnAugustusRFQTryBatchFill
            : ContractMethod.swapOnAugustusRFQTryBatchFill;
        describe(`${contractMethod}`, () => {
          it(`${testCase.swapSide} ${testCase.srcToken} -> ${testCase.destToken}`, async () => {
            await testE2E(
              srcToken,
              destToken,
              NULL_ADDRESS,
              testCase.amount,
              testCase.swapSide as SwapSide,
              [dexKey],
              contractMethod,
              network,
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              5000, // sleep for 5 seconds
            );
          });
        });
      }
    });
  }
});

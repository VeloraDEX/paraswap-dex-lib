import dotenv from 'dotenv';
dotenv.config();

import { ethers } from 'ethers';
import {
  Network,
  ContractMethod,
  SwapSide,
  NULL_ADDRESS,
} from '../../constants';
import { generateConfig } from '../../config';
import { testE2E } from '../../../tests/utils-e2e';
import { Tokens } from '../../../tests/constants-e2e';
import { startTestServer } from './example-api.test';

const PK_KEY = process.env.TEST_PK_KEY;

if (!PK_KEY) {
  throw new Error('Missing TEST_PK_KEY');
}

const testAccount = new ethers.Wallet(PK_KEY!);

jest.setTimeout(1000 * 60 * 3);

describe('GenericRFQ E2E Mainnet', () => {
  let stopServer: undefined | Function = undefined;

  beforeAll(() => {
    stopServer = startTestServer(testAccount);
  });

  const network = Network.MAINNET;
  const tokens = Tokens[network];

  const srcToken = tokens.WETH;
  const destToken = tokens.DAI;

  const config = generateConfig(network);

  describe('GenericRFQ', () => {
    const dexKey = 'DummyParaSwapPool';

    describe('Simpleswap', () => {
      it('SELL WETH -> DAI', async () => {
        await testE2E(
          srcToken,
          destToken,
          NULL_ADDRESS,
          '1000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
        );
      });

      it('SELL DAI -> WETH', async () => {
        await testE2E(
          destToken,
          srcToken,
          NULL_ADDRESS,
          '1000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
        );
      });

      it('BUY WETH -> DAI', async () => {
        await testE2E(
          srcToken,
          destToken,
          NULL_ADDRESS,
          '1000000000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.simpleBuy,
          network,
        );
      });

      it('BUY DAI -> WETH', async () => {
        await testE2E(
          destToken,
          srcToken,
          NULL_ADDRESS,
          '1000000000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.simpleBuy,
          network,
        );
      });
    });
  });

  afterAll(() => {
    if (stopServer) {
      stopServer();
    }
  });
});

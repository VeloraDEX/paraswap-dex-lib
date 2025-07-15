import dotenv from 'dotenv';
dotenv.config();

import { ethers } from 'ethers';
import { Network, ContractMethod, SwapSide, MAX_UINT } from '../../constants';
import { generateConfig } from '../../config';
import { newTestE2E } from '../../../tests/utils-e2e';
import { GENERIC_ADDR1, Tokens } from '../../../tests/constants-e2e';
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
        await newTestE2E({
          config,
          srcToken,
          destToken,
          senderAddress: GENERIC_ADDR1,
          thirdPartyAddress: testAccount.address,
          _amount: '1000000000000000000',
          swapSide: SwapSide.SELL,
          dexKeys: dexKey,
          contractMethod: ContractMethod.simpleSwap,
          network: network,
        });
      });

      it('SELL DAI -> WETH', async () => {
        await newTestE2E({
          config,
          destToken,
          srcToken,
          senderAddress: GENERIC_ADDR1,
          thirdPartyAddress: testAccount.address,
          _amount: '1000000000000000000',
          swapSide: SwapSide.SELL,
          dexKeys: dexKey,
          contractMethod: ContractMethod.simpleSwap,
          network: network,
        });
      });

      it('BUY WETH -> DAI', async () => {
        await newTestE2E({
          config,
          srcToken,
          destToken,
          senderAddress: GENERIC_ADDR1,
          thirdPartyAddress: testAccount.address,
          _amount: '1000000000000000000',
          swapSide: SwapSide.BUY,
          dexKeys: dexKey,
          contractMethod: ContractMethod.simpleBuy,
          network: network,
        });
      });

      it('BUY DAI -> WETH', async () => {
        await newTestE2E({
          config,
          destToken,
          srcToken,
          senderAddress: GENERIC_ADDR1,
          thirdPartyAddress: testAccount.address,
          _amount: '1000000000000000000',
          swapSide: SwapSide.BUY,
          dexKeys: dexKey,
          contractMethod: ContractMethod.simpleBuy,
          network: network,
        });
      });
    });
  });

  afterAll(() => {
    if (stopServer) {
      stopServer();
    }
  });
});

import dotenv from 'dotenv';
dotenv.config();

import { ethers } from 'ethers';
import { Network, ContractMethod, SwapSide, MAX_UINT } from '../../constants';
import { generateConfig } from '../../config';
import { newTestE2E } from '../../../tests/utils-e2e';
import { SmartTokens, GENERIC_ADDR1 } from '../../../tests/constants-e2e';
import { startTestServer } from './test-server.test';
import { AirSwapConfig } from './config';

const PK_KEY = process.env.TEST_PK_KEY;
if (!PK_KEY) {
  throw new Error('Missing TEST_PK_KEY');
}

const testAccount = new ethers.Wallet(PK_KEY!);

jest.setTimeout(1000 * 60 * 3);

describe('AirSwap E2E Mainnet', () => {
  let stopServer: undefined | Function = undefined;

  beforeAll(() => {
    stopServer = startTestServer(testAccount);
  });

  const network = Network.MAINNET;
  const smartTokens = SmartTokens[network];

  const srcToken = smartTokens.WETH;
  const destToken = smartTokens.DAI;

  const config = generateConfig(network);

  describe('AirSwap', () => {
    const dexKey = 'AirSwap';

    srcToken.addBalance(testAccount.address, MAX_UINT);
    srcToken.addAllowance(
      testAccount.address,
      AirSwapConfig.AirSwap[network].swapERC20Address,
      MAX_UINT,
    );

    destToken.addBalance(testAccount.address, MAX_UINT);
    destToken.addAllowance(
      testAccount.address,
      AirSwapConfig.AirSwap[network].swapERC20Address,
      MAX_UINT,
    );

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
          dexKey: dexKey,
          contractMethod: ContractMethod.simpleSwap,
          network: network,
          sleepMs: 3000,
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

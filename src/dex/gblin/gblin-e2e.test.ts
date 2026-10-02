/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { testE2E } from '../../../tests/utils-e2e';
import { Network, ContractMethod, SwapSide } from '../../constants';
import { StaticJsonRpcProvider } from '@ethersproject/providers';
import { generateConfig } from '../../config';
import { GblinConfig } from './config';
import { BI_POWS } from '../../bigint-constants';

const network = Network.BASE;
const dexKey = 'Gblin';
const { vault, weth } = GblinConfig[dexKey][network];

describe('Gblin E2E Base', () => {
  const provider = new StaticJsonRpcProvider(
    generateConfig(network).privateHttpProvider,
    network,
  );
  const wethToken = { address: weth, decimals: 18, symbol: 'WETH' };
  const gblinToken = { address: vault, decimals: 18, symbol: 'GBLIN' };
  const wethAmount = BI_POWS[15].toString(); // 0.001 WETH

  describe(`SELL: ${dexKey}`, () => {
    it(`${ContractMethod.swapExactAmountIn} WETH -> GBLIN`, async () => {
      await testE2E(
        wethToken,
        gblinToken,
        '',
        wethAmount,
        SwapSide.SELL,
        dexKey,
        ContractMethod.swapExactAmountIn,
        network,
        provider,
      );
    });
  });
});

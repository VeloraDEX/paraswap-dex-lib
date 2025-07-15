/* eslint-disable no-console */
import 'dotenv/config';
import { testGasEstimation } from '../../../tests/utils-e2e';
import { Tokens } from '../../../tests/constants-e2e';
import { Network, SwapSide } from '../../constants';
import { ContractMethodV6 } from '@paraswap/core';

describe('PolygonMigrator Gas Estimation', () => {
  const dexKey = 'PolygonMigrator';
  const network = Network.MAINNET;

  describe('swapExactAmountIn', () => {
    const POL = Tokens[network]['POL'];
    const MATIC = Tokens[network]['MATIC'];
    const amount = 10000000000000000000n;

    it('unmigrate', async () => {
      await testGasEstimation(
        network,
        POL,
        MATIC,
        amount,
        SwapSide.SELL,
        dexKey,
        ContractMethodV6.swapExactAmountIn,
      );
    });

    it('migrate', async () => {
      await testGasEstimation(
        network,
        MATIC,
        POL,
        amount,
        SwapSide.SELL,
        dexKey,
        ContractMethodV6.swapExactAmountIn,
      );
    });
  });
});

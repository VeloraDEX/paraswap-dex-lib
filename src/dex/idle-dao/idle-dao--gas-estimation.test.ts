/* eslint-disable no-console */
import 'dotenv/config';
import { testGasEstimation } from '../../../tests/utils-e2e';
import { Tokens } from '../../../tests/constants-e2e';
import { Network, SwapSide } from '../../constants';
import { ContractMethodV6 } from '@paraswap/core';

describe('IdleDao Gas Estimation', () => {
  const dexKey = 'IdleDao';
  const network = Network.MAINNET;

  describe('swapExactAmountIn', () => {
    const STETH = Tokens[network]['STETH'];
    const AA_wstETH = Tokens[network]['AA_wstETH'];
    const amount = 1000000000000000000n;

    // todo: uncomment? (the dex doesn't seem to be working)
    // it('deposit', async () => {
    //   await testGasEstimation(
    //     network,
    //     STETH,
    //     AA_wstETH,
    //     amount,
    //     SwapSide.SELL,
    //     dexKey,
    //     ContractMethodV6.swapExactAmountIn,
    //   );
    // });
  });
});

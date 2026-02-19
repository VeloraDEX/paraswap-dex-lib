import dotenv from 'dotenv';
dotenv.config();

import { StaticJsonRpcProvider } from '@ethersproject/providers';
import {
  Holders,
  NativeTokenSymbols,
  Tokens,
} from '../../../tests/constants-e2e';
import { testE2E } from '../../../tests/utils-e2e';
import { generateConfig } from '../../config';
import { ContractMethod, Network, SwapSide } from '../../constants';
import { LocalParaswapSDK } from '../../implementations/local-paraswap-sdk';

// Native firm quotes require contacting the external RFQ backend and then
// running a Tenderly simulation; a single case typically takes >30s so we
// extend Jest’s default timeout for this file.
jest.setTimeout(30_000);

// Wait for orderbook to be fetched
const sleepMs = 2000;

const contractMethod = ContractMethod.swapExactAmountIn;
const side = SwapSide.SELL;
const dexKey = 'Native';
const MISSING_PRICE_ERROR = 'Fail to get price for';

type NativeE2ENetworkConfig = {
  label: string;
  network: Network;
  tokenASymbol: string;
  tokenBSymbol: string;
  tokenAAmount: string;
  tokenBAmount: string;
  nativeTokenAmount: string;
};

function runNativeTestsForNetwork({
  label,
  network,
  tokenASymbol,
  tokenBSymbol,
  tokenAAmount,
  tokenBAmount,
  nativeTokenAmount,
}: NativeE2ENetworkConfig) {
  describe(label, () => {
    const provider = new StaticJsonRpcProvider(
      generateConfig(network).privateHttpProvider,
      network,
    );
    const tokens = Tokens[network];
    const holders = Holders[network];
    const nativeTokenSymbol = NativeTokenSymbols[network];

    const runCase = (
      title: string,
      srcSymbol: string,
      destSymbol: string,
      amount: string,
    ) => {
      it(
        title,
        async () => {
          await testE2E(
            tokens[srcSymbol],
            tokens[destSymbol],
            holders[srcSymbol],
            amount,
            side,
            dexKey,
            contractMethod,
            network,
            provider,
            undefined,
            undefined,
            undefined,
            undefined,
            sleepMs,
          );
        },
        120_000,
      );
    };

    runCase(
      `${nativeTokenSymbol} -> ${tokenASymbol}`,
      nativeTokenSymbol,
      tokenASymbol,
      nativeTokenAmount,
    );
    runCase(
      `${tokenASymbol} -> ${nativeTokenSymbol}`,
      tokenASymbol,
      nativeTokenSymbol,
      tokenAAmount,
    );
    runCase(
      `${tokenASymbol} -> ${tokenBSymbol}`,
      tokenASymbol,
      tokenBSymbol,
      tokenAAmount,
    );
    runCase(
      `${tokenBSymbol} -> ${tokenASymbol}`,
      tokenBSymbol,
      tokenASymbol,
      tokenBAmount,
    );
  });
}

describe('Native E2E', () => {
  const testMatrix: NativeE2ENetworkConfig[] = [
    // {
    //   label: 'Mainnet',
    //   network: Network.MAINNET,
    //   tokenASymbol: 'USDT',
    //   tokenBSymbol: 'WETH',
    //   tokenAAmount: '1000000000', // 1000 USDC
    //   tokenBAmount: '1000000000000000000', // 1 ETH
    //   nativeTokenAmount: '1000000000000000000', // 1 ETH
    // },
    // {
    //   label: 'BSC',
    //   network: Network.BSC,
    //   tokenASymbol: 'USDT',
    //   tokenBSymbol: 'WBNB',
    //   tokenAAmount: '100000000000000000000', // 100 USDT
    //   tokenBAmount: '500000000000000000', // 0.5 WBNB
    //   nativeTokenAmount: '500000000000000000', // 0.5 BNB
    // },
    // {
    //   label: 'Arbitrum',
    //   network: Network.ARBITRUM,
    //   tokenASymbol: 'USDT',
    //   tokenBSymbol: 'WETH',
    //   tokenAAmount: '100000000', // 100 USDT
    //   tokenBAmount: '1000000000000000000', // 1 WETH
    //   nativeTokenAmount: '1000000000000000000', // 1 ETH
    // },
    {
      label: 'Base',
      network: Network.BASE,
      tokenASymbol: 'USDC',
      tokenBSymbol: 'WETH',
      tokenAAmount: '100000000', // 100 USDC
      tokenBAmount: '1000000000000000000', // 1 WETH
      nativeTokenAmount: '1000000000000000000', // 1 ETH
    },
  ];

  testMatrix.forEach(runNativeTestsForNetwork);
});

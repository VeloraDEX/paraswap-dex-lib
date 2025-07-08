/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { testE2E } from '../../../tests/utils-e2e';
import {
  Tokens,
  Holders,
  NativeTokenSymbols,
} from '../../../tests/constants-e2e';
import { Network, ContractMethod, SwapSide } from '../../constants';
import { StaticJsonRpcProvider } from '@ethersproject/providers';
import { generateConfig } from '../../config';

/*
  README
  ======

  This test script should add e2e tests for BalancerV3. The tests
  should cover as many cases as possible. Most of the DEXes follow
  the following test structure:
    - DexName
      - ForkName + Network
        - ContractMethod
          - ETH -> Token swap
          - Token -> ETH swap
          - Token -> Token swap

  The template already enumerates the basic structure which involves
  testing simpleSwap, multiSwap, megaSwap contract methods for
  ETH <> TOKEN and TOKEN <> TOKEN swaps. You should replace tokenA and
  tokenB with any two highly liquid tokens on BalancerV3 for the tests
  to work. If the tokens that you would like to use are not defined in
  Tokens or Holders map, you can update the './tests/constants-e2e'

  Other than the standard cases that are already added by the template
  it is highly recommended to add test cases which could be specific
  to testing BalancerV3 (Eg. Tests based on poolType, special tokens,
  etc).

  You can run this individual test script by running:
  `npx jest src/dex/<dex-name>/<dex-name>-e2e.test.ts`

  e2e tests use the Tenderly fork api. Please add the following to your
  .env file:
  TENDERLY_TOKEN=Find this under Account>Settings>Authorization.
  TENDERLY_ACCOUNT_ID=Your Tenderly account name.
  TENDERLY_PROJECT=Name of a Tenderly project you have created in your
  dashboard.

  (This comment should be removed from the final implementation)
*/

function testForNetwork(
  network: Network,
  dexKey: string,
  tokenASymbol: string,
  tokenBSymbol: string,
  tokenAAmount: string,
  tokenBAmount: string,
  nativeTokenAmount: string,
  testNative: boolean,
  poolIds?: string[],
) {
  const provider = new StaticJsonRpcProvider(
    generateConfig(network).privateHttpProvider,
    network,
  );
  const tokens = Tokens[network];
  const holders = Holders[network];
  const nativeTokenSymbol = NativeTokenSymbols[network];

  const poolIdentifiers = poolIds ? { [dexKey]: poolIds } : undefined;

  const sideToContractMethods = new Map([
    [SwapSide.SELL, [ContractMethod.swapExactAmountIn]],
    [SwapSide.BUY, [ContractMethod.swapExactAmountOut]],
  ]);

  describe(`${network}`, () => {
    sideToContractMethods.forEach((contractMethods, side) =>
      describe(`${side}`, () => {
        contractMethods.forEach((contractMethod: ContractMethod) => {
          describe(`${contractMethod}`, () => {
            if (testNative) {
              it(`${nativeTokenSymbol} -> ${tokenASymbol}`, async () => {
                await testE2E(
                  tokens[nativeTokenSymbol],
                  tokens[tokenASymbol],
                  holders[nativeTokenSymbol],
                  side === SwapSide.SELL ? nativeTokenAmount : tokenAAmount,
                  side,
                  dexKey,
                  contractMethod,
                  network,
                  provider,
                  poolIdentifiers,
                );
              });
              it(`${tokenASymbol} -> ${nativeTokenSymbol}`, async () => {
                await testE2E(
                  tokens[tokenASymbol],
                  tokens[nativeTokenSymbol],
                  holders[tokenASymbol],
                  side === SwapSide.SELL ? tokenAAmount : nativeTokenAmount,
                  side,
                  dexKey,
                  contractMethod,
                  network,
                  provider,
                  poolIdentifiers,
                );
              });
            }
            it(`${tokenASymbol} -> ${tokenBSymbol}`, async () => {
              await testE2E(
                tokens[tokenASymbol],
                tokens[tokenBSymbol],
                holders[tokenASymbol],
                side === SwapSide.SELL ? tokenAAmount : tokenBAmount,
                side,
                dexKey,
                contractMethod,
                network,
                provider,
                poolIdentifiers,
              );
            });
            it(`${tokenBSymbol} -> ${tokenASymbol}`, async () => {
              await testE2E(
                tokens[tokenBSymbol],
                tokens[tokenASymbol],
                holders[tokenBSymbol],
                side === SwapSide.SELL ? tokenBAmount : tokenAAmount,
                side,
                dexKey,
                contractMethod,
                network,
                provider,
                poolIdentifiers,
              );
            });
          });
        });
      }),
    );
  });
}

// TODO - these tests dont currently run without full PS setup on Sepolia
describe('BalancerV3 E2E', () => {
  const dexKey = 'BalancerV3';

  describe.skip('Sepolia', () => {
    const network = Network.SEPOLIA;

    describe('Weighted Path', () => {
      const tokenASymbol: string = 'bal';
      const tokenBSymbol: string = 'daiAave';

      const tokenAAmount: string = '1000000000000000000';
      const tokenBAmount: string = '1000000000000000000';
      const nativeTokenAmount = '100000000000000';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
        nativeTokenAmount,
        true,
      );
    });

    describe('Stable Path', () => {
      const tokenASymbol: string = 'stataUSDT';
      const tokenBSymbol: string = 'stataUSDC';

      const tokenAAmount: string = '10000000';
      const tokenBAmount: string = '10000000';
      const nativeTokenAmount = '0';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
        nativeTokenAmount,
        false,
      );
    });

    describe('Boosted Path', () => {
      const tokenASymbol: string = 'usdcAave';
      const tokenBSymbol: string = 'daiAave';

      const tokenAAmount: string = '10000000';
      const tokenBAmount: string = '1000000000000000000';
      const nativeTokenAmount = '0';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
        nativeTokenAmount,
        false,
      );
    });

    describe('GyroE Path', () => {
      const tokenASymbol: string = 'bal';
      const tokenBSymbol: string = 'DAI';

      const tokenAAmount: string = '100000000000';
      const tokenBAmount: string = '100000000000';
      const nativeTokenAmount = '0';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
        nativeTokenAmount,
        false,
        ['0x80fd5bc9d4fa6c22132f8bb2d9d30b01c3336fb3'],
      );
    });
  });

  describe('Gnosis', () => {
    const network = Network.GNOSIS;

    describe('Stable Path', () => {
      const tokenASymbol: string = 'WXDAI';
      const tokenBSymbol: string = 'COW';

      const tokenAAmount: string = '100000000000000000';
      const tokenBAmount: string = '100000000000000000';
      const nativeTokenAmount = '100000000000000';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
        nativeTokenAmount,
        false,
      );
    });

    describe('Weighed Path', () => {
      const tokenASymbol: string = 'sDAI';
      const tokenBSymbol: string = 'XDAI';

      const tokenAAmount: string = '100000000000000000';
      const tokenBAmount: string = '100000000000000000';
      const nativeTokenAmount = '100000000000000000';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
        nativeTokenAmount,
        false,
      );
    });

    describe('Boosted Path', () => {
      const tokenASymbol: string = 'waGnoWETH';
      const tokenBSymbol: string = 'waGnowstETH';

      const tokenAAmount: string = '1000000000000000';
      const tokenBAmount: string = '1000000000000000';
      const nativeTokenAmount = '0';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
        nativeTokenAmount,
        false,
      );
    });
  });

  describe('Mainnet', () => {
    const network = Network.MAINNET;

    describe('Stable Path', () => {
      const tokenASymbol: string = 'wUSDL';
      const tokenBSymbol: string = 'USDC';

      const tokenAAmount: string = '1000000000000000000';
      const tokenBAmount: string = '10000000';
      const nativeTokenAmount = '0';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
        nativeTokenAmount,
        false,
      );
    });

    describe('reClamm Pool', function () {
      const tokenASymbol: string = 'WETH';
      const tokenBSymbol: string = 'USDC';

      const tokenAAmount: string = '100000000000000';
      const tokenBAmount: string = '500000';
      const nativeTokenAmount = '0';
      // Filter to known reClamm pool to make sure its picked up
      // https://balancer.fi/pools/base/v3/0x9e79501c27C772b5e3EFef3E6963027AEF0618b0
      const reClammPool =
        '0x9e79501c27C772b5e3EFef3E6963027AEF0618b0'.toLowerCase();
      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
        nativeTokenAmount,
        false,
        [reClammPool],
      );
    });

    describe('quantAMM Pool', function () {
      const tokenASymbol: string = 'USDC';
      const tokenBSymbol: string = 'WBTC';

      const tokenAAmount: string = '1000000';
      const tokenBAmount: string = '1000000';
      const nativeTokenAmount = '0';
      // Filter to known quantAMM pool to make sure its picked up
      // https://balancer.fi/pools/ethereum/v3/0x6b61d8680c4f9e560c8306807908553f95c749c5
      const quantAMMPool = '0x6b61d8680c4f9e560c8306807908553f95c749c5';
      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
        nativeTokenAmount,
        false,
        [quantAMMPool],
      );
    });

    describe('StableSurgeV2 Hook', function () {
      const tokenASymbol: string = 'EUROC';
      const tokenBSymbol: string = 'RLUSD';

      const tokenAAmount: string = '1000000';
      const tokenBAmount: string = '1000000000000000000';
      const nativeTokenAmount = '0';
      // Filter to known pool with stableSurgeV2 hook to make sure its picked up
      // https://balancer.fi/pools/ethereum/v3/0x0629e9703f0447402158eedca5148fe98df6d7a3
      const stableSurgeV2Pool = '0x0629e9703f0447402158eedca5148fe98df6d7a3';
      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
        nativeTokenAmount,
        false,
        [stableSurgeV2Pool],
      );
    });
  });

  describe('Arbitrum', () => {
    const network = Network.ARBITRUM;

    describe('Stable Path', () => {
      const tokenASymbol: string = 'wstETH';
      const tokenBSymbol: string = 'WETH';

      const tokenAAmount: string = '10000000000000';
      const tokenBAmount: string = '10000000000000';
      const nativeTokenAmount = '0';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
        nativeTokenAmount,
        false,
      );
    });

    describe('Boosted Path', () => {
      const tokenASymbol: string = 'waArbWETH';
      const tokenBSymbol: string = 'waArbwstETH';

      const tokenAAmount: string = '10000000000000';
      const tokenBAmount: string = '10000000000000';
      const nativeTokenAmount = '0';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
        nativeTokenAmount,
        false,
      );
    });

    describe('Akron Hook', function () {
      const tokenASymbol: string = 'waArbWETH';
      const tokenBSymbol: string = 'waArbUSDCn';

      const tokenAAmount: string = '100000000000000000';
      const tokenBAmount: string = '1000000';
      const nativeTokenAmount = '0';
      // Filter to known akronHook pool to make sure its picked up
      // https://balancer.fi/pools/arbitrum/v3/0xecb3a2622cc80629134b893f6e6ade4ebd0aeb7c
      const akronHookPool = '0xecb3a2622cc80629134b893f6e6ade4ebd0aeb7c';
      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
        nativeTokenAmount,
        false,
        [akronHookPool],
      );
    });

    describe('StableSurgeV2 Hook', function () {
      const tokenASymbol: string = 'USDai';
      const tokenBSymbol: string = 'waArbUSDT';

      const tokenAAmount: string = '1000000000000000000';
      const tokenBAmount: string = '1000000';
      const nativeTokenAmount = '0';
      // Filter to known pool with stableSurgeV2 hook to make sure its picked up
      // https://balancer.fi/pools/arbitrum/v3/0x8031a6f49e0610d8a71cdc8bb3d3266c1355e7e3
      const stableSurgeV2Pool = '0x8031a6f49e0610d8a71cdc8bb3d3266c1355e7e3';
      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
        nativeTokenAmount,
        false,
        [stableSurgeV2Pool],
      );
    });
  });

  describe('Base', () => {
    const network = Network.BASE;

    describe('FAILED_CASE', () => {
      const tokenASymbol: string = 'WETH';
      const tokenBSymbol: string = 'USDC';

      const tokenAAmount: string = '300000000000000';
      const tokenBAmount: string = '100000000';
      const nativeTokenAmount = '0';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
        nativeTokenAmount,
        false,
      );
    });

    describe('FAILED_CASE_2', () => {
      // price route - https://jsonblob.com/1359435988107190272
      // failed simulation - https://www.tdly.co/shared/simulation/b146f002-d110-41be-a5de-a52d6fdd0dca
      // pool used = 0x81a85b9ec797110f2ee665c119e8f28a2456d6f1
      const tokenASymbol: string = 'WETH';
      const tokenBSymbol: string = 'USDC';

      const tokenAAmount: string = '3000000000000000';
      const tokenBAmount: string = '100000000';
      const nativeTokenAmount = '0';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
        nativeTokenAmount,
        false,
        ['0x81a85b9ec797110f2ee665c119e8f28a2456d6f1'],
      );
    });

    describe('FAILED_CASE_3', () => {
      // price route - http://jsonblob.com/1366395544909570048
      // failed simulation - https://dashboard.tenderly.co/explorer/vnet/dd4e8b66-e7fc-4c78-91d2-437f96796c83/tx/0x98640401b2fe7e54bc91c3160381f3a632a42a32d19b9de6ca50035f21318c94
      // pool used = 0xaf5b7999f491c42c05b5a2ca80f1d200d617cc8c
      const tokenASymbol: string = 'WETH';
      const tokenBSymbol: string = 'USDC';

      const tokenAAmount: string = '3000000000000000';
      const tokenBAmount: string = '100000000';
      const nativeTokenAmount = '0';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
        nativeTokenAmount,
        false,
        ['0xaf5b7999f491c42c05b5a2ca80f1d200d617cc8c'],
      );
    });

    describe('Stable Path', () => {
      const tokenASymbol: string = 'wstETH';
      const tokenBSymbol: string = 'WETH';

      const tokenAAmount: string = '100000000000000';
      const tokenBAmount: string = '100000000000000';
      const nativeTokenAmount = '0';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
        nativeTokenAmount,
        false,
      );
    });

    describe('Boosted Path', () => {
      const tokenASymbol: string = 'sUSDS';
      const tokenBSymbol: string = 'smUSDC';

      const tokenAAmount: string = '10000000000000';
      const tokenBAmount: string = '10000000000000';
      const nativeTokenAmount = '0';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
        nativeTokenAmount,
        false,
      );
    });

    describe('StableSurge Hook', () => {
      const tokenASymbol: string = 'waBasGHO';
      const tokenBSymbol: string = 'waBasUSDC';

      const tokenAAmount: string = '100000000000000000';
      const tokenBAmount: string = '100000';
      const nativeTokenAmount = '0';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
        nativeTokenAmount,
        false,
      );
    });

    describe('Boosted Path', () => {
      const tokenASymbol: string = 'waBaswstETH';
      const tokenBSymbol: string = 'waBasWETH';

      const tokenAAmount: string = '10000000000000';
      const tokenBAmount: string = '10000000000000';
      const nativeTokenAmount = '0';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
        nativeTokenAmount,
        false,
      );
    });

    describe('reClamm Pool', function () {
      const tokenASymbol: string = 'WETH';
      const tokenBSymbol: string = 'USDC';

      const tokenAAmount: string = '100000000000000';
      const tokenBAmount: string = '1000000';
      const nativeTokenAmount = '0';
      // Filter to known reClamm pool to make sure its picked up
      // https://balancer.fi/pools/base/v3/0x97c4B3E63566D6Ece3c9BCE535EDc2CA52FC6d5B
      const reClammPool =
        '0x97c4B3E63566D6Ece3c9BCE535EDc2CA52FC6d5B'.toLowerCase();
      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
        nativeTokenAmount,
        false,
        [reClammPool],
      );
    });

    describe('Akron Hook', function () {
      const tokenASymbol: string = 'waBasWETH';
      const tokenBSymbol: string = 'waBasUSDC';

      const tokenAAmount: string = '1000000000000000000';
      const tokenBAmount: string = '1000000';
      const nativeTokenAmount = '0';
      // Filter to known akronHook pool to make sure its picked up
      // https://balancer.fi/pools/base/v3/0x4fbb7870dbe7a7ef4866a33c0eed73d395730dc0
      const akronHookPool = '0x4fbb7870dbe7a7ef4866a33c0eed73d395730dc0';
      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
        nativeTokenAmount,
        false,
        [akronHookPool],
      );
    });

    describe('quantAMM Pool', function () {
      const tokenASymbol: string = 'WETH';
      const tokenBSymbol: string = 'cbBTC';

      const tokenAAmount: string = '1000000000000000000';
      const tokenBAmount: string = '1000000';
      const nativeTokenAmount = '0';
      // Filter to known quantAMM pool to make sure its picked up
      // https://balancer.fi/pools/base/v3/0xb4161aea25bd6c5c8590ad50deb4ca752532f05d
      const quantAMMPool = '0xb4161aea25bd6c5c8590ad50deb4ca752532f05d';
      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
        nativeTokenAmount,
        false,
        [quantAMMPool],
      );
    });

    describe('StableSurgeV2 Hook', function () {
      const tokenASymbol: string = 'yoBTC';
      const tokenBSymbol: string = 'cbBTC';

      const tokenAAmount: string = '1000000';
      const tokenBAmount: string = '1000000';
      const nativeTokenAmount = '0';
      // Filter to known pool with stableSurgeV2 hook to make sure its picked up
      // https://balancer.fi/pools/base/v3/0xe5556b41256d7efb2f0a17011ef8ab507a352141
      const stableSurgeV2Pool = '0xe5556b41256d7efb2f0a17011ef8ab507a352141';
      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
        nativeTokenAmount,
        false,
        [stableSurgeV2Pool],
      );
    });
  });

  describe('Avalanche', () => {
    const network = Network.AVALANCHE;

    describe('Boosted Stable with StableSurge Hook', () => {
      // https://balancer.fi/pools/avalanche/v3/0x99a9a471dbe0dcc6855b4cd4bbabeccb1280f5e8
      const tokenASymbol: string = 'sAVAX';
      const tokenBSymbol: string = 'WAVAX';

      const tokenAAmount: string = '10000000000000000';
      const tokenBAmount: string = '10000000000000000';
      const nativeTokenAmount = '0';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
        nativeTokenAmount,
        false,
      );
    });

    describe('Boosted ECLP', () => {
      // https://balancer.fi/pools/avalanche/v3/0x58374fff35d1f3023bbfc646fb9ecd2b180ca0b0
      const tokenASymbol: string = 'USDC';
      const tokenBSymbol: string = 'WAVAX';

      const tokenAAmount: string = '1000000';
      const tokenBAmount: string = '10000000000000000';
      const nativeTokenAmount = '0';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
        nativeTokenAmount,
        false,
      );
    });
  });

  describe('Optimism', () => {
    const network = Network.OPTIMISM;

    describe('Boosted Stable with StableSurge Hook', () => {
      // https://balancer.fi/pools/optimism/v3/0x49e75c0df48ad09a0e20e8bbded07ee60dd8bc03
      const tokenASymbol: string = 'rETH';
      const tokenBSymbol: string = 'wstETH';

      const tokenAAmount: string = '10000000000000000';
      const tokenBAmount: string = '10000000000000000';
      const nativeTokenAmount = '0';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
        nativeTokenAmount,
        false,
      );
    });

    describe('Boosted Path', () => {
      // https://balancer.fi/pools/optimism/v3/0x870c0af8a1af0b58b4b0bd31ce4fe72864ae45be
      const tokenASymbol: string = 'rETH';
      const tokenBSymbol: string = 'waOptWETH';

      const tokenAAmount: string = '10000000000000000';
      const tokenBAmount: string = '10000000000000000';
      const nativeTokenAmount = '0';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
        nativeTokenAmount,
        false,
      );
    });
  });
});

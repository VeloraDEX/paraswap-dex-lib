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
  Canonical Tenderly E2E suite for the Range Pool connector (Stage 8).

  Range Pools run on a CUSTOM, non-canonical Balancer V3 Vault, so these pools
  are NOT indexed by Balancer's SOR — this connector is the only route source.
  Because they are low-TVL, trade sizes are kept small enough that the output
  stays under each pool's fact-balance cap (`factBalanceOut - ABSOLUTE_MIN`);
  a larger exact-out would revert on-chain.

  Both live pools are exercised:
    - ROME/USDT  (2-token, both 6-decimals)               0xaf03...4b36
    - the 8-token "TOP CRYPTO" pool via its WETH/USDT pair 0x67c0...2f29b
      (WETH 18d, USDT 6d)

  The WETH pair also drives native-ETH routing (needWrapNative ⇒ the executor
  wraps/unwraps and the Router only ever sees WETH).

  Runs against the Tenderly fork API — needs TENDERLY_TOKEN /
  TENDERLY_ACCOUNT_ID / TENDERLY_PROJECT and HTTP_PROVIDER_1 in `.env`.

  Run: `corepack pnpm exec jest src/dex/range-pool/range-pool-e2e.test.ts --forceExit`
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
) {
  const provider = new StaticJsonRpcProvider(
    generateConfig(network).privateHttpProvider,
    network,
  );
  const tokens = Tokens[network];
  const holders = Holders[network] ?? {};
  const nativeTokenSymbol = NativeTokenSymbols[network];

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
              );
            });
          });
        });
      }),
    );
  });
}

describe('RangePool E2E', () => {
  const dexKey = 'RangePool';
  const network = Network.MAINNET;

  // ROME/USDT 2-token pool (0xaf03...4b36). Both tokens 6-decimals.
  // 50 ROME ~= 48 USDT out; 20 USDT ~= 20 ROME out — well under the pool caps.
  describe('ROME/USDT', () => {
    testForNetwork(
      network,
      dexKey,
      'ROME',
      'USDT',
      '50000000', // 50 ROME (6d)
      '20000000', // 20 USDT (6d)
      '0',
      false,
    );
  });

  // 8-token "TOP CRYPTO" pool (0x67c0...2f29b) via its WETH/USDT pair.
  // tokenA = USDT so native-ETH routing exercises ETH<->USDT (ETH is wrapped to
  // WETH and swapped through the pool). 200 USDT ~= 0.11 WETH out; 0.1 WETH ~=
  // 168 USDT out; 0.1 ETH ~= 168 USDT out — all under the caps.
  describe('WETH/USDT (TOP CRYPTO)', () => {
    testForNetwork(
      network,
      dexKey,
      'USDT',
      'WETH',
      '200000000', // 200 USDT (6d)
      '100000000000000000', // 0.1 WETH (18d)
      '100000000000000000', // 0.1 ETH
      true,
    );
  });
});

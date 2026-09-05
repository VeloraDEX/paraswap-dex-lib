import dotenv from 'dotenv';
dotenv.config();

import { testE2E } from '../../../tests/utils-e2e';
import { Tokens } from '../../../tests/constants-e2e';
import { ContractMethod, Network, SwapSide } from '../../constants';
import { StaticJsonRpcProvider } from '@ethersproject/providers';
import { generateConfig } from '../../config';

/*
  Baseline e2e — full swaps on a forked node (needs TENDERLY_* env), exercising
  transaction building end to end. REPPO is the bToken, VIRTUAL the reserve, on Base.
*/

function testForNetwork(
  network: Network,
  dexKey: string,
  bTokenSymbol: string,
  reserveSymbol: string,
  bTokenAmount: string,
  reserveAmount: string,
  slippage?: number,
) {
  const provider = new StaticJsonRpcProvider(
    generateConfig(network).privateHttpProvider,
    network,
  );
  const tokens = Tokens[network];
  // testE2E ignores its senderAddress argument (funding comes from the
  // storage-slot overrides in token-storage-slots.json); any address works.
  const sender = tokens[reserveSymbol].address;

  const sideToContractMethods = new Map([
    [SwapSide.SELL, [ContractMethod.swapExactAmountIn]],
    [SwapSide.BUY, [ContractMethod.swapExactAmountOut]],
  ]);

  describe(`${network}`, () => {
    sideToContractMethods.forEach((contractMethods, side) =>
      describe(`${side}`, () => {
        contractMethods.forEach((contractMethod: ContractMethod) => {
          describe(`${contractMethod}`, () => {
            it(`${reserveSymbol} -> ${bTokenSymbol}`, async () => {
              await testE2E(
                tokens[reserveSymbol],
                tokens[bTokenSymbol],
                sender,
                side === SwapSide.SELL ? reserveAmount : bTokenAmount,
                side,
                dexKey,
                contractMethod,
                network,
                provider,
                undefined,
                undefined,
                undefined,
                slippage,
                2000,
              );
            });
            // BUY with the bToken as input (exact reserve out) is unsupported:
            // see resolvePool in baseline.ts.
            if (side === SwapSide.SELL) {
              it(`${bTokenSymbol} -> ${reserveSymbol}`, async () => {
                await testE2E(
                  tokens[bTokenSymbol],
                  tokens[reserveSymbol],
                  sender,
                  bTokenAmount,
                  side,
                  dexKey,
                  contractMethod,
                  network,
                  provider,
                  undefined,
                  undefined,
                  undefined,
                  slippage,
                  2000,
                );
              });
            }
          });
        });
      }),
    );
  });
}

describe('Baseline E2E', () => {
  const dexKey = 'Baseline';

  testForNetwork(
    Network.BASE,
    dexKey,
    'REPPO',
    'VIRTUAL',
    '1000000000000000000000', // 1000 REPPO
    '10000000000000000000', // 10 VIRTUAL
    1, // 1 bps slippage: local quotes are wei-exact, so ~zero headroom is needed
  );
});

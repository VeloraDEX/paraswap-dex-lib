import dotenv from 'dotenv';
dotenv.config();

import { testE2E } from '../../../tests/utils-e2e';
import { Tokens, Holders } from '../../../tests/constants-e2e';
import {
  Network,
  ContractMethod,
  SwapSide,
  NULL_ADDRESS,
} from '../../constants';
import { StaticJsonRpcProvider } from '@ethersproject/providers';
import { generateConfig } from '../../config';

jest.setTimeout(180_000);

// Exercise both supported token directions through the shared E2E harness.
function testForNetwork(
  network: Network,
  dexKey: string,
  tokenASymbol: string,
  tokenBSymbol: string,
  tokenAAmount: string,
  tokenBAmount: string,
  poolAddress: string,
) {
  const provider = new StaticJsonRpcProvider(
    generateConfig(network).privateHttpProvider,
    network,
  );
  const tokens = Tokens[network];
  const holders = Holders[network];
  // Keep routing on the verified pool for this network and token pair.
  const poolIdentifiers = { [dexKey]: [`${dexKey}_${poolAddress}`] };
  const sideToContractMethods = new Map([
    [SwapSide.SELL, [ContractMethod.swapExactAmountIn]],
  ]);

  describe(`${network}`, () => {
    sideToContractMethods.forEach((contractMethods, side) =>
      describe(`${side}`, () => {
        contractMethods.forEach((contractMethod: ContractMethod) => {
          describe(`${contractMethod}`, () => {
            it(`${tokenASymbol} -> ${tokenBSymbol}`, async () => {
              await testE2E(
                tokens[tokenASymbol],
                tokens[tokenBSymbol],
                holders[tokenASymbol] ?? NULL_ADDRESS,
                tokenAAmount,
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
                holders[tokenBSymbol] ?? NULL_ADDRESS,
                tokenBAmount,
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

describe('Stabull E2E', () => {
  const dexKey = 'Stabull';

  describe('Mainnet', () => {
    const network = Network.MAINNET;
    const tokenASymbol = 'NZDS';
    const tokenBSymbol = 'USDC';
    const tokenAAmount = '1000000';
    const tokenBAmount = '1000000';
    const poolAddress = '0xe37d763c7c4cdd9a8f085f7db70139a0843529f3';

    testForNetwork(
      network,
      dexKey,
      tokenASymbol,
      tokenBSymbol,
      tokenAAmount,
      tokenBAmount,
      poolAddress,
    );
  });

  describe('Polygon', () => {
    const network = Network.POLYGON;
    const tokenASymbol = 'BRZ';
    const tokenBSymbol = 'USDCn'; // Circle-issued USDC in the shared fixtures.
    const tokenAAmount = '1000000000000000000';
    const tokenBAmount = '1000000';
    const poolAddress = '0xce0abd182d2cf5844f2a0cb52cfcc55d4ff4fcba';

    testForNetwork(
      network,
      dexKey,
      tokenASymbol,
      tokenBSymbol,
      tokenAAmount,
      tokenBAmount,
      poolAddress,
    );
  });

  describe('Base', () => {
    const network = Network.BASE;
    const tokenASymbol = 'EURC';
    const tokenBSymbol = 'USDC';
    const tokenAAmount = '1000000';
    const tokenBAmount = '1000000';
    const poolAddress = '0x2a645d27efe5c8f5afc63856d2509ea20f81a0b2';

    testForNetwork(
      network,
      dexKey,
      tokenASymbol,
      tokenBSymbol,
      tokenAAmount,
      tokenBAmount,
      poolAddress,
    );
  });
});

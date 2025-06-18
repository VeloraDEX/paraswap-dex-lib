import dotenv from 'dotenv';
dotenv.config();

import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { checkConstantPoolPrices } from '../../../tests/utils';
import { Tokens } from '../../../tests/constants-e2e';
import { BI_POWS } from '../../bigint-constants';
import { MiroMigrator } from './miro-migrator';

const network = Network.OPTIMISM;

const PSPSymbol = 'testPSP';
const PSPToken = Tokens[network][PSPSymbol];

const XYZSymbol = 'testXYZ';
const XYZToken = Tokens[network][XYZSymbol];

const amounts = [0n, BI_POWS[18], 2000000000000000000n];

const dexKey = 'MiroMigrator';

describe('MiroMigrator', function () {
  it(`getPoolIdentifiers and getPricesVolume ${PSPSymbol} -> ${XYZSymbol} SELL`, async function () {
    const dexHelper = new DummyDexHelper(network);
    const blocknumber = await dexHelper.web3Provider.eth.getBlockNumber();
    const miroMigrator = new MiroMigrator(network, dexKey, dexHelper);

    const pools = await miroMigrator.getPoolIdentifiers(
      PSPToken,
      XYZToken,
      SwapSide.SELL,
      blocknumber,
    );
    console.log(`${PSPSymbol} <> ${XYZSymbol} Pool Identifiers: `, pools);

    expect(pools.length).toBeGreaterThan(0);

    const poolPrices = await miroMigrator.getPricesVolume(
      PSPToken,
      XYZToken,
      amounts,
      SwapSide.SELL,
      blocknumber,
      pools,
    );
    console.log(`${PSPSymbol} <> ${XYZSymbol} Pool Prices: `, poolPrices);

    expect(poolPrices).not.toBeNull();
    checkConstantPoolPrices(poolPrices!, amounts, dexKey);
  });

  it(`getPoolIdentifiers and getPricesVolume ${PSPSymbol} -> ${XYZSymbol} BUY`, async function () {
    const dexHelper = new DummyDexHelper(network);
    const blocknumber = await dexHelper.web3Provider.eth.getBlockNumber();
    const miroMigrator = new MiroMigrator(network, dexKey, dexHelper);

    const pools = await miroMigrator.getPoolIdentifiers(
      PSPToken,
      XYZToken,
      SwapSide.BUY,
      blocknumber,
    );
    console.log(`${PSPSymbol} <> ${XYZSymbol} Pool Identifiers: `, pools);

    expect(pools.length).toBeGreaterThan(0);

    const poolPrices = await miroMigrator.getPricesVolume(
      PSPToken,
      XYZToken,
      amounts,
      SwapSide.BUY,
      blocknumber,
      pools,
    );
    console.log(`${PSPSymbol} <> ${XYZSymbol} Pool Prices: `, poolPrices);

    expect(poolPrices).not.toBeNull();
    checkConstantPoolPrices(poolPrices!, amounts, dexKey);
  });
});

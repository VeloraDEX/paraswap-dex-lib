import dotenv from 'dotenv';
dotenv.config();

import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { dETH } from './dETH';
import { checkConstantPoolPrices } from '../../../tests/utils';
import { Tokens } from '../../../tests/constants-e2e';
import { BI_POWS } from '../../bigint-constants';

const network = Network.MAINNET;
const EthSymbol = 'ETH';
const EthToken = Tokens[network][EthSymbol];

const dETHSymbol = 'dETH';
const dETHToken = Tokens[network][dETHSymbol];

const amounts = [0n, BI_POWS[18], 2000000000000000000n];

const dexKey = 'dETH';

describe('Weth', function () {
  it('getPoolIdentifiers and getPricesVolume SELL', async function () {
    const dexHelper = new DummyDexHelper(network);
    const blocknumber = await dexHelper.web3Provider.eth.getBlockNumber();
    const deth = new dETH(network, dexKey, dexHelper);

    const pools = await deth.getPoolIdentifiers(EthToken, dETHToken);
    console.log(`${EthToken} <> ${dETHToken} Pool Identifiers: `, pools);

    expect(pools.length).toBeGreaterThan(0);

    const poolPrices = await deth.getPricesVolume(
      EthToken,
      dETHToken,
      amounts,
      SwapSide.SELL,
      blocknumber,
      pools,
    );
    console.log(`${EthToken} <> ${dETHToken} Pool Prices: `, poolPrices);

    expect(poolPrices).not.toBeNull();
    checkConstantPoolPrices(poolPrices!, amounts, dexKey);
  });
});

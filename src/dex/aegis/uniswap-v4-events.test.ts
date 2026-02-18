/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();
import { DummyDexHelper } from '../../dex-helper';
import { Network, SwapSide } from '../../constants';
import { Aegis } from './uniswap-v4';
import { Tokens } from '../../../tests/constants-e2e';
import { BI_POWS } from '../../bigint-constants';
import * as util from 'util';

describe('Aegis events tests', () => {
  const dexKey = 'Aegis';

  describe('Unichain', () => {
    const network = Network.UNICHAIN;
    const dexHelper = new DummyDexHelper(network);

    let blockNumber: number;
    let aegis: Aegis;

    describe('ETH -> WBTC', () => {
      const TokenASymbol = 'ETH';
      const TokenA = Tokens[network][TokenASymbol];

      const TokenBSymbol = 'WBTC';
      const TokenB = Tokens[network][TokenBSymbol];

      beforeEach(async () => {
        blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
        aegis = new Aegis(network, dexKey, dexHelper);
        await aegis.initializePricing(blockNumber);
      });

      it('ETH -> WBTC getPoolIdentifiers and getPricesVolume SELL', async () => {
        console.log('BLOCK: ', blockNumber);

        const amounts = [
          0n,
          1n * BI_POWS[18],
          2n * BI_POWS[18],
          3n * BI_POWS[18],
          4n * BI_POWS[18],
          5n * BI_POWS[18],
          6n * BI_POWS[18],
          7n * BI_POWS[18],
          8n * BI_POWS[18],
          9n * BI_POWS[18],
          10n * BI_POWS[18],
        ];

        const pools = await aegis.getPoolIdentifiers(
          TokenA,
          TokenB,
          SwapSide.SELL,
          blockNumber,
        );
        console.log(
          `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
          pools,
        );

        expect(pools.length).toBeGreaterThan(0);

        const poolPrices = await aegis.getPricesVolume(
          TokenA,
          TokenB,
          amounts,
          SwapSide.SELL,
          blockNumber,
          pools,
        );

        console.log(
          `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
          util.inspect(poolPrices, false, null, true),
        );

        expect(poolPrices).not.toBeNull();
      });
    });
  });
});

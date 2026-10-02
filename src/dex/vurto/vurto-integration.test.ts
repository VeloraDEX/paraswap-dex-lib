/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { Vurto } from './vurto';
import { checkPoolPrices } from '../../../tests/utils';
import { Tokens } from '../../../tests/constants-e2e';

/*
  README
  ======

  Vurto prices over HTTP, not from local pool state, so the usual
  "compare against an on-chain reader" test does not apply: there is no single
  pool to read. The equivalent guarantee here is that the price we publish is
  the price our settlement honours, and that is checked by the e2e test, which
  actually sends the transaction.

  What this file locks is the integration contract itself: the shape of what we
  return, the refusals we make on purpose, and the single settlement target that
  the whole integration rests on.

  These tests call the live public endpoint at https://swap.vurto.cc. No API key
  is needed. If that host is unreachable the pricing tests are skipped rather
  than failed, because a network outage on our side is not a defect in this
  repository.
*/

const dexKey = 'Vurto';
const network = Network.BASE;
const tokens = Tokens[network];
const srcTokenSymbol = 'USDC';
const destTokenSymbol = 'WETH';

/* Igualmente espaçados, e isso não é estética: `checkPoolPrices` compara
   DIFERENÇAS brutas entre preços consecutivos, não preço por unidade. Com
   passos de larguras diferentes, uma curva perfeitamente monotônica reprova,
   porque o passo mais largo produz diferença maior. */
const amounts = [
  0n,
  1n * BI_POWS[6],
  2n * BI_POWS[6],
  3n * BI_POWS[6],
  4n * BI_POWS[6],
  5n * BI_POWS[6],
];

const dexHelper = new DummyDexHelper(network);
let vurto: Vurto;
let online = false;

beforeAll(async () => {
  vurto = new Vurto(network, dexKey, dexHelper);
  await vurto.initializePricing(await dexHelper.provider.getBlockNumber());
  online = await dexHelper.httpRequest
    .get(`https://swap.vurto.cc/gateway/v1/health`, 8000)
    .then(() => true)
    .catch(() => false);
  if (!online) console.warn('vurto gateway unreachable, pricing tests skipped');
});

describe(`${dexKey} integration contract`, () => {
  it('exposes exactly one pool identifier, the router for this chain', async () => {
    const ids = await vurto.getPoolIdentifiers(
      tokens[srcTokenSymbol],
      tokens[destTokenSymbol],
      SwapSide.SELL,
      0,
    );
    expect(ids).toHaveLength(1);
    expect(ids[0]).toBe(
      `vurto_0x15cb65b1c6026334a079e48241d6c8fa79df7784`.toLowerCase(),
    );
  });

  it('refuses BUY instead of inverting a quote it cannot settle', async () => {
    const prices = await vurto.getPricesVolume(
      tokens[srcTokenSymbol],
      tokens[destTokenSymbol],
      amounts,
      SwapSide.BUY,
      0,
    );
    expect(prices).toBeNull();
  });

  it('honours limitPools', async () => {
    const prices = await vurto.getPricesVolume(
      tokens[srcTokenSymbol],
      tokens[destTokenSymbol],
      amounts,
      SwapSide.SELL,
      0,
      ['SomeOtherDex_0xdead'],
    );
    expect(prices).toBeNull();
  });

  it('reports no top pools, because it owns none', async () => {
    const pools = await vurto.getTopPoolsForToken(
      tokens[srcTokenSymbol].address,
      10,
    );
    expect(pools).toEqual([]);
  });

  /* Antes isto lancava um erro nosso. Agora o caminho certo e outro, e a
     mudanca veio de revisao no PR: `getDexParam` roda o preprocess sozinho
     quando o chamador nao rodou. Sem contexto para rodar, o erro tem que ser o
     TIPADO desta base, nao um `Error` generico nosso, porque e ele que permite
     atribuir uma falha de montagem a esta fonte. */
  it('sem cotacao e sem contexto, falha com o erro tipado do preprocess', async () => {
    const erro = await vurto.getDexParam(
      tokens[srcTokenSymbol].address,
      tokens[destTokenSymbol].address,
      '1000000',
      '0',
      '0x0000000000000000000000000000000000000001',
      {
        exchange: '0x15cb65b1c6026334a079e48241d6c8fa79df7784',
        calldata: '',
        value: '0',
        venue: 'uniswap',
        validUntil: 0,
      },
      SwapSide.SELL,
      '0x0000000000000000000000000000000000000002',
    ).then(() => null, (e: any) => e);
    expect(erro).not.toBeNull();
    expect(erro.isGetDexParamPreProcessError).toBe(true);
    expect(String(erro.message)).toMatch(/MISSING_CONTEXT/);
  });

  it('a cotacao NAO carrega calldata, que so nasce na montagem', async () => {
    if (!online) return;
    const prices = await vurto.getPricesVolume(
      tokens[srcTokenSymbol], tokens[destTokenSymbol], amounts, SwapSide.SELL, 0);
    if (!prices) return;
    // Guardar calldata na cotacao fazia a montagem usar o tamanho errado.
    expect(prices[0].data.calldata).toBe('');
  });

});

describe(`${dexKey} pricing against the live surface`, () => {
  it('prices SELL and the prices grow with the amount', async () => {
    if (!online) return;
    const prices = await vurto.getPricesVolume(
      tokens[srcTokenSymbol],
      tokens[destTokenSymbol],
      amounts,
      SwapSide.SELL,
      0,
    );
    if (!prices) {
      console.warn('no route for this pair right now, nothing to assert');
      return;
    }
    checkPoolPrices(prices, amounts, SwapSide.SELL, dexKey);

    const [p] = prices;
    expect(p.exchange).toBe(dexKey);
    expect(p.prices[0]).toBe(0n);
    // Mais entrada nunca pode dar menos saida na mesma foto do mercado.
    for (let i = 2; i < p.prices.length; i += 1) {
      if (p.prices[i] > 0n && p.prices[i - 1] > 0n) {
        expect(p.prices[i]).toBeGreaterThan(p.prices[i - 1]);
      }
    }
  });

  it('settles through the router and nothing else', async () => {
    if (!online) return;
    const prices = await vurto.getPricesVolume(
      tokens[srcTokenSymbol],
      tokens[destTokenSymbol],
      amounts,
      SwapSide.SELL,
      0,
    );
    if (!prices) return;
    const [p] = prices;
    expect(p.data.exchange.toLowerCase()).toBe(
      '0x15cb65b1c6026334a079e48241d6c8fa79df7784',
    );
    expect(p.targetExchange?.toLowerCase()).toBe(p.data.exchange.toLowerCase());
    expect(p.poolAddresses).toEqual([p.data.exchange]);
  });
});

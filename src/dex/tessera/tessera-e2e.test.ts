import { testPriceRoute } from '../../../tests/utils-e2e';
import { OptimalRate } from '@paraswap/core';
import { ETHER_ADDRESS, Network, SwapSide } from '../../constants';
import { Tokens } from '../../../tests/constants-e2e';
import { DummyDexHelper } from '../../dex-helper/index';
import { DexAdapterService } from '..';
import {
  GenericSwapTransactionBuilder,
  normaliseRemoteDexExchangeParam,
} from '../../generic-swap-transaction-builder';
import { Tessera } from './tessera';

const TESSERA_REMOTE_BASE_URL = 'http://api.example.paraswap.io';
const TESSERA_REMOTE_DEX_KEY = 'tessera';
const PARITY_HTTP_TIMEOUT_MS = 10_000;

async function expectTesseraEncodingMatches(route: OptimalRate) {
  const dexHelper = new DummyDexHelper(route.network);
  const dexAdapterService = new DexAdapterService(dexHelper, route.network);
  const tessera = new Tessera(dexHelper);
  const builder = new GenericSwapTransactionBuilder(dexAdapterService);

  const executorAddress = builder.getExecutionContractAddress(route);
  const swap = route.bestRoute[0].swaps[0];
  const se = swap.swapExchanges[0];

  // minMaxAmount value doesn't matter for encoding parity as long as both
  // calls see the same one — pick the value `_build()` would choose at the
  // upper-bound slippage edge.
  const minMaxAmount = route.side === SwapSide.SELL ? '1' : route.srcAmount;

  const callParams = builder.getDexCallsParams(
    route,
    0,
    swap,
    0,
    se,
    minMaxAmount,
    tessera.needWrapNative,
    executorAddress,
  );

  // Mirror `buildCalls`: BUY uses the per-leg `se.srcAmount`, SELL uses the
  // (possibly slippage-adjusted) normalized srcAmount.
  const srcAmountForCall =
    route.side === SwapSide.BUY ? se.srcAmount : callParams.srcAmount;

  const localParam = tessera.getDexParam(
    callParams.srcToken,
    callParams.destToken,
    srcAmountForCall,
    callParams.destAmount,
    callParams.recipient,
    null,
    route.side,
  );

  const url = `${TESSERA_REMOTE_BASE_URL}/api/v1/dexs/${route.network}/${TESSERA_REMOTE_DEX_KEY}/dex-param`;
  const remoteRaw = await dexHelper.httpRequest.post<unknown>(
    url,
    {
      srcToken: callParams.srcToken,
      destToken: callParams.destToken,
      srcAmount: srcAmountForCall,
      destAmount: callParams.destAmount,
      recipient: callParams.recipient,
      executorAddress,
      side: route.side,
      data: null,
    },
    PARITY_HTTP_TIMEOUT_MS,
  );
  const remoteParam = normaliseRemoteDexExchangeParam(remoteRaw);

  // Resolve any function-typed `needWrapNative` on the local side. Tessera
  // uses a plain bool today, but the interface allows a function.
  if (typeof localParam.needWrapNative === 'function') {
    localParam.needWrapNative = localParam.needWrapNative(route, swap, se);
  }

  expect(remoteParam).toEqual(localParam);
}

function buildTesseraRoute(params: {
  network: number;
  blockNumber: number;
  srcToken: string;
  srcDecimals: number;
  srcAmount: string;
  destToken: string;
  destDecimals: number;
  destAmount: string;
  side?: 'SELL' | 'BUY';
}): OptimalRate {
  const side = params.side ?? 'SELL';
  return {
    blockNumber: params.blockNumber,
    network: params.network,
    srcToken: params.srcToken,
    srcDecimals: params.srcDecimals,
    srcAmount: params.srcAmount,
    destToken: params.destToken,
    destDecimals: params.destDecimals,
    destAmount: params.destAmount,
    bestRoute: [
      {
        percent: 100,
        swaps: [
          {
            srcToken: params.srcToken,
            srcDecimals: params.srcDecimals,
            destToken: params.destToken,
            destDecimals: params.destDecimals,
            swapExchanges: [
              {
                exchange: 'Tessera',
                srcAmount: params.srcAmount,
                destAmount: params.destAmount,
                percent: 100,
                poolAddresses: [],
                data: null,
              },
            ],
          },
        ],
      },
    ],
    gasCostUSD: '0',
    gasCost: '150000',
    others: [],
    side,
    version: '6.2',
    contractAddress: '0x6a000f20005980200259b80c5102003040001068',
    tokenTransferProxy: '0x6a000f20005980200259b80c5102003040001068',
    contractMethod:
      side === 'SELL' ? 'swapExactAmountIn' : 'swapExactAmountOut',
    partnerFee: 0,
    srcUSD: '0',
    destUSD: '0',
    partner: 'anon',
    maxImpactReached: false,
    hmac: '',
  } as unknown as OptimalRate;
}

describe('Tessera E2E', () => {
  describe('Base', () => {
    const baseWeth = Tokens[Network.BASE].WETH;
    const baseUsdc = Tokens[Network.BASE].USDC;

    const baseUsdcShared = {
      network: Network.BASE,
      blockNumber: 45600823,
      srcToken: baseUsdc.address,
      srcDecimals: baseUsdc.decimals,
      srcAmount: '1000000',
      destDecimals: baseWeth.decimals,
      destAmount: '420526831788390',
    };

    it('USDC → WETH', async () => {
      const route = buildTesseraRoute({
        ...baseUsdcShared,
        destToken: baseWeth.address,
      });
      await testPriceRoute(route);
      await expectTesseraEncodingMatches(route);
    });

    it('USDC → ETH (unwraps WETH)', async () => {
      const route = buildTesseraRoute({
        ...baseUsdcShared,
        destToken: ETHER_ADDRESS,
      });
      await testPriceRoute(route);
      await expectTesseraEncodingMatches(route);
    });

    const baseWethShared = {
      network: Network.BASE,
      blockNumber: 45600823,
      srcDecimals: baseWeth.decimals,
      srcAmount: '1000000000000000000',
      destToken: baseUsdc.address,
      destDecimals: baseUsdc.decimals,
      destAmount: '2377679443',
    };

    it('WETH → USDC', async () => {
      const route = buildTesseraRoute({
        ...baseWethShared,
        srcToken: baseWeth.address,
      });
      await testPriceRoute(route);
      await expectTesseraEncodingMatches(route);
    });

    it('ETH → USDC (wraps to WETH)', async () => {
      const route = buildTesseraRoute({
        ...baseWethShared,
        srcToken: ETHER_ADDRESS,
      });
      await testPriceRoute(route);
      await expectTesseraEncodingMatches(route);
    });

    it('USDC → WETH (BUY)', async () => {
      const route = buildTesseraRoute({
        ...baseUsdcShared,
        destToken: baseWeth.address,
        side: 'BUY',
      });
      await testPriceRoute(route);
      await expectTesseraEncodingMatches(route);
    });

    it('USDC → ETH (BUY, unwraps WETH)', async () => {
      const route = buildTesseraRoute({
        ...baseUsdcShared,
        destToken: ETHER_ADDRESS,
        side: 'BUY',
      });
      await testPriceRoute(route);
      await expectTesseraEncodingMatches(route);
    });
  });

  describe('BSC', () => {
    const bscWbnb = Tokens[Network.BSC].WBNB;
    const bscUsdt = Tokens[Network.BSC].USDT;

    const bscWbnbShared = {
      network: Network.BSC,
      blockNumber: 96572572,
      srcDecimals: bscWbnb.decimals,
      srcAmount: '1000000000000000000',
      destToken: bscUsdt.address,
      destDecimals: bscUsdt.decimals,
      destAmount: '631755922471100996711',
    };

    it('WBNB → USDT', async () => {
      const route = buildTesseraRoute({
        ...bscWbnbShared,
        srcToken: bscWbnb.address,
      });
      await testPriceRoute(route);
      await expectTesseraEncodingMatches(route);
    });

    it('BNB → USDT (wraps to WBNB)', async () => {
      const route = buildTesseraRoute({
        ...bscWbnbShared,
        srcToken: ETHER_ADDRESS,
      });
      await testPriceRoute(route);
      await expectTesseraEncodingMatches(route);
    });

    const bscUsdtShared = {
      network: Network.BSC,
      blockNumber: 96572572,
      srcToken: bscUsdt.address,
      srcDecimals: bscUsdt.decimals,
      srcAmount: '1000000000000000000',
      destDecimals: bscWbnb.decimals,
      destAmount: '1582521639071061',
    };

    it('USDT → WBNB', async () => {
      const route = buildTesseraRoute({
        ...bscUsdtShared,
        destToken: bscWbnb.address,
      });
      await testPriceRoute(route);
      await expectTesseraEncodingMatches(route);
    });

    it('USDT → BNB (unwraps WBNB)', async () => {
      const route = buildTesseraRoute({
        ...bscUsdtShared,
        destToken: ETHER_ADDRESS,
      });
      await testPriceRoute(route);
      await expectTesseraEncodingMatches(route);
    });

    it('WBNB → USDT (BUY)', async () => {
      const route = buildTesseraRoute({
        ...bscWbnbShared,
        srcToken: bscWbnb.address,
        side: 'BUY',
      });
      await testPriceRoute(route);
      await expectTesseraEncodingMatches(route);
    });

    it('BNB → USDT (BUY, wraps to WBNB)', async () => {
      const route = buildTesseraRoute({
        ...bscWbnbShared,
        srcToken: ETHER_ADDRESS,
        side: 'BUY',
      });
      await testPriceRoute(route);
      await expectTesseraEncodingMatches(route);
    });
  });
});

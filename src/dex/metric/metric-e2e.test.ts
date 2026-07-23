import { testPriceRoute } from '../../../tests/utils-e2e';
import { OptimalRate } from '@paraswap/core';
import { ETHER_ADDRESS, SwapSide } from '../../constants';
import { DummyDexHelper } from '../../dex-helper/index';
import { DexAdapterService } from '..';
import {
  GenericSwapTransactionBuilder,
  normaliseRemoteDexExchangeParam,
} from '../../generic-swap-transaction-builder';
import { Metric } from './metric';

const METRIC_REMOTE_BASE_URL = 'http://api.example.paraswap.io';
const METRIC_REMOTE_DEX_KEY = 'metric';
const PARITY_HTTP_TIMEOUT_MS = 10_000;

async function expectMetricEncodingMatches(route: OptimalRate) {
  const dexHelper = new DummyDexHelper(route.network);
  const dexAdapterService = new DexAdapterService(dexHelper, route.network);
  const metric = new Metric(dexHelper);
  const builder = new GenericSwapTransactionBuilder(dexAdapterService);

  const executorAddress = builder.getExecutionContractAddress(route);
  const swap = route.bestRoute[0].swaps[0];
  const se = swap.swapExchanges[0];

  // minMaxAmount value doesn't matter for encoding parity as long as both
  // calls see the same one.
  const minMaxAmount = route.side === SwapSide.SELL ? '1' : route.srcAmount;

  const callParams = builder.getDexCallsParams(
    route,
    0,
    swap,
    0,
    se,
    minMaxAmount,
    metric.needWrapNative,
    executorAddress,
  );

  // Mirror `buildCalls`: BUY uses the per-leg `se.srcAmount`, SELL uses the
  // (possibly slippage-adjusted) normalized srcAmount.
  const srcAmountForCall =
    route.side === SwapSide.BUY ? se.srcAmount : callParams.srcAmount;

  const localParam = metric.getDexParam(
    callParams.srcToken,
    callParams.destToken,
    srcAmountForCall,
    callParams.destAmount,
    callParams.recipient,
    se.data,
    route.side,
  );

  const url = `${METRIC_REMOTE_BASE_URL}/api/v1/dexs/${route.network}/${METRIC_REMOTE_DEX_KEY}/dex-param`;
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
      data: se.data,
    },
    PARITY_HTTP_TIMEOUT_MS,
  );
  const remoteParam = normaliseRemoteDexExchangeParam(remoteRaw);

  // Resolve any function-typed `needWrapNative` on the local side. Metric
  // uses a plain bool today, but the interface allows a function.
  if (typeof localParam.needWrapNative === 'function') {
    localParam.needWrapNative = localParam.needWrapNative(route, swap, se);
  }

  expect(remoteParam).toEqual(localParam);
}

function buildMetricRoute(params: {
  network: number;
  blockNumber: number;
  srcToken: string;
  srcDecimals: number;
  srcAmount: string;
  destToken: string;
  destDecimals: number;
  destAmount: string;
  pool: string;
  zeroForOne: boolean;
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
                exchange: 'Metric',
                srcAmount: params.srcAmount,
                destAmount: params.destAmount,
                percent: 100,
                poolAddresses: [params.pool],
                data: {
                  pool: params.pool,
                  zeroForOne: params.zeroForOne,
                },
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

const BASE_WETH = '0x4200000000000000000000000000000000000006';
const BASE_CBBTC = '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf';
const BASE_USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';

describe('Metric E2E', () => {
  describe('Base', () => {
    // Base tx 0x89b1cd91b29f5bea9a8fa0fc2440407d4e9dedbf90184e0409bcd48cbfd6173c
    // 6 WETH → ~0.186 cbBTC (zeroForOne=true)
    const baseCbBtcShared = {
      network: 8453,
      blockNumber: 44614811,
      srcDecimals: 18,
      srcAmount: '6000000000000000000',
      destToken: BASE_CBBTC,
      destDecimals: 8,
      destAmount: '18582243',
      pool: '0x1300cf8460fb60c8112febe63ada84a8dd894d8a',
      zeroForOne: true,
    };

    it('WETH → cbBTC', async () => {
      const route = buildMetricRoute({
        ...baseCbBtcShared,
        srcToken: BASE_WETH,
      });
      await testPriceRoute(route);
      await expectMetricEncodingMatches(route);
    });

    it('ETH → cbBTC (wraps to WETH)', async () => {
      const route = buildMetricRoute({
        ...baseCbBtcShared,
        srcToken: ETHER_ADDRESS,
      });
      await testPriceRoute(route);
      await expectMetricEncodingMatches(route);
    });

    // Base tx 0xc49fd6804e1d0b38324a4146edfcdd2cca0be71c328952e2a7a6aeff4cf969ac
    // 5 WETH → ~11,029 USDC (zeroForOne=true)
    const baseUsdcShared = {
      network: 8453,
      blockNumber: 44601742,
      srcDecimals: 18,
      srcAmount: '5000000000000000000',
      destToken: BASE_USDC,
      destDecimals: 6,
      destAmount: '11029116131',
      pool: '0xa6929e903c42a79394f09365f59e916cb0accfd9',
      zeroForOne: true,
    };

    it('WETH → USDC', async () => {
      const route = buildMetricRoute({
        ...baseUsdcShared,
        srcToken: BASE_WETH,
      });
      await testPriceRoute(route);
      await expectMetricEncodingMatches(route);
    });

    it('ETH → USDC (wraps to WETH)', async () => {
      const route = buildMetricRoute({
        ...baseUsdcShared,
        srcToken: ETHER_ADDRESS,
      });
      await testPriceRoute(route);
      await expectMetricEncodingMatches(route);
    });

    // ~5.006 USDC → ~0.00223 WETH (zeroForOne=false)
    const baseUsdcReverseShared = {
      network: 8453,
      blockNumber: 45353456,
      srcToken: BASE_USDC,
      srcDecimals: 6,
      srcAmount: '5006456',
      destDecimals: 18,
      destAmount: '2232395713582392',
      pool: '0xa6929e903c42a79394f09365f59e916cb0accfd9',
      zeroForOne: false,
    };

    it('USDC → WETH', async () => {
      const route = buildMetricRoute({
        ...baseUsdcReverseShared,
        destToken: BASE_WETH,
      });
      await testPriceRoute(route);
      await expectMetricEncodingMatches(route);
    });

    it('USDC → ETH (unwraps WETH)', async () => {
      const route = buildMetricRoute({
        ...baseUsdcReverseShared,
        destToken: ETHER_ADDRESS,
      });
      await testPriceRoute(route);
      await expectMetricEncodingMatches(route);
    });

    it('USDC → WETH (BUY)', async () => {
      const route = buildMetricRoute({
        ...baseUsdcReverseShared,
        destToken: BASE_WETH,
        side: 'BUY',
      });
      await testPriceRoute(route);
      await expectMetricEncodingMatches(route);
    });

    it('USDC → ETH (BUY, unwraps WETH)', async () => {
      const route = buildMetricRoute({
        ...baseUsdcReverseShared,
        destToken: ETHER_ADDRESS,
        side: 'BUY',
      });
      await testPriceRoute(route);
      await expectMetricEncodingMatches(route);
    });
  });
});

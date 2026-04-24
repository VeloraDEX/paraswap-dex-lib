import { testPriceRoute } from '../../../tests/utils-e2e';
import { OptimalRate } from '@paraswap/core';
import { ETHER_ADDRESS } from '../../constants';

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
}): OptimalRate {
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
    side: 'SELL',
    version: '6.2',
    contractAddress: '0x6a000f20005980200259b80c5102003040001068',
    tokenTransferProxy: '0x6a000f20005980200259b80c5102003040001068',
    contractMethod: 'swapExactAmountIn',
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
    });

    it('ETH → cbBTC (wraps to WETH)', async () => {
      const route = buildMetricRoute({
        ...baseCbBtcShared,
        srcToken: ETHER_ADDRESS,
      });
      await testPriceRoute(route);
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
    });

    it('ETH → USDC (wraps to WETH)', async () => {
      const route = buildMetricRoute({
        ...baseUsdcShared,
        srcToken: ETHER_ADDRESS,
      });
      await testPriceRoute(route);
    });

    // Base tx 0x9e623c0126df14b0ed63d5c2631ccff788873103d3c8d01ddda230beda761e10
    // 1,250 USDC → ~0.572 WETH (zeroForOne=false)
    const baseUsdcReverseShared = {
      network: 8453,
      blockNumber: 44495533,
      srcToken: BASE_USDC,
      srcDecimals: 6,
      srcAmount: '1250000000',
      destDecimals: 18,
      destAmount: '572250811824233202',
      pool: '0xa6929e903c42a79394f09365f59e916cb0accfd9',
      zeroForOne: false,
    };

    it('USDC → WETH', async () => {
      const route = buildMetricRoute({
        ...baseUsdcReverseShared,
        destToken: BASE_WETH,
      });
      await testPriceRoute(route);
    });

    it('USDC → ETH (unwraps WETH)', async () => {
      const route = buildMetricRoute({
        ...baseUsdcReverseShared,
        destToken: ETHER_ADDRESS,
      });
      await testPriceRoute(route);
    });
  });
});

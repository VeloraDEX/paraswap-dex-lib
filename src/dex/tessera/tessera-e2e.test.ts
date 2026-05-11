import { testPriceRoute } from '../../../tests/utils-e2e';
import { OptimalRate } from '@paraswap/core';
import { ETHER_ADDRESS, Network } from '../../constants';
import { Tokens } from '../../../tests/constants-e2e';

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
    });

    it('USDC → ETH (unwraps WETH)', async () => {
      const route = buildTesseraRoute({
        ...baseUsdcShared,
        destToken: ETHER_ADDRESS,
      });
      await testPriceRoute(route);
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
    });

    it('ETH → USDC (wraps to WETH)', async () => {
      const route = buildTesseraRoute({
        ...baseWethShared,
        srcToken: ETHER_ADDRESS,
      });
      await testPriceRoute(route);
    });

    it('USDC → WETH (BUY)', async () => {
      const route = buildTesseraRoute({
        ...baseUsdcShared,
        destToken: baseWeth.address,
        side: 'BUY',
      });
      await testPriceRoute(route);
    });

    it('USDC → ETH (BUY, unwraps WETH)', async () => {
      const route = buildTesseraRoute({
        ...baseUsdcShared,
        destToken: ETHER_ADDRESS,
        side: 'BUY',
      });
      await testPriceRoute(route);
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
    });

    it('BNB → USDT (wraps to WBNB)', async () => {
      const route = buildTesseraRoute({
        ...bscWbnbShared,
        srcToken: ETHER_ADDRESS,
      });
      await testPriceRoute(route);
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
    });

    it('USDT → BNB (unwraps WBNB)', async () => {
      const route = buildTesseraRoute({
        ...bscUsdtShared,
        destToken: ETHER_ADDRESS,
      });
      await testPriceRoute(route);
    });

    it('WBNB → USDT (BUY)', async () => {
      const route = buildTesseraRoute({
        ...bscWbnbShared,
        srcToken: bscWbnb.address,
        side: 'BUY',
      });
      await testPriceRoute(route);
    });

    it('BNB → USDT (BUY, wraps to WBNB)', async () => {
      const route = buildTesseraRoute({
        ...bscWbnbShared,
        srcToken: ETHER_ADDRESS,
        side: 'BUY',
      });
      await testPriceRoute(route);
    });
  });
});

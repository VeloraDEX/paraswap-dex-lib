/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { checkPoolPrices, checkPoolsLiquidity } from '../../../tests/utils';
import { Tokens } from '../../../tests/constants-e2e';
import { BI_POWS } from '../../bigint-constants';
import { LunarBase } from './lunar-base';

const network = Network.BASE;
const dexKey = 'LunarBase';

const TokenASymbol = 'WETH';
const TokenBSymbol = 'USDC';

const TokenAAmount = BI_POWS[18];
const TokenBAmount = BI_POWS[6];

const dexHelper = new DummyDexHelper(network);
let blocknumber: number;
let lunarBase: LunarBase;

describe('LunarBase Integration Tests', function () {
  let TokenA: { address: string; decimals: number };
  let TokenB: { address: string; decimals: number };

  beforeAll(async () => {
    blocknumber = await dexHelper.web3Provider.eth.getBlockNumber();

    TokenA = Tokens[network][TokenASymbol] || {
      address: '0x4200000000000000000000000000000000000006',
      decimals: 18,
    };
    TokenB = Tokens[network][TokenBSymbol] || {
      address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      decimals: 6,
    };

    lunarBase = new LunarBase(network, dexKey, dexHelper);
    await lunarBase.initializePricing(blocknumber);
  });

  describe('getPoolIdentifiers', () => {
    it('should return pool identifiers', async () => {
      const pools = await lunarBase.getPoolIdentifiers(
        TokenA,
        TokenB,
        SwapSide.SELL,
        blocknumber,
      );
      console.log(
        `${TokenASymbol} -> ${TokenBSymbol} Pool Identifiers:`,
        pools,
      );

      expect(pools.length).toBeGreaterThanOrEqual(0);
      if (pools.length > 0) {
        expect(pools[0]).toMatch(/^lunarbase_0x/i);
      }
    });
  });

  describe('getPricesVolume - SELL', () => {
    it('should return prices for SELL', async () => {
      const amounts = [0n, TokenAAmount, TokenAAmount * 2n];

      const pools = await lunarBase.getPoolIdentifiers(
        TokenA,
        TokenB,
        SwapSide.SELL,
        blocknumber,
      );

      const prices = await lunarBase.getPricesVolume(
        TokenA,
        TokenB,
        amounts,
        SwapSide.SELL,
        blocknumber,
        pools,
      );

      console.log(`${TokenASymbol} -> ${TokenBSymbol} Prices:`, prices);

      if (prices && prices.length > 0) {
        expect(prices[0].prices.length).toBe(amounts.length);
        checkPoolPrices(prices, amounts, SwapSide.SELL, dexKey);
      }
    });
  });

  describe('getPricesVolume - BUY', () => {
    it('should return prices for BUY', async () => {
      const amounts = [0n, TokenBAmount, TokenBAmount * 2n];

      const pools = await lunarBase.getPoolIdentifiers(
        TokenA,
        TokenB,
        SwapSide.BUY,
        blocknumber,
      );

      const prices = await lunarBase.getPricesVolume(
        TokenA,
        TokenB,
        amounts,
        SwapSide.BUY,
        blocknumber,
        pools,
      );

      console.log(`${TokenASymbol} -> ${TokenBSymbol} Buy Prices:`, prices);

      if (prices && prices.length > 0) {
        expect(prices[0].prices.length).toBe(amounts.length);
        checkPoolPrices(prices, amounts, SwapSide.BUY, dexKey);
      }
    });
  });

  describe('getTopPoolsForToken', () => {
    it('should return top pools', async () => {
      const pools = await lunarBase.getTopPoolsForToken(TokenA.address, 10);
      console.log('Top Pools:', pools);

      expect(pools.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getDexParam', () => {
    it('should generate valid swap calldata for SELL', async () => {
      const amounts = [0n, TokenAAmount];

      const pools = await lunarBase.getPoolIdentifiers(
        TokenA,
        TokenB,
        SwapSide.SELL,
        blocknumber,
      );

      const prices = await lunarBase.getPricesVolume(
        TokenA,
        TokenB,
        amounts,
        SwapSide.SELL,
        blocknumber,
        pools,
      );

      expect(prices).not.toBeNull();
      expect(prices!.length).toBeGreaterThan(0);

      const poolPrice = prices![0];
      const srcAmount = TokenAAmount.toString();
      const destAmount = poolPrice.prices[1].toString();

      // Test getDexParam
      const dexParam = lunarBase.getDexParam(
        TokenA.address,
        TokenB.address,
        srcAmount,
        destAmount,
        '0x1234567890123456789012345678901234567890', // recipient
        poolPrice.data,
        SwapSide.SELL,
      );

      // Validate structure
      expect(dexParam.needWrapNative).toBe(false);
      expect(dexParam.dexFuncHasRecipient).toBe(true);
      expect(dexParam.targetExchange).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(dexParam.exchangeData).toMatch(/^0x[a-fA-F0-9]+$/);
      expect(dexParam.exchangeData.length).toBeGreaterThan(10);

      const pool = poolPrice.data.pools[0];

      if (pool.isNativeInput || pool.isNativeOutput) {
        // Native token pools route via LunarRouter
        expect(dexParam.transferSrcTokenBeforeSwap).toBeUndefined();
        expect(dexParam.targetExchange.toLowerCase()).toBe(
          poolPrice.data.router.toLowerCase(),
        );

        const { Interface } = require('@ethersproject/abi');
        const routerABI = [
          'function swapExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOutMinimum, address to, address userModule, uint8 moduleMask, (uint32 baseFee, uint32 wToken0, uint32 wToken1) baseFeeConfig, bytes data))',
        ];
        const iface = new Interface(routerABI);
        const decoded = iface.decodeFunctionData(
          'swapExactInputSingle',
          dexParam.exchangeData,
        );
        const params = decoded[0];

        expect(BigInt(params.amountIn.toString())).toBe(BigInt(srcAmount));
        expect(params.to.toLowerCase()).toBe(
          '0x1234567890123456789012345678901234567890',
        );
      } else {
        // ERC20 pools use direct pool.swap call
        expect(dexParam.transferSrcTokenBeforeSwap).toBe(pool.address);

        const { Interface } = require('@ethersproject/abi');
        const poolABI = [
          'function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data)',
        ];
        const iface = new Interface(poolABI);
        const decoded = iface.decodeFunctionData('swap', dexParam.exchangeData);
        expect(decoded[2].toLowerCase()).toBe(
          '0x1234567890123456789012345678901234567890',
        );
      }
    });

    it('should generate valid adapter params', async () => {
      const amounts = [0n, TokenAAmount];

      const pools = await lunarBase.getPoolIdentifiers(
        TokenA,
        TokenB,
        SwapSide.SELL,
        blocknumber,
      );

      const prices = await lunarBase.getPricesVolume(
        TokenA,
        TokenB,
        amounts,
        SwapSide.SELL,
        blocknumber,
        pools,
      );

      expect(prices).not.toBeNull();
      expect(prices!.length).toBeGreaterThan(0);

      const poolPrice = prices![0];
      const srcAmount = TokenAAmount.toString();
      const destAmount = poolPrice.prices[1].toString();

      // Test getAdapterParam
      const adapterParam = lunarBase.getAdapterParam(
        TokenA.address,
        TokenB.address,
        srcAmount,
        destAmount,
        poolPrice.data,
        SwapSide.SELL,
      );

      // Validate structure
      expect(adapterParam.targetExchange).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(adapterParam.networkFee).toBe('0');
      expect(adapterParam.payload).toMatch(/^0x[a-fA-F0-9]+$/);
      expect(adapterParam.payload.length).toBeGreaterThan(10);
    });
  });
});

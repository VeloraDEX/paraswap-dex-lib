/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Interface } from '@ethersproject/abi';
import { Network, SwapSide, ETHER_ADDRESS } from '../../constants';
import { DummyDexHelper } from '../../dex-helper/index';
import { Fairylaunch } from './fairylaunch';
import BondingCurveABI from '../../abi/fairylaunch/BondingCurve.json';

const bondingCurveIface = new Interface(BondingCurveABI);

describe('Fairylaunch E2E', () => {
  const dexKey = 'Fairylaunch';

  describe('BSC Mainnet', () => {
    const network = Network.BSC;
    const dexHelper = new DummyDexHelper(network);

    const FAIRY_TOKEN_ADDRESS = '0xeaf5a5aad581ebfe893f7b31e3720e7bbaa3bae5';
    const BONDING_CURVE_ADDRESS = '0x3014646079673048abaa2d84c9a197eefcde7b9b';

    let blockNumber: number;
    let fairylaunch: Fairylaunch;

    beforeAll(async () => {
      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      fairylaunch = new Fairylaunch(network, dexKey, dexHelper);
      console.log('Block Number:', blockNumber);
    });

    afterAll(async () => {
      await new Promise(resolve => setTimeout(resolve, 500));
    });

    // 1. Instanciación
    it('should instantiate Fairylaunch with correct configuration', async () => {
      expect(fairylaunch).toBeDefined();
      expect(fairylaunch.needWrapNative).toBe(false);
      expect(fairylaunch.hasConstantPriceLargeAmounts).toBe(false);
      expect(fairylaunch.isFeeOnTransferSupported).toBe(false);
    });

    // 2. Pool discovery BUY
    it('should find pools for BNB -> Token (BUY)', async () => {
      const pools = await fairylaunch.getPoolIdentifiers(
        { address: ETHER_ADDRESS, decimals: 18 },
        { address: FAIRY_TOKEN_ADDRESS, decimals: 18 },
        SwapSide.BUY,
        blockNumber,
      );

      console.log('Pools BUY:', pools);
      expect(pools.length).toBeGreaterThan(0);
      expect(pools.map(p => p.toLowerCase())).toContain(BONDING_CURVE_ADDRESS.toLowerCase());
    });

    // 3. Pool discovery SELL
    it('should find pools for Token -> BNB (SELL)', async () => {
      const pools = await fairylaunch.getPoolIdentifiers(
        { address: FAIRY_TOKEN_ADDRESS, decimals: 18 },
        { address: ETHER_ADDRESS, decimals: 18 },
        SwapSide.SELL,
        blockNumber,
      );

      console.log('Pools SELL:', pools);
      expect(pools.length).toBeGreaterThan(0);
      expect(pools.map(p => p.toLowerCase())).toContain(BONDING_CURVE_ADDRESS.toLowerCase());
    });

    // 4. Invalid token pair
    it('should return empty pools for invalid token pair', async () => {
      const pools = await fairylaunch.getPoolIdentifiers(
        { address: '0x0000000000000000000000000000000000000001', decimals: 18 },
        { address: '0x0000000000000000000000000000000000000002', decimals: 18 },
        SwapSide.BUY,
        blockNumber,
      );

      expect(pools).toEqual([]);
    });

    // 5. BUY pricing
    it('should get correct BUY prices', async () => {
      const amounts = [
        0n,
        BigInt('100000000000000000'),
        BigInt('200000000000000000'),
        BigInt('300000000000000000'),
      ];

      const prices = await fairylaunch.getPricesVolume(
        { address: ETHER_ADDRESS, decimals: 18 },
        { address: FAIRY_TOKEN_ADDRESS, decimals: 18 },
        amounts,
        SwapSide.BUY,
        blockNumber,
        [BONDING_CURVE_ADDRESS],
      );

      console.log('BUY prices:', prices?.map(p => p.prices.map(v => v.toString())));

      expect(prices).not.toBeNull();
      if (prices) {
        expect(prices.length).toBe(1);
        expect(prices[0].prices).toHaveLength(amounts.length);
        expect(prices[0].prices[0]).toBe(0n);
        expect(prices[0].prices[1]).toBeGreaterThan(0n);
        expect(prices[0].prices[2]).toBeGreaterThan(prices[0].prices[1]);
        expect(prices[0].prices[3]).toBeGreaterThan(prices[0].prices[2]);
      }
    });

    // 6. SELL pricing
    it('should get correct SELL prices', async () => {
      const amounts = [
        0n,
        BigInt('1000000000000000000'),
        BigInt('2000000000000000000'),
        BigInt('3000000000000000000'),
      ];

      const prices = await fairylaunch.getPricesVolume(
        { address: FAIRY_TOKEN_ADDRESS, decimals: 18 },
        { address: ETHER_ADDRESS, decimals: 18 },
        amounts,
        SwapSide.SELL,
        blockNumber,
        [BONDING_CURVE_ADDRESS],
      );

      console.log('SELL prices:', prices?.map(p => p.prices.map(v => v.toString())));

      expect(prices).not.toBeNull();
      if (prices) {
        expect(prices.length).toBe(1);
        expect(prices[0].prices).toHaveLength(amounts.length);
        expect(prices[0].prices[0]).toBe(0n);
        expect(prices[0].prices[1]).toBeGreaterThan(0n);
        expect(prices[0].prices[2]).toBeGreaterThan(prices[0].prices[1]);
        expect(prices[0].prices[3]).toBeGreaterThan(prices[0].prices[2]);
      }
    });

    // 7. limitPools inválido
    it('should return null for invalid limitPools', async () => {
      const prices = await fairylaunch.getPricesVolume(
        { address: ETHER_ADDRESS, decimals: 18 },
        { address: FAIRY_TOKEN_ADDRESS, decimals: 18 },
        [BigInt('100000000000000000')],
        SwapSide.BUY,
        blockNumber,
        ['0x0000000000000000000000000000000000000000'],
      );

      expect(prices).toBeNull();
    });

    // 8. Top pools
    it('should get top pools for token', async () => {
      const poolLiquidity = await fairylaunch.getTopPoolsForToken(
        FAIRY_TOKEN_ADDRESS,
        10,
      );

      console.log('Top Pools:', poolLiquidity);

      expect(poolLiquidity.length).toBeGreaterThan(0);
      expect(poolLiquidity[0].exchange).toBe(dexKey);
      expect(poolLiquidity[0].address.toLowerCase()).toBe(BONDING_CURVE_ADDRESS.toLowerCase());
      expect(poolLiquidity[0].connectorTokens[0].address.toLowerCase()).toBe(ETHER_ADDRESS.toLowerCase());
    });

    // 9. BUY calldata con getDexParam - verificar spender
    it('should build correct BUY calldata with spender', async () => {
      const data = {
        exchange: BONDING_CURVE_ADDRESS,
        token: FAIRY_TOKEN_ADDRESS,
        ethReserve: 3247918230555704n,
        tokenReserve: 798300612069184377671425290n,
        totalTokensSold: 1699387930815622328574710n,
        graduated: false,
        launchId: 1,
      };

      const srcAmount = '100000000000000000';
      const destAmount = '49335440539533382706003785';

      const param = fairylaunch.getDexParam(
        ETHER_ADDRESS,
        FAIRY_TOKEN_ADDRESS,
        srcAmount,
        destAmount,
        ETHER_ADDRESS,
        data,
        SwapSide.BUY,
      );

      console.log('DexParam BUY:', param);

      expect(param.targetExchange.toLowerCase()).toBe(BONDING_CURVE_ADDRESS.toLowerCase());
      expect(param.needWrapNative).toBe(false);
      expect(param.spender).toBeDefined();
      expect(param.spender!.toLowerCase()).toBe(BONDING_CURVE_ADDRESS.toLowerCase());

      // Decodificar exchangeData
      const decodedCall = bondingCurveIface.decodeFunctionData('buy', param.exchangeData);
      expect(decodedCall.minTokensOut.toString()).toBe(destAmount);
      expect(Number(decodedCall.deadline)).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    // 10. SELL calldata con getDexParam - verificar spender
    it('should build correct SELL calldata with spender', async () => {
      const data = {
        exchange: BONDING_CURVE_ADDRESS,
        token: FAIRY_TOKEN_ADDRESS,
        ethReserve: 3247918230555704n,
        tokenReserve: 798300612069184377671425290n,
        totalTokensSold: 1699387930815622328574710n,
        graduated: false,
        launchId: 1,
      };

      const srcAmount = '1000000000000000000';
      const destAmount = '1895117406';

      const param = fairylaunch.getDexParam(
        FAIRY_TOKEN_ADDRESS,
        ETHER_ADDRESS,
        srcAmount,
        destAmount,
        ETHER_ADDRESS,
        data,
        SwapSide.SELL,
      );

      console.log('DexParam SELL:', param);

      expect(param.targetExchange.toLowerCase()).toBe(BONDING_CURVE_ADDRESS.toLowerCase());
      expect(param.needWrapNative).toBe(false);
      expect(param.spender).toBeDefined();
      expect(param.spender!.toLowerCase()).toBe(BONDING_CURVE_ADDRESS.toLowerCase());

      // Decodificar exchangeData
      const decodedCall = bondingCurveIface.decodeFunctionData('sell', param.exchangeData);
      expect(decodedCall.tokenAmount.toString()).toBe(srcAmount);
      expect(decodedCall.minEthOut.toString()).toBe(destAmount);
      expect(Number(decodedCall.deadline)).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    // 11. Zero amount
    it('should return 0 price for zero amount', async () => {
      const prices = await fairylaunch.getPricesVolume(
        { address: ETHER_ADDRESS, decimals: 18 },
        { address: FAIRY_TOKEN_ADDRESS, decimals: 18 },
        [0n],
        SwapSide.BUY,
        blockNumber,
        [BONDING_CURVE_ADDRESS],
      );

      expect(prices).not.toBeNull();
      if (prices) {
        expect(prices[0].prices[0]).toBe(0n);
      }
    });
  });
});
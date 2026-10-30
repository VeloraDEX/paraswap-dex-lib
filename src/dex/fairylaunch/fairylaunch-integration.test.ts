/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Interface, Result } from '@ethersproject/abi';
import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide, ETHER_ADDRESS } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { Fairylaunch } from './fairylaunch';
import {
  checkPoolsLiquidity,
} from '../../../tests/utils';
import BondingCurveABI from '../../abi/fairylaunch/BondingCurve.json';

const bondingCurveIface = new Interface(BondingCurveABI);

// Direcciones reales de FairyLaunch en BSC Mainnet
const FAIRY_TOKEN_ADDRESS = '0xeaf5a5aad581ebfe893f7b31e3720e7bbaa3bae5';
const BONDING_CURVE_ADDRESS = '0x3014646079673048abaa2d84c9a197eefcde7b9b';
const LAUNCH_FACTORY_ADDRESS = '0x28163d7943AA6715a9559D468B29c0343412E236';

function stringifyBigInt(obj: any): string {
  return JSON.stringify(obj, (key, value) => 
    typeof value === 'bigint' ? value.toString() : value, 2);
}

async function checkOnChainPricing(
  fairylaunch: Fairylaunch,
  funcName: string,
  blockNumber: number,
  prices: bigint[],
  amounts: bigint[],
) {
  const contract = new fairylaunch.dexHelper.web3Provider.eth.Contract(
    BondingCurveABI as any,
    BONDING_CURVE_ADDRESS,
  );

  const expectedPrices: bigint[] = [0n];

  for (let i = 1; i < amounts.length; i++) {
    const amount = amounts[i];
    if (amount === 0n) {
      expectedPrices.push(0n);
      continue;
    }

    try {
      const result = await contract.methods[funcName](amount.toString()).call({}, blockNumber);
      expectedPrices.push(BigInt(result.toString()));
    } catch (e) {
      console.warn(`On-chain quote failed for amount ${amount}:`, (e as Error).message);
      expectedPrices.push(0n);
    }
  }

  expect(prices).toEqual(expectedPrices);
}

async function testPricingOnNetwork(
  fairylaunch: Fairylaunch,
  dexKey: string,
  blockNumber: number,
  side: SwapSide,
  amounts: bigint[],
  funcNameToCheck: string,
) {
  const srcToken = side === SwapSide.BUY 
    ? { address: ETHER_ADDRESS, decimals: 18 }
    : { address: FAIRY_TOKEN_ADDRESS, decimals: 18 };
  
  const destToken = side === SwapSide.BUY
    ? { address: FAIRY_TOKEN_ADDRESS, decimals: 18 }
    : { address: ETHER_ADDRESS, decimals: 18 };

  const pools = await fairylaunch.getPoolIdentifiers(
    srcToken,
    destToken,
    side,
    blockNumber,
  );
  console.log(`Pool Identifiers (${side === SwapSide.BUY ? 'BUY' : 'SELL'}):`, pools);

  expect(pools.length).toBeGreaterThan(0);

  const poolPrices = await fairylaunch.getPricesVolume(
    srcToken,
    destToken,
    amounts,
    side,
    blockNumber,
    pools,
  );
  console.log(`Pool Prices (${side === SwapSide.BUY ? 'BUY' : 'SELL'}):`, stringifyBigInt(poolPrices));

  expect(poolPrices).not.toBeNull();
  if (poolPrices) {
    const prices = poolPrices[0].prices;
    
    for (let i = 0; i < prices.length; i++) {
      expect(prices[i]).toBeGreaterThanOrEqual(0n);
      if (i > 0) {
        expect(prices[i]).toBeGreaterThan(prices[i - 1]);
      }
    }

    await checkOnChainPricing(
      fairylaunch,
      funcNameToCheck,
      blockNumber,
      prices,
      amounts,
    );
  }
}

describe('Fairylaunch', function () {
  const dexKey = 'Fairylaunch';
  let blockNumber: number;
  let fairylaunch: Fairylaunch;

  describe('BSC Mainnet', () => {
    const network = Network.BSC;
    const dexHelper = new DummyDexHelper(network);

    const amountsForSell = [
      0n,
      1n * BI_POWS[18],
      2n * BI_POWS[18],
      3n * BI_POWS[18],
      4n * BI_POWS[18],
      5n * BI_POWS[18],
    ];

    const amountsForBuy = [
      0n,
      1n * BI_POWS[17],
      2n * BI_POWS[17],
      3n * BI_POWS[17],
    ];

    beforeAll(async () => {
      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      console.log('Block Number:', blockNumber);
      
      fairylaunch = new Fairylaunch(network, dexKey, dexHelper);
      if (fairylaunch.initializePricing) {
        await fairylaunch.initializePricing(blockNumber);
      }
    });

    afterAll(async () => {
      await new Promise(resolve => setTimeout(resolve, 500));
    });

    it('getPoolIdentifiers and getPricesVolume BUY', async function () {
      await testPricingOnNetwork(
        fairylaunch,
        dexKey,
        blockNumber,
        SwapSide.BUY,
        amountsForBuy,
        'quoteBuy',
      );
    });

    it('getPoolIdentifiers and getPricesVolume SELL', async function () {
      await testPricingOnNetwork(
        fairylaunch,
        dexKey,
        blockNumber,
        SwapSide.SELL,
        amountsForSell,
        'quoteSell',
      );
    });

    it('should build correct BUY DexParam with spender', function () {
      const data = {
        exchange: BONDING_CURVE_ADDRESS,
        token: FAIRY_TOKEN_ADDRESS,
        ethReserve: 3247918230555704n,
        tokenReserve: 798300612069184377671425290n,
        totalTokensSold: 1699387930815622328574710n,
        graduated: false,
        launchId: 1,
      };

      const param = fairylaunch.getDexParam(
        ETHER_ADDRESS,
        FAIRY_TOKEN_ADDRESS,
        '100000000000000000',
        '49335440539533382706003785',
        ETHER_ADDRESS,
        data,
        SwapSide.BUY,
      );

      expect(param.targetExchange.toLowerCase()).toBe(BONDING_CURVE_ADDRESS.toLowerCase());
      expect(param.spender).toBeDefined();
      expect(param.spender!.toLowerCase()).toBe(BONDING_CURVE_ADDRESS.toLowerCase());
      expect(param.needWrapNative).toBe(false);
    });

    it('should build correct SELL DexParam with spender', function () {
      const data = {
        exchange: BONDING_CURVE_ADDRESS,
        token: FAIRY_TOKEN_ADDRESS,
        ethReserve: 3247918230555704n,
        tokenReserve: 798300612069184377671425290n,
        totalTokensSold: 1699387930815622328574710n,
        graduated: false,
        launchId: 1,
      };

      const param = fairylaunch.getDexParam(
        FAIRY_TOKEN_ADDRESS,
        ETHER_ADDRESS,
        '1000000000000000000',
        '1895117406',
        ETHER_ADDRESS,
        data,
        SwapSide.SELL,
      );

      expect(param.targetExchange.toLowerCase()).toBe(BONDING_CURVE_ADDRESS.toLowerCase());
      expect(param.spender).toBeDefined();
      expect(param.spender!.toLowerCase()).toBe(BONDING_CURVE_ADDRESS.toLowerCase());
      expect(param.needWrapNative).toBe(false);
    });

    it('getTopPoolsForToken', async function () {
      const newFairylaunch = new Fairylaunch(network, dexKey, dexHelper);
      if (newFairylaunch.updatePoolState) {
        await newFairylaunch.updatePoolState();
      }
      const poolLiquidity = await newFairylaunch.getTopPoolsForToken(
        FAIRY_TOKEN_ADDRESS,
        10,
      );
      console.log('Top Pools:', stringifyBigInt(poolLiquidity));

      if (!newFairylaunch.hasConstantPriceLargeAmounts) {
        checkPoolsLiquidity(
          poolLiquidity,
          FAIRY_TOKEN_ADDRESS,
          dexKey,
        );
      }
    });
  });
});
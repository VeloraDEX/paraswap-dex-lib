/* eslint-disable no-console */
// npx jest src/dex/balancer-v2/balancer-v2-gyro2.test.ts
import dotenv from 'dotenv';
dotenv.config();
import { Interface } from '@ethersproject/abi';
import { BigNumber } from '@ethersproject/bignumber';

import { Tokens } from '../../../tests/constants-e2e';
import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { BalancerV2EventPool } from './balancer-v2';
import { BalancerConfig } from './config';
import { BalancerPoolTypes, PoolState, SubgraphPoolBase } from './types';
import { Gyro2Pool, Gyro2PoolPairData } from './Gyro2Pool';

import VaultABI from '../../abi/balancer-v2/vault.json';

const dexKey = 'BalancerV2';
const network = Network.POLYGON;
const config = BalancerConfig[dexKey][network];
const vaultInterface = new Interface(VaultABI);
const gyro2Pool = new Gyro2Pool(config.vaultAddress, vaultInterface);
const tokens = Tokens[network];

describe('BalancerV2', () => {
  describe('Gyro2 Pool', () => {
    describe('Pool Fetching', () => {
      let gyro2PoolSg: SubgraphPoolBase;
      let gyro2PoolState: PoolState;
      const dexHelper = new DummyDexHelper(network);
      const logger = dexHelper.getLogger(dexKey);
      const balancerPools = new BalancerV2EventPool(
        dexKey,
        network,
        config.vaultAddress,
        config.subgraphURL,
        dexHelper,
        logger,
      );
      it('should be supported pool type', async function () {
        expect(balancerPools.isSupportedPool('Gyro2')).toBe(true);
      });
      it('should be event supported', async function () {
        expect(
          balancerPools.eventSupportedPoolTypes.includes(
            BalancerPoolTypes.Gyro2,
          ),
        ).toBe(true);
      });
      it('should fetch Gyro2 Pool with correct fields from Subgraph', async function () {
        const pools = await balancerPools.fetchAllSubgraphPools();
        // DAI/USDC
        const gyro2PoolId =
          '0xdac42eeb17758daa38caf9a3540c808247527ae3000200000000000000000a2b';
        const gyro2 = pools.filter(p => p.id === gyro2PoolId);
        expect(gyro2.length).toBe(1);
        gyro2PoolSg = gyro2[0];
        expect(gyro2PoolSg.tokens.length).toBe(2);
        const sqrtAlpha = parseFloat(gyro2PoolSg.sqrtAlpha);
        const sqrtBeta = parseFloat(gyro2PoolSg.sqrtBeta);
        expect(sqrtAlpha > 0).toBe(true);
        expect(sqrtBeta > 0).toBe(true);
        /*
                Setting to hard values as Subgraph will change over time
                {
                balances: [ 18681901532000000000000n, 18724583701712070442033n ],
                indexIn: 0,
                indexOut: 1,
                scalingFactors: [ 1000000000000000000000000000000n, 1000000000000000000n ],
                swapFee: 200000000000000n,
                sqrtAlpha: 997496867163000167n,
                sqrtBeta: 1002496882788171068n
                }
            */
        gyro2PoolSg = { ...gyro2PoolSg };
        gyro2PoolSg.sqrtAlpha = '0.997496867163000167';
        gyro2PoolSg.sqrtBeta = '1.002496882788171068';
      });
      it('getOnChainState', async function () {
        const blocknumber = 38708647;
        const state = await balancerPools.getOnChainState(
          [gyro2PoolSg],
          blocknumber,
        );
        gyro2PoolState = state[gyro2PoolSg.address];
        expect(gyro2PoolState.swapFee).toBe(BigInt('200000000000000'));
        expect(gyro2PoolState.tokens[tokens.USDC.address].balance).toBe(
          BigInt('18681901532'),
        );
        expect(
          gyro2PoolState.tokens[tokens.DAI.address.toLowerCase()].balance,
        ).toBe(BigInt('18724583701712070442033'));
      });
      it('parsePoolPairData, indexIn === 0, return sqrtAlpha/sqrtBeta', async function () {
        const tokenIn = tokens.USDC.address;
        const tokenOut = tokens.DAI.address;
        const pairData = gyro2Pool.parsePoolPairData(
          gyro2PoolSg,
          gyro2PoolState,
          tokenIn,
          tokenOut,
        );
        expect(pairData.indexIn).toBe(0);
        expect(pairData.indexOut).toBe(1);
        expect(pairData.swapFee).toBe(BigInt('200000000000000'));
        expect(pairData.sqrtAlpha.toString()).toBe('997496867163000167');
        expect(pairData.sqrtBeta.toString()).toBe('1002496882788171068');
        expect(pairData.balances).toStrictEqual([
          BigNumber.from('18681901532000000000000'),
          BigNumber.from('18724583701712070442033'),
        ]);
      });
      it('parsePoolPairData, indexIn !== 0, return 1/sqrtAlpha/sqrtBeta', async function () {
        const tokenIn = tokens.DAI.address;
        const tokenOut = tokens.USDC.address;
        const pairData = gyro2Pool.parsePoolPairData(
          gyro2PoolSg,
          gyro2PoolState,
          tokenIn,
          tokenOut,
        );
        expect(pairData.indexIn).toBe(1);
        expect(pairData.indexOut).toBe(0);
        expect(pairData.swapFee).toBe(BigInt('200000000000000'));
        expect(pairData.sqrtAlpha.toString()).toBe('1002509414234171021');
        expect(pairData.sqrtBeta.toString()).toBe('997509336107632902');
        expect(pairData.balances).toStrictEqual([
          BigNumber.from('18681901532000000000000'),
          BigNumber.from('18724583701712070442033'),
        ]);
      });
    });
    describe('Swap Functions', () => {
      // Following test values and results are taken from SOR tests added by Gyro team
      describe('Swap Functions  - 6decimals>18decimals', () => {
        const pairData: Gyro2PoolPairData = {
          balances: [
            BigNumber.from('1000000000000000000000'),
            BigNumber.from('1232000000000000000000'),
          ],
          indexIn: 0,
          indexOut: 1,
          swapFee: BigInt('9000000000000000'),
          sqrtAlpha: BigNumber.from('999500374750171757'),
          sqrtBeta: BigNumber.from('1000500375350272092'),
          scalingFactors: [
            BigInt('1000000000000000000000000000000'),
            BigInt('1000000000000000000'),
          ],
        };
        it('getSwapMaxAmount', async () => {
          const swapMaxAmount = gyro2Pool.getSwapMaxAmount(
            pairData,
            SwapSide.SELL,
          );
          expect(swapMaxAmount).toBe(BigInt('1231998768'));
        });
        it('swap', async function () {
          const amountIn = BigInt('13500000');
          const amountOut = gyro2Pool.onSell([amountIn], pairData);
          expect(amountOut.length).toBe(1);
          expect(amountOut[0].toString()).toBe('13379816831223414577');
        });
      });
      describe('Swap Functions  - 18decimals>6decimals', () => {
        const pairData: Gyro2PoolPairData = {
          balances: [
            BigNumber.from('1000000000000000000000'),
            BigNumber.from('1232000000000000000000'),
          ],
          indexIn: 1,
          indexOut: 0,
          swapFee: BigInt('9000000000000000'),
          sqrtAlpha: BigNumber.from('999499874900000000'),
          sqrtBeta: BigNumber.from('1000499875000000000'),
          scalingFactors: [
            BigInt('1000000000000000000000000000000'),
            BigInt('1000000000000000000'),
          ],
        };
        it('getSwapMaxAmount', async () => {
          const swapMaxAmount = gyro2Pool.getSwapMaxAmount(
            pairData,
            SwapSide.SELL,
          );
          expect(swapMaxAmount).toBe(BigInt('999999000000000000000'));
        });
        it('swap', async function () {
          const amountIn = BigInt('13500000000000000000');
          const amountOut = gyro2Pool.onSell([amountIn], pairData);
          expect(amountOut.length).toBe(1);
          expect(amountOut[0].toString()).toBe('13377022');
        });
      });
    });
  });
});

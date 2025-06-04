import dotenv from 'dotenv';
dotenv.config();

import { Executor01BytecodeBuilder } from './Executor01BytecodeBuilder';
import { Network, NULL_ADDRESS } from '../constants';
import { DummyDexHelper } from '../dex-helper';

import { OptimalRate } from '@paraswap/core';
import { DexExchangeParam } from '../types';
import { DepositWithdrawReturn } from '../dex/weth/types';

import priceRouteSimpleSwapUniV3EthUsdc from './fixtures/executor01/routes/price-route-simpleSwap-univ3-eth-usdc.json';
import exchangeParamsSimpleSwapUniV3EthUsdc from './fixtures/executor01/exchange-params/price-route-simpleSwap-univ3-eth-usdc.json';
import maybeWethCalldataSimpleSwapUniV3EthUsdc from './fixtures/executor01/maybe-weth-calldata/price-route-simpleSwap-univ3-eth-usdc.json';

import priceRouteSimpleSwapUniV2EthDAI from './fixtures/executor01/routes/price-route-simpleSwap-univ2-eth-dai.json';
import exchangeParamsSimpleSwapUniV2EthDAI from './fixtures/executor01/exchange-params/price-route-simpleSwap-univ2-eth-dai.json';
// import maybeWethCalldataSimpleSwapUniV2EthDAI from './fixtures/executor01/maybe-weth-calldata/price-route-simpleSwap-univ2-eth-dai.json';

import priceRouteSimpleSwapUniV3UsdcEth from './fixtures/executor01/routes/price-route-simpleSwap-univ3-usdc-eth.json';
import exchangeParamsSimpleSwapUniV3UsdcEth from './fixtures/executor01/exchange-params/price-route-simpleSwap-univ3-usdc-eth.json';
import maybeWethCalldataSimpleSwapUniV3UsdcEth from './fixtures/executor01/maybe-weth-calldata/price-route-simpleSwap-univ3-usdc-eth.json';

import priceRouteSimpleSwapUniV3UsdcUsdt from './fixtures/executor01/routes/price-route-simpleSwap-univ3-usdc-usdt.json';
import exchangeParamsSimpleSwapUniV3UsdcUsdt from './fixtures/executor01/exchange-params/price-route-simpleSwap-univ3-usdc-usdt.json';

import priceRouteSimpleSwapBalancerV1UsdcEth from './fixtures/executor01/routes/price-route-simpleSwap-balancerv1-usdc-eth.json';
import exchangeParamsSimpleSwapBalancerV1UsdcEth from './fixtures/executor01/exchange-params/price-route-simpleSwap-balancerv1-usdc-eth.json';

import priceRouteSimpleSwapBalancerV1EthUsdc from './fixtures/executor01/routes/price-route-simpleSwap-balancerv1-eth-usdc.json';
import exchangeParamsSimpleSwapBalancerV1EthUsdc from './fixtures/executor01/exchange-params/price-route-simpleSwap-balancerv1-eth-usdc.json';

import priceRouteSimpleSwapBalancerV1UsdcWbtc from './fixtures/executor01/routes/price-route-simpleSwap-balancerv1-usdc-wbtc.json';
import exchangeParamsSimpleSwapBalancerV1UsdcWbtc from './fixtures/executor01/exchange-params/price-route-simpleSwap-balancerv1-usdc-wbtc.json';

import priceRouteSimpleSwapCurveV1EthSteth from './fixtures/executor01/routes/price-route-simpleSwap-curvev1-eth-steth.json';
import exchangeParamsSimpleSwapCurveV1EthSteth from './fixtures/executor01/exchange-params/price-route-simpleSwap-curvev1-eth-steth.json';

import priceRouteSimpleSwapCurveV1StethEth from './fixtures/executor01/routes/price-route-simpleSwap-curvev1-steth-eth.json';
import exchangeParamsSimpleSwapCurveV1StethEth from './fixtures/executor01/exchange-params/price-route-simpleSwap-curvev1-eth-steth.json';

import priceRouteSimpleSwapCurveV1UsdcUsdt from './fixtures/executor01/routes/price-route-simpleSwap-curvev1-usdc-usdt.json';
import exchangeParamsSimpleSwapCurveV1UsdcUsdt from './fixtures/executor01/exchange-params/price-route-simpleSwap-curvev1-usdc-usdt.json';

import priceRouteMultiSwapSushiV3DaiUsdcEth from './fixtures/executor01/routes/price-route-multiswap-sushiv3-dai-usdc-eth.json';
import exchangeParamsMultiSwapSushiV3DaiUsdcEth from './fixtures/executor01/exchange-params/price-route-multiswap-sushiv3-dai-usdc-eth.json';

import priceRouteMultiSwapSushiV3EthUsdcDai from './fixtures/executor01/routes/price-route-multiswap-sushiv3-eth-usdc-dai.json';
import exchangeParamsMultiSwapSushiV3EthUsdcDai from './fixtures/executor01/exchange-params/price-route-multiswap-sushiv3-eth-usdc-dai.json';

import priceRouteMultiSwapSushiV3UsdtUsdcDai from './fixtures/executor01/routes/price-route-multiswap-sushiv3-usdt-usdc-dai.json';
import exchangeParamsMultiSwapSushiV3UsdtUsdcDai from './fixtures/executor01/exchange-params/price-route-multiswap-sushiv3-usdt-usdc-dai.json';

import priceRouteMultiSwapSushiV3CurveV1GusdUsdcEth from './fixtures/executor01/routes/price-route-multiswap-sushiv3-curvev1-gusd-usdc-eth.json';
import exchangeParamsMultiSwapSushiV3CurveV1GusdUsdcEth from './fixtures/executor01/exchange-params/price-route-multiswap-sushiv3-curvev1-gusd-usdc-eth.json';
import maybeWethCalldataMultiSwapSushiV3CurveV1GusdUsdcEth from './fixtures/executor01/maybe-weth-calldata/price-route-multiswap-sushiv3-curvev1-gusd-usdc-eth.json';

import priceRouteMultiSwapSushiV3CurveV1EthUsdcGusd from './fixtures/executor01/routes/price-route-multiswap-sushiv3-curvev1-eth-usdc-gusd.json';
import exchangeParamsMultiSwapSushiV3CurveV1EthUsdcGusd from './fixtures/executor01/exchange-params/price-route-multiswap-sushiv3-curvev1-eth-usdc-gusd.json';
import maybeWethCalldataMultiSwapSushiV3CurveV1EthUsdcGusd from './fixtures/executor01/maybe-weth-calldata/price-route-multiswap-sushiv3-curvev1-eth-usdc-gusd.json';

import priceRouteMultiSwapBalancerV1CurveV1EthUsdcGusd from './fixtures/executor01/routes/price-route-multiswap-balancerv1-curvev1-eth-usdc-gusd.json';
import exchangeParamsMultiSwapBalancerV1CurveV1EthUsdcGusd from './fixtures/executor01/exchange-params/price-route-multiswap-balancerv1-curvev1-eth-usdc-gusd.json';

import priceRouteMultiSwapBalancerV1SushiV3WbtcEthSushi from './fixtures/executor01/routes/price-route-multiswap-balancerv1-sushiv3-wbtc-eth-sushi.json';
import exchangeParamsMultiSwapBalancerV1SushiV3WbtcEthSushi from './fixtures/executor01/exchange-params/price-route-multiswap-balancerv1-sushiv3-wbtc-eth-sushi.json';
import maybeWethCalldataMultiSwapBalancerV1SushiV3WbtcEthSushi from './fixtures/executor01/maybe-weth-calldata/price-route-multiswap-balancerv1-sushiv3-wbtc-eth-sushi.json';

describe('Executor01BytecodeBuilder Snapshot tests', () => {
  let executor01BytecodeBuilder: Executor01BytecodeBuilder;
  beforeEach(() => {
    const network = Network.MAINNET;
    const dexHelper = new DummyDexHelper(network);
    executor01BytecodeBuilder = new Executor01BytecodeBuilder(dexHelper);
  });

  describe('buildByteCode', () => {
    describe('SimpleSwap', () => {
      describe('UniV3 (needs wrap native, dex func has dest token and recipient)', () => {
        it('should produce correct bytecode for simpleSwap ETH -> USDC', () => {
          const bytecode = executor01BytecodeBuilder.buildByteCode(
            priceRouteSimpleSwapUniV3EthUsdc as unknown as OptimalRate,
            exchangeParamsSimpleSwapUniV3EthUsdc as unknown as DexExchangeParam[],
            NULL_ADDRESS,
            maybeWethCalldataSimpleSwapUniV3EthUsdc as unknown as DepositWithdrawReturn,
          );

          expect(bytecode).toMatchSnapshot();
        });

        it('should produce correct bytecode for simpleSwap USDC -> ETH', () => {
          const bytecode = executor01BytecodeBuilder.buildByteCode(
            priceRouteSimpleSwapUniV3UsdcEth as unknown as OptimalRate,
            exchangeParamsSimpleSwapUniV3UsdcEth as unknown as DexExchangeParam[],
            NULL_ADDRESS,
            maybeWethCalldataSimpleSwapUniV3UsdcEth as unknown as DepositWithdrawReturn,
          );

          expect(bytecode).toMatchSnapshot();
        });

        it('should produce correct bytecode for simpleSwap USDC -> USDT', () => {
          const bytecode = executor01BytecodeBuilder.buildByteCode(
            priceRouteSimpleSwapUniV3UsdcUsdt as unknown as OptimalRate,
            exchangeParamsSimpleSwapUniV3UsdcUsdt as unknown as DexExchangeParam[],
            NULL_ADDRESS,
            undefined, // no weth calldata
          );

          expect(bytecode).toMatchSnapshot();
        });
      });

      describe('BalancerV1 (needs wrap native dynamically depending on a dex function, no recipient, dex func has a dest token)', () => {
        it('should produce correct bytecode for simpleSwap ETH -> USDC', () => {
          const bytecode = executor01BytecodeBuilder.buildByteCode(
            priceRouteSimpleSwapBalancerV1EthUsdc as unknown as OptimalRate,
            exchangeParamsSimpleSwapBalancerV1EthUsdc as unknown as DexExchangeParam[],
            NULL_ADDRESS,
            undefined, // no weth calldata
          );

          expect(bytecode).toMatchSnapshot();
        });

        it('should produce correct bytecode for simpleSwap USDC -> ETH', () => {
          const bytecode = executor01BytecodeBuilder.buildByteCode(
            priceRouteSimpleSwapBalancerV1UsdcEth as unknown as OptimalRate,
            exchangeParamsSimpleSwapBalancerV1UsdcEth as unknown as DexExchangeParam[],
            NULL_ADDRESS,
            undefined, // no weth calldata
          );

          expect(bytecode).toMatchSnapshot();
        });

        it('should produce correct bytecode for simpleSwap USDC -> WBTC', () => {
          const bytecode = executor01BytecodeBuilder.buildByteCode(
            priceRouteSimpleSwapBalancerV1UsdcWbtc as unknown as OptimalRate,
            exchangeParamsSimpleSwapBalancerV1UsdcWbtc as unknown as DexExchangeParam[],
            NULL_ADDRESS,
            undefined, // no weth calldata
          );

          expect(bytecode).toMatchSnapshot();
        });
      });

      describe('CurveV1 (doesnt need wrap native, no recipient, no dest token in dex func args)', () => {
        it('should produce correct bytecode for simpleSwap ETH -> STETH', () => {
          const bytecode = executor01BytecodeBuilder.buildByteCode(
            priceRouteSimpleSwapCurveV1EthSteth as unknown as OptimalRate,
            exchangeParamsSimpleSwapCurveV1EthSteth as unknown as DexExchangeParam[],
            NULL_ADDRESS,
            undefined, // no weth calldata
          );

          expect(bytecode).toMatchSnapshot();
        });

        it('should produce correct bytecode for simpleSwap STETH -> ETH', () => {
          const bytecode = executor01BytecodeBuilder.buildByteCode(
            priceRouteSimpleSwapCurveV1StethEth as unknown as OptimalRate,
            exchangeParamsSimpleSwapCurveV1StethEth as unknown as DexExchangeParam[],
            NULL_ADDRESS,
            undefined, // no weth calldata
          );

          expect(bytecode).toMatchSnapshot();
        });

        it('should produce correct bytecode for simpleSwap USDC -> USDT', () => {
          const bytecode = executor01BytecodeBuilder.buildByteCode(
            priceRouteSimpleSwapCurveV1UsdcUsdt as unknown as OptimalRate,
            exchangeParamsSimpleSwapCurveV1UsdcUsdt as unknown as DexExchangeParam[],
            NULL_ADDRESS,
            undefined, // no weth calldata
          );

          expect(bytecode).toMatchSnapshot();
        });
      });
    });

    describe('MultiSwap', () => {
      it('should produce correct bytecode for USDC -> ETH -> WBTC via SushiSwapV3', () => {
        const bytecode = executor01BytecodeBuilder.buildByteCode(
          priceRouteMultiSwapSushiV3DaiUsdcEth as unknown as OptimalRate,
          exchangeParamsMultiSwapSushiV3DaiUsdcEth as unknown as DexExchangeParam[],
          NULL_ADDRESS,
          undefined, // no weth calldata
        );

        expect(bytecode).toMatchSnapshot();
      });

      it('should produce correct bytecode for DAI -> USDC -> ETH  via SushiSwapV3', () => {
        const bytecode = executor01BytecodeBuilder.buildByteCode(
          priceRouteMultiSwapSushiV3DaiUsdcEth as unknown as OptimalRate,
          exchangeParamsMultiSwapSushiV3DaiUsdcEth as unknown as DexExchangeParam[],
          NULL_ADDRESS,
          undefined, // no weth calldata
        );

        expect(bytecode).toMatchSnapshot();
      });

      it('should produce correct bytecode for ETH -> USDC -> DAI  via SushiSwapV3', () => {
        const bytecode = executor01BytecodeBuilder.buildByteCode(
          priceRouteMultiSwapSushiV3EthUsdcDai as unknown as OptimalRate,
          exchangeParamsMultiSwapSushiV3EthUsdcDai as unknown as DexExchangeParam[],
          NULL_ADDRESS,
          undefined, // no weth calldata
        );

        expect(bytecode).toMatchSnapshot();
      });

      it('should produce correct bytecode for USDT -> USDC -> DAI  via SushiSwapV3', () => {
        const bytecode = executor01BytecodeBuilder.buildByteCode(
          priceRouteMultiSwapSushiV3UsdtUsdcDai as unknown as OptimalRate,
          exchangeParamsMultiSwapSushiV3UsdtUsdcDai as unknown as DexExchangeParam[],
          NULL_ADDRESS,
          undefined, // no weth calldata
        );

        expect(bytecode).toMatchSnapshot();
      });

      it('should produce correct bytecode for GUSD -> USDC -> ETH via SushiSwapV3 and CurveV1', () => {
        const bytecode = executor01BytecodeBuilder.buildByteCode(
          priceRouteMultiSwapSushiV3CurveV1GusdUsdcEth as unknown as OptimalRate,
          exchangeParamsMultiSwapSushiV3CurveV1GusdUsdcEth as unknown as DexExchangeParam[],
          NULL_ADDRESS,
          maybeWethCalldataMultiSwapSushiV3CurveV1GusdUsdcEth,
        );

        expect(bytecode).toMatchSnapshot();
      });

      it('should produce correct bytecode for ETH -> USDC -> GUSD via SushiSwapV3 and CurveV1', () => {
        const bytecode = executor01BytecodeBuilder.buildByteCode(
          priceRouteMultiSwapSushiV3CurveV1EthUsdcGusd as unknown as OptimalRate,
          exchangeParamsMultiSwapSushiV3CurveV1EthUsdcGusd as unknown as DexExchangeParam[],
          NULL_ADDRESS,
          maybeWethCalldataMultiSwapSushiV3CurveV1EthUsdcGusd,
        );

        expect(bytecode).toMatchSnapshot();
      });

      it('should produce correct bytecode for ETH -> USDC -> GUSD via BalancerV1 and CurveV1', () => {
        const bytecode = executor01BytecodeBuilder.buildByteCode(
          priceRouteMultiSwapBalancerV1CurveV1EthUsdcGusd as unknown as OptimalRate,
          exchangeParamsMultiSwapBalancerV1CurveV1EthUsdcGusd as unknown as DexExchangeParam[],
          NULL_ADDRESS,
          undefined, // no weth calldata
        );

        expect(bytecode).toMatchSnapshot();
      });

      it('should produce correct bytecode for WBTC -> ETH -> SUSHI via BalancerV1 and SushiSwapV3', () => {
        const bytecode = executor01BytecodeBuilder.buildByteCode(
          priceRouteMultiSwapBalancerV1SushiV3WbtcEthSushi as unknown as OptimalRate,
          exchangeParamsMultiSwapBalancerV1SushiV3WbtcEthSushi as unknown as DexExchangeParam[],
          NULL_ADDRESS,
          maybeWethCalldataMultiSwapBalancerV1SushiV3WbtcEthSushi as unknown as DepositWithdrawReturn,
        );

        expect(bytecode).toMatchSnapshot();
      });
    });
  });
});

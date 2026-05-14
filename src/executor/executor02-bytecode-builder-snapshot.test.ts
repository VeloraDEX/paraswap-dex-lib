import dotenv from 'dotenv';
dotenv.config();

import { Network, NULL_ADDRESS } from '../constants';
import {
  asDexExchangeBuildParams,
  buildExecutorSnapshotInput,
  createExecutorSnapshotContext,
} from './__test-utils__/snapshot-test-helpers';
import { Executor02BytecodeBuilder } from './Executor02BytecodeBuilder';
import { OptimalRate } from '@paraswap/core';
import { DepositWithdrawReturn } from '../dex/weth/types';

import priceRouteSimpleSwapSushiV3UniV3SushiEth from './fixtures/executor02/routes/price-route-simpleSwap-sushiv3-univ3-sushi-eth.json';
import exchangeParamsSimpleSwapSushiV3UniV3SushiEth from './fixtures/executor02/exchange-params/price-route-simpleSwap-sushiv3-univ3-sushi-eth.json';
import maybeWethCalldataSimpleSwapSushiV3UniV3SushiEth from './fixtures/executor02/maybe-weth-calldata/price-route-simpleSwap-sushiv3-univ3-sushi-eth.json';

import priceRouteSimpleSwapSushiV3UniV3EthSushi from './fixtures/executor02/routes/price-route-simpleSwap-sushiv3-univ3-eth-sushi.json';
import exchangeParamsSimpleSwapSushiV3UniV3EthSushi from './fixtures/executor02/exchange-params/price-route-simpleSwap-sushiv3-univ3-eth-sushi.json';
import maybeWethCalldataSimpleSwapSushiV3UniV3EthSushi from './fixtures/executor02/maybe-weth-calldata/price-route-simpleSwap-sushiv3-univ3-eth-sushi.json';

import priceRouteSimpleSwapSushiV3BalancerV1EthUsdc from './fixtures/executor02/routes/price-route-simpleSwap-sushiv3-balancerv1-eth-usdc.json';
import exchangeParamsSimpleSwapSushiV3BalancerV1EthUsdc from './fixtures/executor02/exchange-params/price-route-simpleSwap-sushiv3-balancerv1-eth-usdc.json';
import maybeWethCalldataSimpleSwapSushiV3BalancerV1EthUsdc from './fixtures/executor02/maybe-weth-calldata/price-route-simpleSwap-sushiv3-balancerv1-eth-usdc.json';

import priceRouteSimpleSwapSushiV3BalancerV1UsdcEth from './fixtures/executor02/routes/price-route-simpleSwap-sushiv3-balancerv1-usdc-eth.json';
import exchangeParamsSimpleSwapSushiV3BalancerV1UsdcEth from './fixtures/executor02/exchange-params/price-route-simpleSwap-sushiv3-balancerv1-usdc-eth.json';
import maybeWethCalldataSimpleSwapSushiV3BalancerV1UsdcEth from './fixtures/executor02/maybe-weth-calldata/price-route-simpleSwap-sushiv3-balancerv1-usdc-eth.json';

import priceRouteSimpleSwapUniV3CurveV1UsdtDai from './fixtures/executor02/routes/price-route-simpleSwap-univ3-curvev1-usdt-dai.json';
import exchangeParamsSimpleSwapUniV3CurveV1UsdtDai from './fixtures/executor02/exchange-params/price-route-simpleSwap-univ3-curvev1-usdt-dai.json';

import priceRouteMultiSwapUniV3SushiV3WbtcEthSushi from './fixtures/executor02/routes/price-route-multiSwap-univ3-sushiv3-wbtc-eth-sushi.json';
import exchangeParamsMultiSwapUniV3SushiV3WbtcEthSushi from './fixtures/executor02/exchange-params/price-route-multiSwap-univ3-sushiv3-wbtc-eth-sushi.json';
import maybeWethCalldataMultiSwapUniV3SushiV3WbtcEthSushi from './fixtures/executor02/maybe-weth-calldata/price-route-multiSwap-univ3-sushiv3-wbtc-eth-sushi.json';

import priceRouteMultiSwapUniV3SushiV3SushiEthWbtc from './fixtures/executor02/routes/price-route-multiSwap-univ3-sushiv3-sushi-eth-wbtc.json';
import exchangeParamsMultiSwapUniV3SushiV3SushiEthWbtc from './fixtures/executor02/exchange-params/price-route-multiSwap-univ3-sushiv3-sushi-eth-wbtc.json';
import maybeWethCalldataMultiSwapUniV3SushiV3SushiEthWbtc from './fixtures/executor02/maybe-weth-calldata/price-route-multiSwap-univ3-sushiv3-sushi-eth-wbtc.json';

import priceRouteMultiSwapBalancerV1SushiV3UniV3BalEthSushi from './fixtures/executor02/routes/price-route-multiSwap-balancerv1-sushiv3-univ3-bal-eth-sushi.json';
import exchangeParamsMultiSwapBalancerV1SushiV3UniV3BalEthSushi from './fixtures/executor02/exchange-params/price-route-multiSwap-balancerv1-sushiv3-univ3-bal-eth-sushi.json';
import maybeWethCalldataMultiSwapBalancerV1SushiV3UniV3BalEthSushi from './fixtures/executor02/maybe-weth-calldata/price-route-multiSwap-balancerv1-sushiv3-univ3-bal-eth-sushi.json';

import priceRouteMultiSwapMaverickv1SushiV3Univ3EthUsdcMav from './fixtures/executor02/routes/price-route-multiSwap-maverickv1-sushiv3-univ3-eth-usdc-mav.json';
import exchangeParamsMultiSwapMaverickv1SushiV3Univ3EthUsdcMav from './fixtures/executor02/exchange-params/price-route-multiSwap-maverickv1-sushiv3-univ3-eth-usdc-mav.json';
import maybeWethCalldataMultiSwapMaverickv1SushiV3Univ3EthUsdcMav from './fixtures/executor02/maybe-weth-calldata/price-route-multiSwap-maverickv1-sushiv3-univ3-eth-usdc-mav.json';

import priceRouteMultiSwapUniV3UsdtDaiEth from './fixtures/executor02/routes/price-route-multiswap-univ3-usdt-dai-eth.json';
import exchangeParamsMultiSwapUniV3UsdtDaiEth from './fixtures/executor02/exchange-params/price-route-multiswap-univ3-usdt-dai-eth.json';
import maybeWethCalldataMultiSwapUniV3UsdtDaiEth from './fixtures/executor02/maybe-weth-calldata/price-route-multiswap-univ3-usdt-dai-eth.json';

import priceRouteMultiSwapCurveV1UniV3DaiUsdcEth from './fixtures/executor02/routes/price-route-multiswap-curvev1-univ3-dai-usdc-eth.json';
import exchangeParamsMultiSwapCurveV1UniV3DaiUsdcEth from './fixtures/executor02/exchange-params/price-route-multiswap-curvev1-univ3-dai-usdc-eth.json';
import maybeWethCalldataMultiSwapCurveV1UniV3DaiUsdcEth from './fixtures/executor02/maybe-weth-calldata/price-route-multiswap-curvev1-univ3-dai-usdc-eth.json';

function buildExecutor02ByteCode(
  builder: Executor02BytecodeBuilder,
  priceRoute: OptimalRate,
  exchangeParams: ReturnType<typeof asDexExchangeBuildParams>,
  sender: string,
  wethPlan?: DepositWithdrawReturn,
): string {
  return builder.buildByteCode(
    buildExecutorSnapshotInput(priceRoute, exchangeParams, sender, wethPlan),
  );
}

describe('Executor02BytecodeBuilder Snapshot tests', () => {
  let executor02BytecodeBuilder: Executor02BytecodeBuilder;
  beforeEach(() => {
    const network = Network.MAINNET;
    executor02BytecodeBuilder = new Executor02BytecodeBuilder(
      createExecutorSnapshotContext(network),
    );
  });

  describe('buildByteCode', () => {
    describe('SimpleSwap', () => {
      it('should produce correct bytecode for simpleSwap ETH -> SUSHI via SushiSwapV3 and UniswapV3', () => {
        const bytecode = buildExecutor02ByteCode(
          executor02BytecodeBuilder,
          priceRouteSimpleSwapSushiV3UniV3SushiEth as unknown as OptimalRate,
          asDexExchangeBuildParams(
            exchangeParamsSimpleSwapSushiV3UniV3SushiEth,
          ),
          NULL_ADDRESS,
          maybeWethCalldataSimpleSwapSushiV3UniV3SushiEth as unknown as DepositWithdrawReturn,
        );

        expect(bytecode).toMatchSnapshot();
      });

      it('should produce correct bytecode for simpleSwap SUSHI -> ETH via SushiSwapV3 and UniswapV3', () => {
        const bytecode = buildExecutor02ByteCode(
          executor02BytecodeBuilder,
          priceRouteSimpleSwapSushiV3UniV3EthSushi as unknown as OptimalRate,
          asDexExchangeBuildParams(
            exchangeParamsSimpleSwapSushiV3UniV3EthSushi,
          ),
          NULL_ADDRESS,
          maybeWethCalldataSimpleSwapSushiV3UniV3EthSushi as unknown as DepositWithdrawReturn,
        );

        expect(bytecode).toMatchSnapshot();
      });

      it('should produce correct bytecode for simpleSwap ETH -> USDC via SushiSwapV3 and BalancerV1', () => {
        const bytecode = buildExecutor02ByteCode(
          executor02BytecodeBuilder,
          priceRouteSimpleSwapSushiV3BalancerV1EthUsdc as unknown as OptimalRate,
          asDexExchangeBuildParams(
            exchangeParamsSimpleSwapSushiV3BalancerV1EthUsdc,
          ),
          NULL_ADDRESS,
          maybeWethCalldataSimpleSwapSushiV3BalancerV1EthUsdc as unknown as DepositWithdrawReturn,
        );

        expect(bytecode).toMatchSnapshot();
      });

      it('should produce correct bytecode for simpleSwap USDC -> ETH via SushiSwapV3 and BalancerV1', () => {
        const bytecode = buildExecutor02ByteCode(
          executor02BytecodeBuilder,
          priceRouteSimpleSwapSushiV3BalancerV1UsdcEth as unknown as OptimalRate,
          asDexExchangeBuildParams(
            exchangeParamsSimpleSwapSushiV3BalancerV1UsdcEth,
          ),
          NULL_ADDRESS,
          maybeWethCalldataSimpleSwapSushiV3BalancerV1UsdcEth as unknown as DepositWithdrawReturn,
        );

        expect(bytecode).toMatchSnapshot();
      });

      it('should produce correct bytecode for simpleSwap USDT -> DAI via UniswapV3 and CurveV1', () => {
        const bytecode = buildExecutor02ByteCode(
          executor02BytecodeBuilder,
          priceRouteSimpleSwapUniV3CurveV1UsdtDai as unknown as OptimalRate,
          asDexExchangeBuildParams(exchangeParamsSimpleSwapUniV3CurveV1UsdtDai),
          NULL_ADDRESS,
          undefined, // no weth calldata
        );

        expect(bytecode).toMatchSnapshot();
      });
    });

    describe('MultiSwap', () => {
      it('should produce correct bytecode for multiSwap WBTC -> ETH -> SUSHI  via SushiSwapV3 and UniswapV3', () => {
        const bytecode = buildExecutor02ByteCode(
          executor02BytecodeBuilder,
          priceRouteMultiSwapUniV3SushiV3WbtcEthSushi as unknown as OptimalRate,
          asDexExchangeBuildParams(
            exchangeParamsMultiSwapUniV3SushiV3WbtcEthSushi,
          ),
          NULL_ADDRESS,
          maybeWethCalldataMultiSwapUniV3SushiV3WbtcEthSushi, // no weth calldata
        );

        expect(bytecode).toMatchSnapshot();
      });

      it('should produce correct bytecode for multiswap SUSHI -> ETH -> WBTC via SushiSwapV3 and UniswapV3', () => {
        const bytecode = buildExecutor02ByteCode(
          executor02BytecodeBuilder,
          priceRouteMultiSwapUniV3SushiV3SushiEthWbtc as unknown as OptimalRate,
          asDexExchangeBuildParams(
            exchangeParamsMultiSwapUniV3SushiV3SushiEthWbtc,
          ),
          NULL_ADDRESS,
          maybeWethCalldataMultiSwapUniV3SushiV3SushiEthWbtc, // no weth calldata
        );

        expect(bytecode).toMatchSnapshot();
      });

      it('should produce correct bytecode for multiswap BAL -> ETH -> SUSHI via BalancerV1,SushiSwapV3 and UniswapV3', () => {
        const bytecode = buildExecutor02ByteCode(
          executor02BytecodeBuilder,
          priceRouteMultiSwapBalancerV1SushiV3UniV3BalEthSushi as unknown as OptimalRate,
          asDexExchangeBuildParams(
            exchangeParamsMultiSwapBalancerV1SushiV3UniV3BalEthSushi,
          ),
          NULL_ADDRESS,
          maybeWethCalldataMultiSwapBalancerV1SushiV3UniV3BalEthSushi, // no weth calldata
        );

        expect(bytecode).toMatchSnapshot();
      });

      it('should produce correct bytecode for multiswap ETH -> USDC -> MAV via MaverickV1,SushiSwapV3 and UniswapV3', () => {
        const bytecode = buildExecutor02ByteCode(
          executor02BytecodeBuilder,
          priceRouteMultiSwapMaverickv1SushiV3Univ3EthUsdcMav as unknown as OptimalRate,
          asDexExchangeBuildParams(
            exchangeParamsMultiSwapMaverickv1SushiV3Univ3EthUsdcMav,
          ),
          NULL_ADDRESS,
          maybeWethCalldataMultiSwapMaverickv1SushiV3Univ3EthUsdcMav, // no weth calldata
        );

        expect(bytecode).toMatchSnapshot();
      });

      it('should produce correct bytecode for multiswap USDT -> DAI -> ETH via UniswapV3 on each path', () => {
        const bytecode = buildExecutor02ByteCode(
          executor02BytecodeBuilder,
          priceRouteMultiSwapUniV3UsdtDaiEth as unknown as OptimalRate,
          asDexExchangeBuildParams(exchangeParamsMultiSwapUniV3UsdtDaiEth),
          NULL_ADDRESS,
          maybeWethCalldataMultiSwapUniV3UsdtDaiEth, // no weth calldata
        );

        expect(bytecode).toMatchSnapshot();
      });

      it('should produce correct bytecode for multiswap DAI -> USDC -> ETH via UniswapV3 and CurveV1', () => {
        const bytecode = buildExecutor02ByteCode(
          executor02BytecodeBuilder,
          priceRouteMultiSwapCurveV1UniV3DaiUsdcEth as unknown as OptimalRate,
          asDexExchangeBuildParams(
            exchangeParamsMultiSwapCurveV1UniV3DaiUsdcEth,
          ),
          NULL_ADDRESS,
          maybeWethCalldataMultiSwapCurveV1UniV3DaiUsdcEth, // no weth calldata
        );

        expect(bytecode).toMatchSnapshot();
      });
    });
  });
});

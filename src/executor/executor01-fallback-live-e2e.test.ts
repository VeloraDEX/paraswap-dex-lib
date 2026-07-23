import dotenv from 'dotenv';
dotenv.config();

/**
 * Live e2e of the revertable fallback group, entirely within dex-lib:
 *
 * 1. Price a real UniswapV3 USDC -> WETH route on Arbitrum (pinned block).
 * 2. Rewrite the hop: primary = `Native` with a FABRICATED quote whose calldata
 *    always reverts on-chain; fallback = the real UniswapV3 swapExchange.
 *    `skipPreProcess` keeps the fabricated quote from being overwritten.
 * 3. Build the tx against the DEPLOYED fallback-capable Executor01 and simulate
 *    on Tenderly: the try (Native) reverts, the fallback (UniswapV3) fills.
 *
 * Requires .env: HTTP_PROVIDER_42161 + TENDERLY_TOKEN/TENDERLY_ACCOUNT_ID/TENDERLY_PROJECT.
 */
import { Interface } from '@ethersproject/abi';
import { LocalParaswapSDK } from '../implementations/local-paraswap-sdk';
import { TenderlySimulator, StateOverride } from '../tenderly-simulation';
import { Tokens } from '../../tests/constants-e2e';
import { ContractMethod, Network, SwapSide } from '../constants';
import { OptimalSwapExchange } from '@paraswap/core';

jest.setTimeout(300 * 1000);

const NETWORK = Network.ARBITRUM;
// Deployed fallback-capable Executor01 (Arbitrum)
const EXECUTOR01 = '0x3D546f0181b78b97c1a3C33CAb23AA443E26EAB4';

// Group step metadata marker: [20 zero bytes][size(4)][fromAmtPos(2)=0][destPos(2)][retPos(1)][ff][flag(2)]
const GROUP_STEP_RE = /0{40}[0-9a-f]{8}0000[0-9a-f]{4}[0-9a-f]{2}ff[0-9a-f]{4}/;

describe('Executor01 revertable fallback — live route (Arbitrum)', () => {
  it('primary Native reverts on-chain; UniswapV3 fallback fills in the same tx', async () => {
    const tokens = Tokens[NETWORK];
    const srcToken = tokens['USDC'];
    const destToken = tokens['WETH'];
    const amount = (10n * 10n ** 6n).toString(); // 10 USDC

    const sdk = new LocalParaswapSDK(NETWORK, ['UniswapV3'], '');
    await sdk.initializePricing?.();

    try {
      // 1. Real route for the same hop — this is the fallback venue.
      const priceRoute = await sdk.getPrices(
        srcToken,
        destToken,
        BigInt(amount),
        SwapSide.SELL,
        ContractMethod.swapExactAmountIn,
      );
      const swap = priceRoute.bestRoute[0].swaps[0];
      const realSe = swap.swapExchanges[0];
      expect(realSe.exchange).toBe('UniswapV3');

      // 2. Manufacture the hop: primary = Native with an always-reverting
      //    fabricated quote (transferFrom with no allowance), fallback = real UniV3.
      const erc20 = new Interface([
        'function transferFrom(address,address,uint256)',
      ]);
      const revertingCalldata = erc20.encodeFunctionData('transferFrom', [
        '0x000000000000000000000000000000000000dEaD',
        EXECUTOR01,
        amount,
      ]);

      const manufactured: OptimalSwapExchange<any> = {
        exchange: 'Native',
        srcAmount: realSe.srcAmount,
        destAmount: realSe.destAmount,
        percent: 100,
        data: {
          quote: {
            txRequest: {
              target: srcToken.address, // USDC.transferFrom(dead, ...) -> reverts
              calldata: revertingCalldata,
              value: '0',
            },
          },
        },
        fallback: { ...realSe },
      };
      swap.swapExchanges = [manufactured];

      // 3. Build (fabricated quote must survive) and simulate at the pinned block.
      sdk.skipPreProcess = true;
      const userAddress = TenderlySimulator.DEFAULT_OWNER;
      const minMaxAmount = (BigInt(priceRoute.destAmount) * 9900n) / 10000n;
      const swapParams = await sdk.buildTransaction(
        priceRoute,
        minMaxAmount,
        userAddress,
      );

      // The calldata carries a 0xFF group step.
      expect(swapParams.data!.replace('0x', '')).toMatch(GROUP_STEP_RE);

      const tenderlySimulator = TenderlySimulator.getInstance();
      const stateOverride: StateOverride = {};
      const amountToFund = BigInt(priceRoute.srcAmount) * 2n;
      await tenderlySimulator.addTokenBalanceOverride(
        stateOverride,
        NETWORK,
        srcToken.address,
        userAddress,
        amountToFund,
      );
      await tenderlySimulator.addAllowanceOverride(
        stateOverride,
        NETWORK,
        srcToken.address,
        userAddress,
        priceRoute.contractAddress,
        amountToFund,
      );

      const { simulation } = await tenderlySimulator.simulateTransaction({
        chainId: NETWORK,
        from: swapParams.from!,
        to: swapParams.to!,
        data: swapParams.data!,
        value: swapParams.value ?? '0',
        blockNumber: priceRoute.blockNumber,
        stateOverride,
      });

      console.log(
        `simulation: https://dashboard.tenderly.co/simulator/${simulation.id}`,
      );

      // Success means the fallback filled: the primary's calldata is a
      // guaranteed revert, so the tx can only succeed through the group.
      expect(simulation.status).toBe(true);
    } finally {
      await sdk.releaseResources?.();
    }
  });
});

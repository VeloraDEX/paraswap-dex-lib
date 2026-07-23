import dotenv from 'dotenv';
dotenv.config();

/**
 * Live e2e of the revertable fallback group on Executor02, entirely within
 * dex-lib — the split-member case:
 *
 * 1. Price a real UniswapV3 USDC -> WETH route on Arbitrum (pinned block).
 * 2. Rewrite the hop into a 50/50 vertical split:
 *      member A = `Native` with a FABRICATED always-reverting quote, carrying a
 *                 fallback = real UniswapV3 quoted at the slice;
 *      member B = real UniswapV3 (its own slice).
 *    Route shape -> VERTICAL_BRANCH -> Executor02; the group nests inside
 *    member A's path framing.
 * 3. Build + simulate on Tenderly against the deployed Executor02: member A's
 *    try reverts (contained), its fallback fills the slice, member B unaffected.
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

// Group step metadata marker: [20 zero bytes][size(4)][fromAmtPos(2)=0][destPos(2)][retPos(1)][ff][flag(2)]
const GROUP_STEP_RE = /0{40}[0-9a-f]{8}0000[0-9a-f]{4}[0-9a-f]{2}ff[0-9a-f]{4}/;

describe('Executor02 revertable fallback — live split route (Arbitrum)', () => {
  it('split member: Native try reverts; its UniswapV3 fallback fills the slice', async () => {
    const tokens = Tokens[NETWORK];
    const srcToken = tokens['USDC'];
    const destToken = tokens['WETH'];
    const amount = (10n * 10n ** 6n).toString(); // 10 USDC

    const sdk = new LocalParaswapSDK(NETWORK, ['UniswapV3'], '');
    await sdk.initializePricing?.();

    try {
      // 1. Real route for the hop — source of the sibling member and the fallback.
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

      // 2. Rewrite into a 50/50 vertical split.
      const halfSrc = BigInt(realSe.srcAmount) / 2n;
      const halfDest = BigInt(realSe.destAmount) / 2n;

      const erc20 = new Interface([
        'function transferFrom(address,address,uint256)',
      ]);
      const revertingCalldata = erc20.encodeFunctionData('transferFrom', [
        '0x000000000000000000000000000000000000dEaD',
        '0x000000000000000000000000000000000000bEEF',
        halfSrc,
      ]);

      const memberA: OptimalSwapExchange<any> = {
        exchange: 'Native',
        srcAmount: halfSrc.toString(),
        destAmount: halfDest.toString(),
        percent: 50,
        data: {
          quote: {
            txRequest: {
              target: srcToken.address, // USDC.transferFrom(dead, ...) -> reverts
              calldata: revertingCalldata,
              value: '0',
            },
          },
        },
        // fallback for the same hop, quoted at the member's slice
        fallback: {
          ...realSe,
          srcAmount: halfSrc.toString(),
          destAmount: halfDest.toString(),
          percent: 50,
        },
      };
      const memberB = {
        ...realSe,
        srcAmount: (BigInt(realSe.srcAmount) - halfSrc).toString(),
        destAmount: halfDest.toString(),
        percent: 50,
      };
      swap.swapExchanges = [memberA, memberB];

      // 3. Build (fabricated quote must survive) and simulate at the pinned block.
      sdk.skipPreProcess = true;
      const userAddress = TenderlySimulator.DEFAULT_OWNER;
      // Extra slack: the same pool fills both slices sequentially.
      const minMaxAmount = (BigInt(priceRoute.destAmount) * 9800n) / 10000n;
      const swapParams = await sdk.buildTransaction(
        priceRoute,
        minMaxAmount,
        userAddress,
      );

      // The calldata carries a 0xFF group step (nested in member A's path).
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

      // Success means member A filled via its fallback: its try is a guaranteed
      // revert, and Augustus' min-out needs both slices delivered.
      expect(simulation.status).toBe(true);
    } finally {
      await sdk.releaseResources?.();
    }
  });
});

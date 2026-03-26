/* eslint-disable no-console */
import { TenderlySimulator, StateOverride } from './tenderly-simulation';
import {
  ContractMethod,
  ETHER_ADDRESS,
  Network,
  SwapSide,
} from '../src/constants';
import { Token } from '../src/types';
import { LocalParaswapSDK } from '../src/implementations/local-paraswap-sdk';
import { assert } from 'ts-essentials';
import { AUGUSTUS_V6_INTERFACE } from './utils-e2e';
import { BigNumber } from 'ethers';
import { sleep } from './utils';

const DEFAULT_AMOUNT_OFFSET = 5n;

/**
 * Modifies the top-level Augustus V6 calldata to shift fromAmount and
 * toAmount by a small offset. This simulates what happens when a client
 * builds calldata for a swap and then dynamically changes the amounts at
 * execution time. The executor should propagate these top-level amount
 * changes into the individual DEX calldata (via insertFromAmount).
 */
function tweakAmounts(
  data: string,
  contractMethod: ContractMethod,
  offset: bigint,
): string {
  const decoded = AUGUSTUS_V6_INTERFACE.decodeFunctionData(
    contractMethod,
    data,
  );

  const swapData = decoded.swapData;

  const newSwapData = {
    srcToken: swapData.srcToken,
    destToken: swapData.destToken,
    fromAmount: BigNumber.from(swapData.fromAmount).add(offset.toString()),
    toAmount: BigNumber.from(swapData.toAmount).add(offset.toString()),
    quotedAmount: swapData.quotedAmount,
    metadata: swapData.metadata,
    beneficiary: swapData.beneficiary,
  };

  return AUGUSTUS_V6_INTERFACE.encodeFunctionData(contractMethod, [
    decoded.executor,
    newSwapData,
    decoded.partnerAndFee,
    decoded.permit,
    decoded.executorData,
  ]);
}

export async function testInsertAmounts(
  srcToken: Token,
  destToken: Token,
  amount: string,
  side: SwapSide,
  dexKey: string,
  contractMethod: ContractMethod,
  network: Network,
  poolIdentifiers?: { [key: string]: string[] | null } | null,
  amountOffset: bigint = DEFAULT_AMOUNT_OFFSET,
  sleepMs?: number,
) {
  const sdk = new LocalParaswapSDK(network, dexKey, '');
  await sdk.initializePricing?.();
  // if sleepMs is provided, pause simulation for specified time
  if (sleepMs) {
    await sleep(sleepMs);
  }

  const priceRoute = await sdk.getPrices(
    srcToken,
    destToken,
    BigInt(amount),
    side,
    contractMethod,
    poolIdentifiers,
  );
  console.log('Price Route:', JSON.stringify(priceRoute, null, 2));

  const tenderlySimulator = TenderlySimulator.getInstance();
  const userAddress = TenderlySimulator.DEFAULT_OWNER;
  const stateOverride: StateOverride = {};

  const amountToFund = BigInt(priceRoute.srcAmount) * 2n;
  if (srcToken.address.toLowerCase() === ETHER_ADDRESS) {
    tenderlySimulator.addBalanceOverride(
      stateOverride,
      userAddress,
      amountToFund,
    );
  } else {
    await tenderlySimulator.addTokenBalanceOverride(
      stateOverride,
      network,
      srcToken.address,
      userAddress,
      amountToFund,
    );
    await tenderlySimulator.addAllowanceOverride(
      stateOverride,
      network,
      srcToken.address,
      userAddress,
      priceRoute.contractAddress,
      amountToFund,
    );
  }

  const slippage = 100n;
  const minMaxAmount =
    (side === SwapSide.SELL
      ? BigInt(priceRoute.destAmount) * (10000n - slippage)
      : BigInt(priceRoute.srcAmount) * (10000n + slippage)) / 10000n;

  const swapParams = await sdk.buildTransaction(
    priceRoute,
    minMaxAmount,
    userAddress,
  );
  assert(
    swapParams.to !== undefined,
    'Transaction params missing `to` property',
  );

  // Tweak the amounts before simulating
  const tweakedData = tweakAmounts(
    swapParams.data,
    contractMethod,
    amountOffset,
  );

  const simulationRequest = {
    chainId: network,
    from: swapParams.from,
    to: swapParams.to,
    data: tweakedData,
    value: swapParams.value,
    blockNumber: priceRoute.blockNumber,
    stateOverride,
  };

  const { transaction, simulation } =
    await tenderlySimulator.simulateTransaction(simulationRequest);

  if (sdk.releaseResources) {
    await sdk.releaseResources();
  }

  expect(simulation.status).toEqual(true);

  const decodedOutput = AUGUSTUS_V6_INTERFACE.decodeFunctionResult(
    contractMethod,
    transaction.transaction_info.call_trace.output,
  );

  const expectedAmount = BigNumber.from(
    side === SwapSide.SELL ? priceRoute.destAmount : priceRoute.srcAmount,
  );
  const simulatedAmount: BigNumber =
    side === SwapSide.SELL
      ? decodedOutput.receivedAmount
      : decodedOutput.spentAmount;
  const diff = expectedAmount.sub(simulatedAmount).abs();

  console.log(`Expected amount: ${expectedAmount.toString()}`);
  console.log(`Simulated amount: ${simulatedAmount.toString()}`);
  console.log(`Difference: ${diff.toString()}`);
}

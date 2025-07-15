import { OptimalRate, SwapSide } from '@paraswap/core';
import { ETHER_ADDRESS } from '../../src/constants';
import {
  IParaSwapSDK,
  LocalParaswapSDK,
} from '../../src/implementations/local-paraswap-sdk';
import { TenderlySimulator, StateOverride } from '../tenderly-simulation';
import { assert } from 'ts-essentials';

export type ContractsAugustusV6 = {
  AugustusV6: string;
  Executor01: string;
  Executor02: string;
  Executor03: string;
};

const getAllExchanges = (data: OptimalRate): string[] => {
  const exchanges = new Set<string>();

  data.bestRoute.forEach(route => {
    route.swaps.forEach(swap => {
      swap.swapExchanges.forEach(swapExchange => {
        exchanges.add(swapExchange.exchange);
      });
    });
  });

  return Array.from(exchanges);
};

export async function runE2ETest(
  priceRoute: OptimalRate,
  senderAddress: string,
  contracts: ContractsAugustusV6,
) {
  // extract data from priceRoute
  const { network, srcToken, side, srcAmount } = priceRoute;
  // log the route for visibility
  console.log('Price Route:', JSON.stringify(priceRoute, null, 2));
  // The API currently doesn't allow for specifying poolIdentifiers
  const paraswap: IParaSwapSDK = new LocalParaswapSDK(
    network,
    getAllExchanges(priceRoute),
    '',
  );
  paraswap.dexHelper!.config.data.augustusV6Address = contracts.AugustusV6;
  paraswap.dexHelper!.config.data.executorsAddresses = { ...contracts };
  // initialize pricing
  await paraswap.initializePricing?.();
  // prepare state overrides
  const tenderlySimulator = TenderlySimulator.getInstance();
  // init `StateOverride` object
  const stateOverride: StateOverride = {};
  // fund x2 just in case
  const amountToFund = BigInt(srcAmount) * 2n;
  // add allowance override to Augustus
  if (srcToken.toLowerCase() !== ETHER_ADDRESS) {
    await tenderlySimulator.addTokenBalanceOverride(
      stateOverride,
      network,
      srcToken,
      senderAddress,
      amountToFund,
    );
    await tenderlySimulator.addAllowanceOverride(
      stateOverride,
      network,
      srcToken,
      senderAddress,
      contracts.AugustusV6,
      amountToFund,
    );
  }
  // Calculate slippage. Default is 1%
  const _slippage = BigInt(100);
  const minMaxAmount =
    (side === SwapSide.SELL
      ? BigInt(priceRoute.destAmount) * (10000n - _slippage)
      : BigInt(priceRoute.srcAmount) * (10000n + _slippage)) / 10000n;
  const swapParams = await paraswap.buildTransaction(
    priceRoute,
    minMaxAmount,
    senderAddress,
  );
  assert(
    swapParams.to !== undefined,
    'Transaction params missing `to` property',
  );
  // assemble `SimulationRequest`
  const { from, to, data, value } = swapParams;
  const simulationRequest = {
    chainId: network,
    from,
    to,
    data,
    value,
    blockNumber: priceRoute.blockNumber,
    stateOverride,
  };
  // simulate the transaction with overrides
  const simulation = await tenderlySimulator.simulateTransaction(
    simulationRequest,
  );
  // release
  if (paraswap.releaseResources) {
    await paraswap.releaseResources();
  }
  // assert simulation status
  expect(simulation.status).toEqual(true);
}

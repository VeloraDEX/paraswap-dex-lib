import type { BuildInput } from '../../../src/generic-swap-transaction-builder/resolved';
import type { OptimalSwap, OptimalSwapExchange } from '../../../src/types';
import { loadResolvedBuildFixtures } from './resolved-build-loader';
import type { ResolvedBuildSuccessFixture } from './resolved-build-schema';
import {
  type BuildRequestJson,
  type GoPublicBuilderFixture,
  type PriceRouteJson,
} from './go-public-builder-schema';
import { writeGoPublicBuilderFixtures } from './go-public-builder-loader';

const PHASE_1_FIXTURE_NAMES = ['executor01-simple-sell-approved'];

type PublicBuilderOptimalSwap = OptimalSwap & {
  srcAmount?: string;
  destAmount?: string;
};

function main(): void {
  writeGoPublicBuilderFixtures(buildPhase1Fixtures());
}

export function buildPhase1Fixtures(): GoPublicBuilderFixture[] {
  return PHASE_1_FIXTURE_NAMES.map(name =>
    buildFixtureFromResolvedFixture(findResolvedGenericFixture(name)),
  );
}

function findResolvedGenericFixture(name: string): ResolvedBuildSuccessFixture {
  const fixture = loadResolvedBuildFixtures()
    .map(entry => entry.fixture)
    .find(
      (candidate): candidate is ResolvedBuildSuccessFixture =>
        candidate.name === name && candidate.kind === 'generic',
    );

  if (!fixture) {
    throw new Error(`missing resolved generic fixture ${name}`);
  }
  if (!fixture.orchestration?.priceRoute) {
    throw new Error(`${name}: missing orchestration priceRoute`);
  }

  return fixture;
}

function buildFixtureFromResolvedFixture(
  fixture: ResolvedBuildSuccessFixture,
): GoPublicBuilderFixture {
  const input = fixture.input as BuildInput;
  const fee = input.fee as BuildInput['fee'] & {
    partnerAddress: string;
    partnerFeePercent: string;
    referrerAddress?: string;
    takeSurplus: boolean;
    isCapSurplus: boolean;
    isSurplusToUser: boolean;
    isDirectFeeTransfer: boolean;
  };
  const priceRoute = toPublicPriceRoute(fixture.orchestration!.priceRoute);

  const request: BuildRequestJson = {
    priceRoute,
    minMaxAmount: fixture.orchestration?.minMaxAmount ?? input.minMaxAmount,
    userAddress: input.userAddress,
    partnerAddress: fee.partnerAddress,
    partnerFeePercent: fee.partnerFeePercent,
    takeSurplus: fee.takeSurplus,
    isSurplusToUser: fee.isSurplusToUser,
    isDirectFeeTransfer: fee.isDirectFeeTransfer,
    deadline: '0',
    uuid: input.uuid,
  };

  if (fixture.orchestration?.quotedAmount !== undefined) {
    request.quotedAmount = fixture.orchestration.quotedAmount;
  }
  if (fee.referrerAddress !== undefined) {
    request.referrerAddress = fee.referrerAddress;
  }
  if (fee.isCapSurplus !== true) {
    request.isCapSurplus = fee.isCapSurplus;
  }
  if (input.gas?.gasPrice) {
    request.gasPrice = input.gas.gasPrice;
  }
  if (input.gas?.maxFeePerGas) {
    request.maxFeePerGas = input.gas.maxFeePerGas;
  }
  if (input.gas?.maxPriorityFeePerGas) {
    request.maxPriorityFeePerGas = input.gas.maxPriorityFeePerGas;
  }
  if (input.permit !== '0x') {
    request.permit = input.permit;
  }
  if (input.beneficiary !== '0x0000000000000000000000000000000000000000') {
    request.beneficiary = input.beneficiary;
  }

  return {
    schemaVersion: 1,
    name: fixture.name,
    description: `Public generic builder contract fixture derived from ${fixture.name}.`,
    kind: 'generic-public',
    dexKeys: [...new Set(collectDexKeys(priceRoute))].sort(),
    input: {
      request,
      options: {
        skipApprovalCheck: false,
      },
    },
    expectedResolvedInput: input,
    expectedParams: fixture.expectedParams,
    expectedTx: fixture.expectedTx,
  };
}

function toPublicPriceRoute(priceRoute: any): PriceRouteJson {
  return {
    network: priceRoute.network,
    blockNumber: priceRoute.blockNumber,
    contractMethod: priceRoute.contractMethod,
    side: priceRoute.side,
    srcToken: priceRoute.srcToken,
    destToken: priceRoute.destToken,
    srcAmount: priceRoute.srcAmount,
    destAmount: priceRoute.destAmount,
    bestRoute: priceRoute.bestRoute.map((route: any) => ({
      percent: route.percent,
      swaps: route.swaps.map((swap: PublicBuilderOptimalSwap) => ({
        srcToken: swap.srcToken,
        destToken: swap.destToken,
        srcAmount: swap.srcAmount,
        destAmount: swap.destAmount,
        swapExchanges: swap.swapExchanges.map(
          (swapExchange: OptimalSwapExchange<any>) => ({
            exchange: swapExchange.exchange,
            percent: swapExchange.percent,
            srcAmount: swapExchange.srcAmount,
            destAmount: swapExchange.destAmount,
            data: swapExchange.data,
          }),
        ),
      })),
    })),
  };
}

function collectDexKeys(priceRoute: PriceRouteJson): string[] {
  return priceRoute.bestRoute.flatMap(route =>
    route.swaps.flatMap(swap =>
      swap.swapExchanges.map(swapExchange => swapExchange.exchange),
    ),
  );
}

if (require.main === module) {
  main();
}

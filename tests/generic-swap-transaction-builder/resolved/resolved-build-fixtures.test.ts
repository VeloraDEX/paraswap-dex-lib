import { ContractMethodV6 } from '@paraswap/core';
import {
  assertCanonicalFixtureBytes,
  loadResolvedBuildFixtures,
} from '../fixtures/resolved-build-loader';
import {
  captureBoundaryError,
  replayPublicBuilderForFixture,
  runBoundarySuccessFixture,
} from '../fixtures/resolved-build-fixture-cases';
import { expectTxObjectToEqual } from '../fixtures/resolved-build-calldata-diff';
import {
  getGoContractFixtureFields,
  validateResolvedBuildFixture,
  COVERAGE_TAGS,
  type CoverageTag,
  type ResolvedBuildFixture,
  type ResolvedBuildNegativeFixture,
  type ResolvedBuildSuccessFixture,
} from '../fixtures/resolved-build-schema';

const REQUIRED_FIXTURE_NAMES = [
  'augustus-rfq-try-batch-fill',
  'balancer-v2-buy',
  'balancer-v2-sell',
  'curve-v1-sell',
  'curve-v2-sell',
  'direct-side-method-mismatch',
  'duplicate-resolved-leg',
  'edge-nonempty-permit',
  'edge-zero-quoted-amount',
  'executor-address-mismatch',
  'executor01-eth-weth-deposit',
  'executor01-multiswap-sell',
  'executor01-simple-sell-approval-missing',
  'executor01-simple-sell-approved',
  'executor01-simple-sell-beneficiary',
  'executor01-weth-eth-withdraw',
  'executor02-megaswap-sell',
  'executor02-multiswap-sell',
  'executor02-vertical-branch-sell',
  'executor03-buy',
  'fee-direct-transfer',
  'fee-nonzero-partner',
  'fee-referrer',
  'fee-surplus-to-user',
  'fee-take-surplus',
  'invalid-direct-side',
  'lite-psm',
  'malformed-address',
  'malformed-amount',
  'malformed-hex-bytes',
  'malformed-weth-plan',
  'missing-resolved-leg',
  'need-unwrap-native',
  'non-boolean-need-wrap-native',
  'out-of-route-resolved-leg',
  'permit2-approval',
  'same-token-internal-split',
  'transfer-src-token-before-swap',
  'uniswap-v2-buy',
  'uniswap-v2-sell',
  'uniswap-v3-buy',
  'uniswap-v3-sell',
  'unsupported-direct-method',
  'unsupported-generic-method',
  'weth-only-eth-to-weth',
] as const;

const loadedFixtures = loadResolvedBuildFixtures();
const successFixtures = loadedFixtures.filter(
  (
    entry,
  ): entry is {
    filePath: string;
    fixture: ResolvedBuildSuccessFixture;
    raw: string;
  } => entry.fixture.kind !== 'negative',
);
const negativeFixtures = loadedFixtures.filter(
  (
    entry,
  ): entry is {
    filePath: string;
    fixture: ResolvedBuildNegativeFixture;
    raw: string;
  } => entry.fixture.kind === 'negative',
);

describe('resolved build golden fixtures', () => {
  it('loads every committed fixture with canonical JSON bytes', () => {
    expect(getFixtureNames()).toEqual(
      expect.arrayContaining([...REQUIRED_FIXTURE_NAMES]),
    );
    expect(loadedFixtures.length).toBeGreaterThanOrEqual(
      REQUIRED_FIXTURE_NAMES.length,
    );

    loadedFixtures.forEach(({ fixture, raw, filePath }) => {
      assertCanonicalFixtureBytes(fixture, raw, filePath);
    });
  });

  it('keeps TypeScript orchestration metadata out of Go contract fields', () => {
    const contractFields = getGoContractFixtureFields(
      successFixtures[0].fixture,
    ) as Record<string, unknown>;

    expect(contractFields).not.toHaveProperty('orchestration');
    expect(contractFields).not.toHaveProperty('boundaryOnly');
    expect(contractFields).not.toHaveProperty('boundaryOnlyReason');
  });

  it('rejects unsupported schema versions and unknown coverage tags', () => {
    const fixture = clone(loadedFixtures[0].fixture);

    expect(() =>
      validateResolvedBuildFixture(
        { ...fixture, schemaVersion: 2 },
        'schema-version-test',
      ),
    ).toThrow('unsupported schemaVersion 2; expected 1');

    expect(() =>
      validateResolvedBuildFixture(
        { ...fixture, coverage: ['unknown-tag'] },
        'coverage-test',
      ),
    ).toThrow('unknown coverage tag unknown-tag');
  });

  it('covers the required generic and direct fixture matrix', () => {
    expect(getCoverageTags()).toEqual(
      expect.arrayContaining<CoverageTag>([
        'executor01',
        'executor02',
        'executor03',
        'executor-weth',
        'simple-swap',
        'multi-swap',
        'mega-swap',
        'vertical-branch',
        'weth-deposit',
        'weth-withdraw',
        'weth-only',
        'same-token-internal-split',
        'permit2-approval',
        'transfer-src-token-before-swap',
        'need-unwrap-native',
        'fee-nonzero',
        'fee-take-surplus',
        'fee-surplus-to-user',
        'fee-direct-transfer',
        'fee-referrer',
        'permit-nonempty',
        'zero-quoted-amount',
        'native-source',
        'null-beneficiary',
        'beneficiary-nonnull',
        'validation-error',
      ]),
    );
    expect(getUnusedCoverageTags()).toEqual([]);

    expect(getDirectContractMethods()).toEqual(
      new Set([
        ContractMethodV6.swapExactAmountInOnUniswapV2,
        ContractMethodV6.swapExactAmountOutOnUniswapV2,
        ContractMethodV6.swapExactAmountInOnUniswapV3,
        ContractMethodV6.swapExactAmountOutOnUniswapV3,
        ContractMethodV6.swapExactAmountInOnBalancerV2,
        ContractMethodV6.swapExactAmountOutOnBalancerV2,
        ContractMethodV6.swapExactAmountInOnCurveV1,
        ContractMethodV6.swapExactAmountInOnCurveV2,
        ContractMethodV6.swapExactAmountInOutOnMakerPSM,
        ContractMethodV6.swapOnAugustusRFQTryBatchFill,
      ]),
    );
  });

  it.each(successFixtures)(
    'matches boundary output for $fixture.name',
    ({ fixture }) => {
      const output = runBoundarySuccessFixture(fixture);

      expect(output.params).toEqual(fixture.expectedParams);
      expectTxObjectToEqual(output.txObject, fixture.expectedTx);
    },
  );

  it.each(successFixtures)(
    'replays public builder parity for $fixture.name',
    async ({ fixture }) => {
      const output = await replayPublicBuilderForFixture(fixture);

      expect(output.params).toEqual(fixture.expectedParams);
      expectTxObjectToEqual(output.tx, fixture.expectedTx);
    },
  );

  it.each(negativeFixtures)(
    'matches boundary validation error for $fixture.name',
    ({ fixture }) => {
      expect(captureBoundaryError(fixture.input)).toBe(fixture.expectedError);
    },
  );
});

function getFixtureNames(): string[] {
  return loadedFixtures.map(({ fixture }) => fixture.name).sort();
}

function getCoverageTags(): CoverageTag[] {
  return [
    ...new Set(loadedFixtures.flatMap(({ fixture }) => fixture.coverage)),
  ].sort();
}

function getUnusedCoverageTags(): CoverageTag[] {
  const usedTags = new Set(getCoverageTags());

  return COVERAGE_TAGS.filter(tag => !usedTags.has(tag));
}

function getDirectContractMethods(): Set<ContractMethodV6> {
  return new Set(
    successFixtures
      .filter(({ fixture }) => fixture.kind === 'direct')
      .map(({ fixture }) => fixture.input.contractMethod as ContractMethodV6),
  );
}

function clone<T extends ResolvedBuildFixture>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

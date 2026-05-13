import type { OptimalRate } from '@paraswap/core';
import type { DepositWithdrawReturn } from '../../../src/dex/weth/types';
import type {
  BuildInput,
  DirectBuildInput,
} from '../../../src/generic-swap-transaction-builder/resolved';
import type {
  Address,
  DexExchangeBuildParam,
  TxObject,
} from '../../../src/types';

export const RESOLVED_BUILD_SCHEMA_VERSION = 1;
// Schema bumps must include a fixture migration that rewrites every committed
// JSON fixture and an update to the schema-version rejection test.

export const COVERAGE_TAGS = [
  'generic',
  'direct',
  'negative',
  'executor01',
  'executor02',
  'executor03',
  'executor-weth',
  'simple-swap',
  'multi-swap',
  'mega-swap',
  'vertical-branch',
  'sell',
  'buy',
  'approval-present',
  'approval-missing',
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
  'duplicate-resolved-leg',
  'missing-resolved-leg',
  'out-of-route-resolved-leg',
  'malformed-address',
  'malformed-amount',
  'malformed-hex',
  'malformed-weth-plan',
  'non-boolean-need-wrap-native',
  'unsupported-method',
  'executor-address-mismatch',
  'invalid-direct-side',
  'direct-side-method-mismatch',
] as const;

export type CoverageTag = (typeof COVERAGE_TAGS)[number];

export type ResolvedBuildOrchestration = {
  priceRoute?: OptimalRate;
  exchangeParams?: DexExchangeBuildParam[];
  wethPlan?: DepositWithdrawReturn;
  approvalDecisions?: boolean[];
  directDexKey?: string;
  directDestToken?: Address;
  directDestAmount?: string;
  minMaxAmount?: string;
  quotedAmount?: string;
};

export type ResolvedBuildSuccessFixture = {
  schemaVersion: typeof RESOLVED_BUILD_SCHEMA_VERSION;
  name: string;
  kind: 'generic' | 'direct';
  description?: string;
  coverage: CoverageTag[];
  input: BuildInput | DirectBuildInput;
  expectedParams: unknown[];
  expectedTx: TxObject;
  orchestration?: ResolvedBuildOrchestration;
  boundaryOnly?: false;
};

export type ResolvedBuildBoundaryOnlySuccessFixture = Omit<
  ResolvedBuildSuccessFixture,
  'orchestration' | 'boundaryOnly'
> & {
  boundaryOnly: true;
  boundaryOnlyReason: string;
};

export type ResolvedBuildNegativeFixture = {
  schemaVersion: typeof RESOLVED_BUILD_SCHEMA_VERSION;
  name: string;
  kind: 'negative';
  description?: string;
  coverage: CoverageTag[];
  input: BuildInput | DirectBuildInput;
  expectedError: string;
};

export type ResolvedBuildFixture =
  | ResolvedBuildSuccessFixture
  | ResolvedBuildBoundaryOnlySuccessFixture
  | ResolvedBuildNegativeFixture;

const COVERAGE_TAG_SET = new Set<string>(COVERAGE_TAGS);

export function validateResolvedBuildFixture(
  fixture: unknown,
  source = '<fixture>',
): asserts fixture is ResolvedBuildFixture {
  if (!isRecord(fixture)) {
    throw new Error(`${source}: fixture must be an object`);
  }

  if (fixture.schemaVersion !== RESOLVED_BUILD_SCHEMA_VERSION) {
    throw new Error(
      `${source}: unsupported schemaVersion ${String(
        fixture.schemaVersion,
      )}; expected ${RESOLVED_BUILD_SCHEMA_VERSION}`,
    );
  }

  if (typeof fixture.name !== 'string' || fixture.name.length === 0) {
    throw new Error(`${source}: name must be a non-empty string`);
  }

  if (!Array.isArray(fixture.coverage) || fixture.coverage.length === 0) {
    throw new Error(`${source}: coverage must be a non-empty array`);
  }

  fixture.coverage.forEach(tag => {
    if (typeof tag !== 'string' || !COVERAGE_TAG_SET.has(tag)) {
      throw new Error(`${source}: unknown coverage tag ${String(tag)}`);
    }
  });

  if (!isRecord(fixture.input)) {
    throw new Error(`${source}: input must be an object`);
  }

  if (fixture.kind === 'negative') {
    if (typeof fixture.expectedError !== 'string') {
      throw new Error(`${source}: negative fixture expectedError is required`);
    }
    return;
  }

  if (fixture.kind !== 'generic' && fixture.kind !== 'direct') {
    throw new Error(`${source}: unsupported kind ${String(fixture.kind)}`);
  }

  if (!Array.isArray(fixture.expectedParams)) {
    throw new Error(`${source}: expectedParams must be an array`);
  }

  if (!isRecord(fixture.expectedTx)) {
    throw new Error(`${source}: expectedTx must be an object`);
  }

  if (fixture.boundaryOnly === true) {
    if (
      typeof fixture.boundaryOnlyReason !== 'string' ||
      fixture.boundaryOnlyReason.length === 0
    ) {
      throw new Error(
        `${source}: boundaryOnly fixtures require boundaryOnlyReason`,
      );
    }
    return;
  }

  if (!isRecord(fixture.orchestration)) {
    throw new Error(
      `${source}: success fixtures require orchestration unless boundaryOnly is true`,
    );
  }
}

export function getGoContractFixtureFields(
  fixture: ResolvedBuildFixture,
): Omit<
  ResolvedBuildFixture,
  'orchestration' | 'boundaryOnly' | 'boundaryOnlyReason'
> {
  const {
    orchestration: _orchestration,
    boundaryOnly: _boundaryOnly,
    boundaryOnlyReason: _boundaryOnlyReason,
    ...contractFields
  } = fixture as ResolvedBuildFixture & {
    orchestration?: ResolvedBuildOrchestration;
    boundaryOnly?: boolean;
    boundaryOnlyReason?: string;
  };

  return contractFields;
}

export function stableStringify(value: unknown): string {
  return `${JSON.stringify(sortObjectKeys(value), undefined, 2)}\n`;
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeys);
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      const child = value[key];

      if (child !== undefined) {
        acc[key] = sortObjectKeys(child);
      }

      return acc;
    }, {});
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

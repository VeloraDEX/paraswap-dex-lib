import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Executors } from '../../../src/executor/types';
import { stableStringify } from './resolved-build-schema';
import {
  getDefaultExecutorAddressesForGoContract,
  RESOLVED_BUILD_DEPS_SCHEMA_VERSION,
} from './resolved-build-deps';
import {
  loadResolvedBuildFixtures,
  RESOLVED_BUILD_FIXTURE_ROOT,
} from './resolved-build-loader';
import type { ResolvedBuildFixture } from './resolved-build-schema';

export const RESOLVED_BUILD_MANIFEST_SCHEMA_VERSION = 1;
export const RESOLVED_BUILD_MANIFEST_PATH = path.join(
  __dirname,
  'resolved-build-manifest.json',
);
export const RESOLVED_BUILD_DEPS_CONTRACT_PATH = path.join(
  __dirname,
  'resolved-build-deps-contract.json',
);

type ManifestBucket =
  | 'phase2GenericSuccess'
  | 'phase2GenericNegative'
  | 'phase3DirectSuccess'
  | 'phase3DirectNegative';

type ManifestEntry = {
  kind: ResolvedBuildFixture['kind'];
  name: string;
  path: string;
  sha256: string;
};

type ResolvedBuildManifest = {
  schemaVersion: typeof RESOLVED_BUILD_MANIFEST_SCHEMA_VERSION;
  buckets: Record<ManifestBucket, ManifestEntry[]>;
};

type ResolvedBuildDepsContract = {
  schemaVersion: typeof RESOLVED_BUILD_DEPS_SCHEMA_VERSION;
  executorsAddresses: Record<
    Executors.ONE | Executors.TWO | Executors.THREE,
    string
  >;
};

export function writeResolvedBuildManifest(): void {
  const manifest: ResolvedBuildManifest = {
    schemaVersion: RESOLVED_BUILD_MANIFEST_SCHEMA_VERSION,
    buckets: {
      phase2GenericSuccess: [],
      phase2GenericNegative: [],
      phase3DirectSuccess: [],
      phase3DirectNegative: [],
    },
  };

  loadResolvedBuildFixtures().forEach(({ filePath, fixture, raw }) => {
    manifest.buckets[getManifestBucket(fixture)].push({
      kind: fixture.kind,
      name: fixture.name,
      path: normalizeManifestPath(filePath),
      sha256: sha256(raw),
    });
  });

  Object.values(manifest.buckets).forEach(entries => {
    entries.sort((a, b) => a.path.localeCompare(b.path));
  });

  fs.writeFileSync(RESOLVED_BUILD_MANIFEST_PATH, stableStringify(manifest));
}

export function writeResolvedBuildDepsContract(): void {
  const contract: ResolvedBuildDepsContract = {
    schemaVersion: RESOLVED_BUILD_DEPS_SCHEMA_VERSION,
    executorsAddresses: getDefaultExecutorAddressesForGoContract(),
  };

  fs.writeFileSync(
    RESOLVED_BUILD_DEPS_CONTRACT_PATH,
    stableStringify(contract),
  );
}

function getManifestBucket(fixture: ResolvedBuildFixture): ManifestBucket {
  if (fixture.kind === 'generic') {
    return 'phase2GenericSuccess';
  }

  if (fixture.kind === 'direct') {
    return 'phase3DirectSuccess';
  }

  return hasRoutePlan(fixture.input)
    ? 'phase2GenericNegative'
    : 'phase3DirectNegative';
}

function hasRoutePlan(input: unknown): boolean {
  return (
    typeof input === 'object' &&
    input !== null &&
    !Array.isArray(input) &&
    Object.prototype.hasOwnProperty.call(input, 'routePlan')
  );
}

function normalizeManifestPath(filePath: string): string {
  return path
    .relative(RESOLVED_BUILD_FIXTURE_ROOT, filePath)
    .split(path.sep)
    .join('/');
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

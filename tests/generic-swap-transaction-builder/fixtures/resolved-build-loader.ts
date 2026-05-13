import fs from 'fs';
import path from 'path';
import {
  stableStringify,
  validateResolvedBuildFixture,
  type ResolvedBuildFixture,
} from './resolved-build-schema';

export const RESOLVED_BUILD_FIXTURE_ROOT = path.join(
  __dirname,
  'resolved-build',
);

export function loadResolvedBuildFixtures(): {
  filePath: string;
  fixture: ResolvedBuildFixture;
  raw: string;
}[] {
  return collectFixtureFiles(RESOLVED_BUILD_FIXTURE_ROOT).map(filePath => {
    const raw = fs.readFileSync(filePath, 'utf8');
    const fixture = JSON.parse(raw) as unknown;

    validateResolvedBuildFixture(fixture, filePath);

    return {
      filePath,
      fixture,
      raw,
    };
  });
}

export function assertCanonicalFixtureBytes(
  fixture: ResolvedBuildFixture,
  raw: string,
  filePath: string,
): void {
  const expectedRaw = stableStringify(fixture);

  if (raw !== expectedRaw) {
    throw new Error(`${filePath}: fixture JSON is not canonical`);
  }
}

export function writeResolvedBuildFixtures(
  fixtures: ResolvedBuildFixture[],
): void {
  const seen = new Set<string>();

  fixtures.forEach(fixture => {
    validateResolvedBuildFixture(fixture, fixture.name);

    const filePath = getFixturePath(fixture);
    seen.add(filePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, stableStringify(fixture));
  });

  collectFixtureFiles(RESOLVED_BUILD_FIXTURE_ROOT).forEach(filePath => {
    if (!seen.has(filePath)) {
      fs.unlinkSync(filePath);
    }
  });
}

function getFixturePath(fixture: ResolvedBuildFixture): string {
  const dir =
    fixture.kind === 'negative'
      ? 'negative'
      : fixture.kind === 'generic'
      ? 'generic'
      : 'direct';

  return path.join(RESOLVED_BUILD_FIXTURE_ROOT, dir, `${fixture.name}.json`);
}

function collectFixtureFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];

  const entries = fs.readdirSync(root, { withFileTypes: true });
  const files = entries.flatMap(entry => {
    const entryPath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      return collectFixtureFiles(entryPath);
    }

    return entry.name.endsWith('.json') ? [entryPath] : [];
  });

  return files.sort();
}

import fs from 'fs';
import path from 'path';
import {
  stableStringify,
  validateGoPublicBuilderFixture,
  type GoPublicBuilderFixture,
} from './go-public-builder-schema';

export const GO_PUBLIC_BUILDER_FIXTURE_ROOT = path.join(
  __dirname,
  'go-public-builder',
);

export function loadGoPublicBuilderFixtures(): {
  filePath: string;
  fixture: GoPublicBuilderFixture;
  raw: string;
}[] {
  return collectFixtureFiles(GO_PUBLIC_BUILDER_FIXTURE_ROOT).map(filePath => {
    const raw = fs.readFileSync(filePath, 'utf8');
    const fixture = JSON.parse(raw) as unknown;

    validateGoPublicBuilderFixture(fixture, filePath);
    assertGoPublicBuilderFixtureNameMatchesPath(fixture, filePath);

    return {
      filePath,
      fixture,
      raw,
    };
  });
}

export function assertGoPublicBuilderFixtureNameMatchesPath(
  fixture: Pick<GoPublicBuilderFixture, 'name'>,
  filePath: string,
): void {
  const basename = path.basename(filePath, '.json');

  if (fixture.name !== basename) {
    throw new Error(`${filePath}: name must match fixture file basename`);
  }
}

export function assertCanonicalGoPublicBuilderFixtureBytes(
  fixture: GoPublicBuilderFixture,
  raw: string,
  filePath: string,
): void {
  const expectedRaw = stableStringify(fixture);

  if (raw !== expectedRaw) {
    throw new Error(`${filePath}: fixture JSON is not canonical`);
  }
}

export function writeGoPublicBuilderFixtures(
  fixtures: GoPublicBuilderFixture[],
): void {
  const seen = new Set<string>();

  fixtures.forEach(fixture => {
    validateGoPublicBuilderFixture(fixture, fixture.name);

    const filePath = path.join(
      GO_PUBLIC_BUILDER_FIXTURE_ROOT,
      fixture.kind,
      `${fixture.name}.json`,
    );
    seen.add(filePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, stableStringify(fixture));
  });

  collectFixtureFiles(GO_PUBLIC_BUILDER_FIXTURE_ROOT).forEach(filePath => {
    if (!seen.has(filePath)) {
      fs.unlinkSync(filePath);
    }
  });
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

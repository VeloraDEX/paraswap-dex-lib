import fs from 'fs';
import path from 'path';
import {
  stableStringify,
  validateDexEncoderFixture,
  type DexEncoderFixture,
} from './dex-encoder-fixture-schema';

export const DEX_ENCODER_FIXTURE_ROOT = path.join(__dirname, 'fixtures');

export function loadDexEncoderFixtures(): {
  filePath: string;
  fixture: DexEncoderFixture;
  raw: string;
}[] {
  return collectFixtureFiles(DEX_ENCODER_FIXTURE_ROOT).map(filePath => {
    const raw = fs.readFileSync(filePath, 'utf8');
    const fixture = JSON.parse(raw) as unknown;

    validateDexEncoderFixture(fixture, filePath);

    return {
      filePath,
      fixture,
      raw,
    };
  });
}

export function assertCanonicalDexEncoderFixtureBytes(
  fixture: DexEncoderFixture,
  raw: string,
  filePath: string,
): void {
  const expectedRaw = stableStringify(fixture);

  if (raw !== expectedRaw) {
    throw new Error(`${filePath}: fixture JSON is not canonical`);
  }
}

export function writeDexEncoderFixtures(fixtures: DexEncoderFixture[]): void {
  const seen = new Set<string>();

  fixtures.forEach(fixture => {
    validateDexEncoderFixture(fixture, fixture.name);

    const filePath = getDexEncoderFixturePath(fixture);
    seen.add(filePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, stableStringify(fixture));
  });

  collectFixtureFiles(DEX_ENCODER_FIXTURE_ROOT).forEach(filePath => {
    if (!seen.has(filePath)) {
      fs.unlinkSync(filePath);
    }
  });
}

export function getDexEncoderFixturePath(
  fixture: Pick<DexEncoderFixture, 'kind' | 'name'>,
): string {
  return path.join(
    DEX_ENCODER_FIXTURE_ROOT,
    fixture.kind,
    `${fixture.name}.json`,
  );
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

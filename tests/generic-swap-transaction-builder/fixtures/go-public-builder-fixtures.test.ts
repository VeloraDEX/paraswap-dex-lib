import {
  assertCanonicalGoPublicBuilderFixtureBytes,
  assertGoPublicBuilderFixtureNameMatchesPath,
  loadGoPublicBuilderFixtures,
} from './go-public-builder-loader';
import { validateGoPublicBuilderFixture } from './go-public-builder-schema';

const REQUIRED_FIXTURE_NAMES = ['executor01-simple-sell-approved'];

const loadedFixtures = loadGoPublicBuilderFixtures();

describe('go public builder fixtures', () => {
  it('loads every committed fixture with canonical JSON bytes', () => {
    expect(loadedFixtures.map(({ fixture }) => fixture.name).sort()).toEqual(
      expect.arrayContaining(REQUIRED_FIXTURE_NAMES),
    );

    loadedFixtures.forEach(({ fixture, raw, filePath }) => {
      assertCanonicalGoPublicBuilderFixtureBytes(fixture, raw, filePath);
    });
  });

  it('rejects non-canonical fixture bytes', () => {
    const fixture = loadedFixtures[0].fixture;

    expect(() =>
      assertCanonicalGoPublicBuilderFixtureBytes(
        fixture,
        JSON.stringify(fixture),
        'non-canonical-test',
      ),
    ).toThrow('fixture JSON is not canonical');
  });

  it('requires fixture name to match file basename', () => {
    const fixture = loadedFixtures[0].fixture;

    expect(() =>
      assertGoPublicBuilderFixtureNameMatchesPath(
        fixture,
        '/fixtures/wrong-name.json',
      ),
    ).toThrow('name must match fixture file basename');
  });

  it('rejects unsupported schema versions and unknown kinds', () => {
    const fixture = loadedFixtures[0].fixture;

    expect(() =>
      validateGoPublicBuilderFixture(
        { ...fixture, schemaVersion: 2 },
        'schema-version-test',
      ),
    ).toThrow('unsupported schemaVersion 2; expected 1');

    expect(() =>
      validateGoPublicBuilderFixture(
        { ...fixture, kind: 'unknown' },
        'kind-test',
      ),
    ).toThrow('unsupported kind unknown');
  });

  it.each([
    [
      'empty dexKeys',
      (fixture: any) => ({
        ...fixture,
        dexKeys: [],
      }),
      'dexKeys must be a non-empty array',
    ],
    [
      'malformed request address',
      (fixture: any) => ({
        ...fixture,
        input: {
          ...fixture.input,
          request: {
            ...fixture.input.request,
            userAddress: '0xABC',
          },
        },
      }),
      'input.request.userAddress must be a lowercase 42-character hex address',
    ],
    [
      'malformed request amount',
      (fixture: any) => ({
        ...fixture,
        input: {
          ...fixture.input,
          request: {
            ...fixture.input.request,
            minMaxAmount: '01',
          },
        },
      }),
      'input.request.minMaxAmount must be a decimal string',
    ],
    [
      'missing options envelope',
      (fixture: any) => ({
        ...fixture,
        input: {
          request: fixture.input.request,
        },
      }),
      'input.options must be an object',
    ],
    [
      'missing skipApprovalCheck',
      (fixture: any) => ({
        ...fixture,
        input: {
          ...fixture.input,
          options: {},
        },
      }),
      'input.options.skipApprovalCheck must be boolean',
    ],
    [
      'missing expected resolved field',
      (fixture: any) => ({
        ...fixture,
        expectedResolvedInput: {},
      }),
      'expectedResolvedInput.routePlan must be an object',
    ],
    [
      'missing tx field',
      (fixture: any) => ({
        ...fixture,
        expectedTx: {},
      }),
      'expectedTx.from must be a lowercase 42-character hex address',
    ],
  ])('rejects invalid fixture shape: %s', (_name, mutate, expectedError) => {
    const fixture = loadedFixtures[0].fixture;

    expect(() =>
      validateGoPublicBuilderFixture(mutate(fixture), String(_name)),
    ).toThrow(expectedError);
  });
});

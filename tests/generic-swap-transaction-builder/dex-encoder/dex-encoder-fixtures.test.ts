import {
  buildAllDexEncoderFixtures,
  getResolvedFixtureDexCoverage,
} from './dex-encoder-fixture-cases';
import {
  assertCanonicalDexEncoderFixtureBytes,
  getDexEncoderFixturePath,
  loadDexEncoderFixtures,
} from './dex-encoder-fixture-loader';
import {
  DEX_ENCODER_FIXTURE_SCHEMA_VERSION,
  stableStringify,
  validateDexEncoderFixture,
  type DexEncoderFixture,
} from './dex-encoder-fixture-schema';

describe('DEX encoder conformance fixtures', () => {
  const loadedFixtures = loadDexEncoderFixtures();

  it('loads canonical fixture JSON', () => {
    expect(loadedFixtures.length).toBeGreaterThan(0);

    loadedFixtures.forEach(({ fixture, raw, filePath }) => {
      assertCanonicalDexEncoderFixtureBytes(fixture, raw, filePath);
    });
  });

  it('matches the generated baseline from resolved-build fixtures', () => {
    const generatedByPath = new Map(
      buildAllDexEncoderFixtures().map(fixture => [
        getDexEncoderFixturePath(fixture),
        stableStringify(fixture),
      ]),
    );

    expect(loadedFixtures.map(({ filePath }) => filePath).sort()).toEqual(
      [...generatedByPath.keys()].sort(),
    );

    loadedFixtures.forEach(({ filePath, raw }) => {
      expect(raw).toBe(generatedByPath.get(filePath));
    });
  });

  it('covers every DEX used by resolved generic and direct fixtures', () => {
    const { genericDexKeys, directDexKeys } = getResolvedFixtureDexCoverage();
    const dexParamDexKeys = uniqueDexKeys('dex-param');
    const needWrapNativeDexKeys = uniqueDexKeys('need-wrap-native');
    const directParamDexKeys = uniqueDexKeys('direct-param');

    // This is the Phase 3 minimum coverage gate: parity with the resolved-build
    // fixture surface, not a complete assertion over every V6-reachable DEX.
    expect(dexParamDexKeys).toEqual(genericDexKeys);
    expect(needWrapNativeDexKeys).toEqual(genericDexKeys);
    expect(directParamDexKeys).toEqual(directDexKeys);
  });

  it('rejects unsupported schema versions', () => {
    const fixture = mutateFixture(loadedFixtures[0].fixture, draft => {
      draft.schemaVersion = DEX_ENCODER_FIXTURE_SCHEMA_VERSION + 1;
    });

    expect(() => validateDexEncoderFixture(fixture, 'bad-fixture')).toThrow(
      'bad-fixture: unsupported schemaVersion 2; expected 1',
    );
  });

  it('rejects unknown fixture kinds', () => {
    const fixture = mutateFixture(loadedFixtures[0].fixture, draft => {
      draft.kind = 'unknown-kind';
    });

    expect(() => validateDexEncoderFixture(fixture, 'bad-fixture')).toThrow(
      'bad-fixture: unsupported kind unknown-kind',
    );
  });

  it('validates fixture input and expected output fields', () => {
    const dexParamFixture = loadedFixtures.find(
      ({ fixture }) => fixture.kind === 'dex-param',
    )!.fixture;
    const malformedInput = mutateFixture(dexParamFixture, draft => {
      draft.input.executorAddress =
        '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    });
    const malformedExpected = mutateFixture(dexParamFixture, draft => {
      draft.expected.exchangeData = '0x1';
    });

    expect(() =>
      validateDexEncoderFixture(malformedInput, 'bad-fixture'),
    ).toThrow(
      'bad-fixture.input.executorAddress must be a lowercase 42-character hex address',
    );
    expect(() =>
      validateDexEncoderFixture(malformedExpected, 'bad-fixture'),
    ).toThrow(
      'bad-fixture.expected.exchangeData must be 0x-prefixed lowercase even-length hex',
    );
  });

  it('cross-validates dex-param fixture metadata and duplicate data fields', () => {
    const dexParamFixture = loadedFixtures.find(
      ({ fixture }) => fixture.kind === 'dex-param',
    )!.fixture;
    const mismatchedExchange = mutateFixture(dexParamFixture, draft => {
      draft.input.swapExchange.exchange = 'OtherDex';
    });
    const mismatchedData = mutateFixture(dexParamFixture, draft => {
      draft.input.data.path[0].fee =
        draft.input.data.path[0].fee === '500' ? '3000' : '500';
    });

    expect(() =>
      validateDexEncoderFixture(mismatchedExchange, 'bad-fixture'),
    ).toThrow(
      'bad-fixture: input swapExchange.exchange must match fixture dexKey',
    );
    expect(() =>
      validateDexEncoderFixture(mismatchedData, 'bad-fixture'),
    ).toThrow('bad-fixture: input.data must match input.swapExchange.data');
  });

  it('validates covered DEX-specific data shapes', () => {
    const uniswapFixture = loadedFixtures.find(
      ({ fixture }) =>
        fixture.kind === 'dex-param' && fixture.dexKey === 'UniswapV3',
    )!.fixture;
    const balancerFixture = loadedFixtures.find(
      ({ fixture }) =>
        fixture.kind === 'dex-param' && fixture.dexKey === 'BalancerV1',
    )!.fixture;
    const malformedUniswap = mutateFixture(uniswapFixture, draft => {
      delete draft.input.swapExchange.data.path[0].tokenIn;
      delete draft.input.data.path[0].tokenIn;
    });
    const malformedBalancer = mutateFixture(balancerFixture, draft => {
      draft.input.swapExchange.data.swaps[0].pool =
        '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
      draft.input.data.swaps[0].pool =
        '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    });

    expect(() =>
      validateDexEncoderFixture(malformedUniswap, 'bad-fixture'),
    ).toThrow(
      'bad-fixture.input.swapExchange.data.path[0].tokenIn must be a lowercase 42-character hex address',
    );
    expect(() =>
      validateDexEncoderFixture(malformedBalancer, 'bad-fixture'),
    ).toThrow(
      'bad-fixture.input.swapExchange.data.swaps[0].pool must be a lowercase 42-character hex address',
    );
  });

  function uniqueDexKeys(kind: DexEncoderFixture['kind']): string[] {
    return [
      ...new Set(
        loadedFixtures
          .filter(({ fixture }) => fixture.kind === kind)
          .map(({ fixture }) => fixture.dexKey),
      ),
    ].sort();
  }
});

function mutateFixture(
  fixture: DexEncoderFixture,
  mutator: (draft: any) => void,
): unknown {
  const draft = JSON.parse(JSON.stringify(fixture)) as any;
  mutator(draft);
  return draft;
}

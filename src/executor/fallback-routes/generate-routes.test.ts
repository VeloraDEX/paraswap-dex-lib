import dotenv from 'dotenv';
dotenv.config();

/**
 * Jest-hosted entry for the fallback route generator (plain ts-node trips over
 * a circular import in the dex registry; jest's module handling tolerates it).
 *
 * Run: GENERATE_FALLBACK_ROUTES=1 npx jest src/executor/fallback-routes/generate-routes.test.ts --forceExit
 */
import { generateAllRoutes } from './generate';

jest.setTimeout(600 * 1000);

const enabled = process.env.GENERATE_FALLBACK_ROUTES === '1';

(enabled ? describe : describe.skip)('fallback route generator', () => {
  it('generates routes.json for all scenarios', async () => {
    const { routes, failures } = await generateAllRoutes();
    expect(failures).toEqual([]);
    expect(routes.length).toBeGreaterThan(0);
  });
});

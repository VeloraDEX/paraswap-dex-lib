import { buildAllResolvedBuildFixtures } from './resolved-build-fixture-cases';
import { writeResolvedBuildFixtures } from './resolved-build-loader';

async function main(): Promise<void> {
  const fixtures = await buildAllResolvedBuildFixtures();
  writeResolvedBuildFixtures(fixtures);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

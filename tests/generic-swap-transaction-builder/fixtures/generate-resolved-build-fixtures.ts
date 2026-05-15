import { buildAllResolvedBuildFixtures } from './resolved-build-fixture-cases';
import { writeResolvedBuildFixtures } from './resolved-build-loader';
import {
  writeResolvedBuildDepsContract,
  writeResolvedBuildManifest,
} from './resolved-build-go-contracts';

async function main(): Promise<void> {
  const fixtures = await buildAllResolvedBuildFixtures();
  writeResolvedBuildFixtures(fixtures);
  writeResolvedBuildManifest();
  writeResolvedBuildDepsContract();
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

import { buildAllDexEncoderFixtures } from './dex-encoder-fixture-cases';
import { writeDexEncoderFixtures } from './dex-encoder-fixture-loader';

function main(): void {
  writeDexEncoderFixtures(buildAllDexEncoderFixtures());
}

main();

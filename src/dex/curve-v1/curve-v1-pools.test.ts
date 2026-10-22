import dotenv from 'dotenv';
dotenv.config();

import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { Tokens } from '../../../tests/constants-e2e';
import { CurveV1 } from './curve-v1';

describe('CurveV1 MAINNET onlyPairsWithTokens', function () {
  const tokens = Tokens[Network.MAINNET];
  const curveV1 = new CurveV1(
    Network.MAINNET,
    'CurveV1',
    new DummyDexHelper(Network.MAINNET),
  );
  const busdPool = curveV1.getPoolIdentifier('BUSD');
  const paxPool = curveV1.getPoolIdentifier('pax');

  const poolsFor = (src: string, dest: string) =>
    curveV1.getPoolIdentifiers(tokens[src], tokens[dest], SwapSide.SELL, 0);

  it('skips the BUSD and pax pools for pairs without their token', async function () {
    for (const [src, dest] of [
      ['USDC', 'USDT'],
      ['USDT', 'DAI'],
      ['DAI', 'USDC'],
    ]) {
      const pools = await poolsFor(src, dest);
      expect(pools).toContain(curveV1.getPoolIdentifier('3pool'));
      expect(pools).not.toContain(busdPool);
      expect(pools).not.toContain(paxPool);
    }
  });

  it('keeps the BUSD pool for BUSD pairs', async function () {
    expect(await poolsFor('USDC', 'BUSD')).toContain(busdPool);
    expect(await poolsFor('BUSD', 'USDT')).toContain(busdPool);
  });

  it('keeps the pax pool for USDP pairs', async function () {
    expect(await poolsFor('USDT', 'USDP')).toContain(paxPool);
    expect(await poolsFor('USDP', 'USDC')).toContain(paxPool);
  });
});

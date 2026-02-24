import dotenv from 'dotenv';
dotenv.config();

process.env.API_KEY_NATIVE = process.env.API_KEY_NATIVE || 'test-native-key';

import { Native } from './native';
import { DummyDexHelper } from '../../dex-helper';
import { Network } from '../../constants';

describe('Native gas estimation', () => {
  const network = Network.MAINNET;
  const dexKey = 'Native';
  const dexHelper = new DummyDexHelper(network);

  it('returns a positive gas cost value', () => {
    const native = new Native(network, dexKey, dexHelper);
    const gasCost = native.getCalldataGasCost({} as any);
    expect(typeof gasCost).toBe('number');
    expect(gasCost).toBeGreaterThan(0);
  });
});

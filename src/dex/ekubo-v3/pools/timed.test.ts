import { Network } from '../../../constants';
import { estimatedCurrentTime } from './timed';

describe(estimatedCurrentTime, () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(100_000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('does not advance Robinhood time within the same timestamp second', () => {
    expect(estimatedCurrentTime(100n, Network.ROBINHOOD)).toBe(100n);
  });

  test('retains the minimum slot duration on slower chains', () => {
    expect(estimatedCurrentTime(100n, Network.ARBITRUM)).toBe(101n);
    expect(estimatedCurrentTime(100n, Network.MAINNET)).toBe(112n);
  });
});

import { Contract, BigNumber } from 'ethers';
import { hexZeroPad, hexlify } from 'ethers/lib/utils';
import { DeepReadonly } from 'ts-essentials';
import {
  ConcentratedPool,
  ConcentratedPoolState,
  quoteConcentrated,
} from './concentrated';
import { ConcentratedPoolTypeConfig, PoolKey } from './utils';
import { amountBeforeFee, computeFee, isPriceIncreasing } from './math/swap';
import { MAX_TICK, MIN_TICK, toSqrtRatio } from './math/tick';

export const ZERO_SEED_LAUNCH_ROBINHOOD =
  '0x517621Ea1bf51F31826819b118fa4dfEb4D198D2';
export const ZERO_SEED_LAUNCH_CHAIN = 4663;
export const ZERO_SEED_LAUNCH_ABI = [
  'function getLaunch(bytes32) view returns (tuple(address controller,uint64 tradingStart,uint64 decayRateX32,uint64 initialFee,uint64 finalFee,int32 tickLower,int32 tickUpper))',
];
const MAX_DECAY_PRODUCT = (88722836n << 32n) - 1n;
const MAX_U64 = (1n << 64n) - 1n;
const SIGNED_BOUNDARY = 1n << 127n;

export type LaunchSchedule = {
  tradingStart: bigint;
  decayRateX32: bigint;
  initialFee: bigint;
  finalFee: bigint;
  tickLower: number;
  tickUpper: number;
};

export type LaunchState = ConcentratedPoolState.Object & {
  launch: LaunchSchedule;
  blockTimestamp: bigint;
  blockNumber: number;
};

export function decayedLaunchFee(
  initial: bigint,
  floor: bigint,
  rate: bigint,
  elapsed: bigint,
): bigint {
  if (rate === 0n) return initial;
  if (elapsed > MAX_DECAY_PRODUCT / rate) return floor;
  const factor = toSqrtRatio(-Number((rate * elapsed) >> 32n));
  return floor + (((initial - floor) * factor) >> 128n);
}

export function quoteZeroSeedLaunch(
  key: PoolKey<ConcentratedPoolTypeConfig>,
  amount: bigint,
  isToken1: boolean,
  state: DeepReadonly<LaunchState>,
) {
  const l = state.launch;
  if (
    !l ||
    key.config.fee !== 0n ||
    state.blockTimestamp <= 0n ||
    l.finalFee > l.initialFee ||
    [l.tradingStart, l.decayRateX32, l.initialFee, l.finalFee].some(
      v => v < 0n || v > MAX_U64,
    ) ||
    l.tickLower < MIN_TICK ||
    l.tickUpper > MAX_TICK ||
    l.tickLower >= l.tickUpper ||
    state.checkedTicksBounds[0] > l.tickLower ||
    state.checkedTicksBounds[1] < l.tickUpper
  ) {
    throw new Error('Invalid or incomplete launch snapshot');
  }
  if (state.blockTimestamp < l.tradingStart)
    throw new Error('Launch trading has not started');
  if (amount < -SIGNED_BOUNDARY || amount >= SIGNED_BOUNDARY)
    throw new Error('Signed launch amount overflow');
  const lower = toSqrtRatio(l.tickLower),
    upper = toSqrtRatio(l.tickUpper);
  if (state.sqrtRatio < lower || state.sqrtRatio > upper)
    throw new Error('Launch price outside installed bounds');
  const quote = quoteConcentrated(
    key,
    amount,
    isToken1,
    state,
    isPriceIncreasing(amount, isToken1) ? upper : lower,
    true,
  );
  if (quote.calculatedAmount > SIGNED_BOUNDARY)
    throw new Error('Signed Core amount overflow');
  const feeRate = decayedLaunchFee(
    l.initialFee,
    l.finalFee,
    l.decayRateX32,
    state.blockTimestamp - l.tradingStart,
  );
  const feeAmount =
    amount >= 0n
      ? computeFee(quote.calculatedAmount, feeRate)
      : amountBeforeFee(quote.calculatedAmount, feeRate) -
        quote.calculatedAmount;
  quote.calculatedAmount += amount >= 0n ? -feeAmount : feeAmount;
  if (amount < 0n && quote.calculatedAmount >= SIGNED_BOUNDARY)
    throw new Error('Signed fee-inclusive input overflow');
  quote.skipAhead = 1;
  quote.gasConsumed = 1_900_000;
  return { ...quote, feeAmount, feeToken: isToken1 ? key.token0 : key.token1 };
}

export class ZeroSeedLaunchPool extends ConcentratedPool {
  private readonly launchContract = new Contract(
    ZERO_SEED_LAUNCH_ROBINHOOD,
    ZERO_SEED_LAUNCH_ABI,
    this.dexHelper.provider,
  );

  public override async generateState(
    blockNumber: number,
  ): Promise<DeepReadonly<LaunchState>> {
    if (
      this.dexHelper.config.data.network !== ZERO_SEED_LAUNCH_CHAIN ||
      this.key.config.extension !== BigInt(ZERO_SEED_LAUNCH_ROBINHOOD)
    ) {
      throw new Error('Unsupported launch deployment');
    }
    const provider = this.dexHelper.provider;
    const header = await provider.getBlock(blockNumber);
    if (!header || header.number !== blockNumber)
      throw new Error('Missing pinned launch block');
    const [underlying, data] = await Promise.all([
      // The installed range spans at most one bitmap (256 tick spacings).
      this.quoteDataFetcher.getQuoteData([this.key.toAbi()], 1, {
        blockTag: blockNumber,
      }),
      this.launchContract.getLaunch(hexZeroPad(hexlify(this.key.numId), 32), {
        blockTag: blockNumber,
      }),
    ]);
    const after = await provider.getBlock(blockNumber);
    if (!after || header.hash !== after.hash)
      throw new Error('Launch snapshot reorg');
    if (BigInt(data.controller) === 0n) throw new Error('Unknown launch');
    const word = (value: BigNumber) => value.toBigInt();
    const state = {
      ...ConcentratedPoolState.fromQuoter(underlying[0]),
      blockTimestamp: BigInt(header.timestamp),
      blockNumber,
      launch: {
        tradingStart: word(data.tradingStart),
        decayRateX32: word(data.decayRateX32),
        initialFee: word(data.initialFee),
        finalFee: word(data.finalFee),
        tickLower: data.tickLower,
        tickUpper: data.tickUpper,
      },
    };
    return state;
  }

  public override quote(amount: bigint, token: bigint, blockNumber: number) {
    const state = this.getState(
      blockNumber,
    ) as DeepReadonly<LaunchState> | null;
    if (state?.blockNumber !== blockNumber)
      throw new Error('Launch quote requires state at the requested block');
    return super.quote(amount, token, blockNumber);
  }

  protected override _quote(
    amount: bigint,
    isToken1: boolean,
    state: DeepReadonly<ConcentratedPoolState.Object>,
  ) {
    return quoteZeroSeedLaunch(
      this.key,
      amount,
      isToken1,
      state as DeepReadonly<LaunchState>,
    );
  }
}

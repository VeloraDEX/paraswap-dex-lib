import { Interface } from '@ethersproject/abi';
import { IDexHelper } from '../../dex-helper';
import { PoolState } from './types';
import RangePoolABI from '../../abi/range-pool/RangePool.json';
import RangePoolFactoryABI from '../../abi/range-pool/RangePoolFactory.json';

const poolIface = new Interface(RangePoolABI);
const factoryIface = new Interface(RangePoolFactoryABI);

// Vault PoolConfig reader. The aggregate swap-fee share is NOT in
// getRangePoolDynamicData; it lives in the Vault config (VaultExtension, reachable
// through the Vault's fallback). Only aggregateSwapFeePercentage is consumed, but the
// full struct must be declared so ethers can decode the return.
const vaultIface = new Interface([
  'function getPoolConfig(address pool) view returns (tuple(' +
    'tuple(bool disableUnbalancedLiquidity, bool enableAddLiquidityCustom, bool enableRemoveLiquidityCustom, bool enableDonation) liquidityManagement, ' +
    'uint256 staticSwapFeePercentage, ' +
    'uint256 aggregateSwapFeePercentage, ' +
    'uint256 aggregateYieldFeePercentage, ' +
    'uint40 tokenDecimalDiffs, ' +
    'uint32 pauseWindowEndTime, ' +
    'bool isPoolRegistered, bool isPoolInitialized, bool isPoolPaused, bool isPoolInRecoveryMode' +
    ') poolConfig)',
  'function getMinimumTradeAmount() view returns (uint256)',
]);

type MultiResult = { success: boolean; returnData: string };

/** Enumerate every Range Pool from the factory. Returns lowercased addresses. */
export async function getAllPools(
  dexHelper: IDexHelper,
  factoryAddress: string,
  blockNumber: number,
): Promise<string[]> {
  const callData = [
    {
      target: factoryAddress,
      callData: factoryIface.encodeFunctionData('getPools', []),
    },
  ];
  const res: MultiResult[] = await dexHelper.multiContract.methods
    .tryAggregate(true, callData)
    .call({}, blockNumber);

  const pools = factoryIface.decodeFunctionResult(
    'getPools',
    res[0].returnData,
  )[0] as string[];
  return pools.map(p => p.toLowerCase());
}

/**
 * Read full state for each pool in ONE multicall round-trip (three calls/pool:
 * immutable + dynamic on the pool, plus getPoolConfig on the Vault for the aggregate
 * swap fee), preceded by one Vault-global getMinimumTradeAmount() read. Pools whose
 * calls revert (e.g. uninitialized) are skipped.
 * Decodes ALL six liveness flags (the ranges-stats reader only exposed three).
 */
export async function getPoolStates(
  dexHelper: IDexHelper,
  vaultAddress: string,
  pools: string[],
  blockNumber: number,
): Promise<Record<string, PoolState>> {
  if (pools.length === 0) return {};

  // Call 0 is the Vault-global MINIMUM_TRADE_AMOUNT; per-pool triples follow.
  const calls = [
    {
      target: vaultAddress,
      callData: vaultIface.encodeFunctionData('getMinimumTradeAmount', []),
    },
    ...pools.flatMap(pool => [
      {
        target: pool,
        callData: poolIface.encodeFunctionData('getRangePoolImmutableData', []),
      },
      {
        target: pool,
        callData: poolIface.encodeFunctionData('getRangePoolDynamicData', []),
      },
      {
        target: vaultAddress,
        callData: vaultIface.encodeFunctionData('getPoolConfig', [pool]),
      },
    ]),
  ];

  const res: MultiResult[] = await dexHelper.multiContract.methods
    .tryAggregate(false, calls)
    .call({}, blockNumber);

  if (!res[0]?.success) {
    throw new Error('RangePool: getMinimumTradeAmount() call failed');
  }
  const minimumTradeAmount = BigInt(
    vaultIface.decodeFunctionResult(
      'getMinimumTradeAmount',
      res[0].returnData,
    )[0],
  );

  const out: Record<string, PoolState> = {};
  pools.forEach((pool, i) => {
    const imm = res[3 * i + 1];
    const dyn = res[3 * i + 2];
    const cfg = res[3 * i + 3];
    if (!imm?.success || !dyn?.success || !cfg?.success) return;

    const immData = poolIface.decodeFunctionResult(
      'getRangePoolImmutableData',
      imm.returnData,
    )[0];
    const dynData = poolIface.decodeFunctionResult(
      'getRangePoolDynamicData',
      dyn.returnData,
    )[0];
    const cfgData = vaultIface.decodeFunctionResult(
      'getPoolConfig',
      cfg.returnData,
    )[0];

    out[pool] = {
      tokens: immData.tokens.map((t: string) => t.toLowerCase()),
      scalingFactors: immData.decimalScalingFactors.map((x: any) => BigInt(x)),
      weights: immData.normalizedWeights.map((x: any) => BigInt(x)),
      virtualBalances: dynData.virtualBalances.map((x: any) => BigInt(x)),
      balancesLiveScaled18: dynData.balancesLiveScaled18.map((x: any) =>
        BigInt(x),
      ),
      tokenRates: dynData.tokenRates.map((x: any) => BigInt(x)),
      swapFeePercentage: BigInt(dynData.staticSwapFeePercentage),
      aggregateSwapFee: BigInt(cfgData.aggregateSwapFeePercentage),
      minimumTradeAmount,
      totalSupply: BigInt(dynData.totalSupply),
      isPoolRegistered: dynData.isPoolRegistered,
      isPoolInitialized: dynData.isPoolInitialized,
      isPoolPaused: dynData.isPoolPaused,
      isPoolInRecoveryMode: dynData.isPoolInRecoveryMode,
      isVaultPaused: dynData.isVaultPaused,
      isHookStopped: dynData.isHookStopped,
    };
  });
  return out;
}

/** True if the pool can currently serve swaps (all safety gates clear + initialized). */
export function isPoolLive(state: PoolState): boolean {
  return (
    state.isPoolRegistered &&
    state.isPoolInitialized &&
    !state.isPoolPaused &&
    !state.isPoolInRecoveryMode &&
    !state.isVaultPaused &&
    !state.isHookStopped
  );
}

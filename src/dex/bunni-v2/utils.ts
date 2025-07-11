import { IDexHelper } from '../../dex-helper';
import { Address, Logger } from '../../types';
import { queryAvailablePoolsForToken, queryPools } from './subgraph';
import { DexParams, PoolState, SubgraphPool, SubgraphTopPool } from './types';

export function isWETHAddress(address: string, config: DexParams): boolean {
  return address.toLowerCase() === config.WETH.toLowerCase();
}

export async function getPools(
  dexHelper: IDexHelper,
  logger: Logger,
  subgraphURL: string,
  blockNumber: number,
): Promise<SubgraphPool[]> {
  let skip = 0;
  let first = 1000;
  let pools: SubgraphPool[] = [];

  let currentPools = await queryPools(
    dexHelper,
    logger,
    subgraphURL,
    blockNumber,
    skip * first,
    first,
  );

  pools = pools.concat(currentPools);

  while (currentPools.length === first) {
    skip++;
    currentPools = await queryPools(
      dexHelper,
      logger,
      subgraphURL,
      blockNumber,
      skip * first,
      first,
    );

    pools = pools.concat(currentPools);
  }

  return pools;
}

export async function getAvailablePoolsForToken(
  dexHelper: IDexHelper,
  logger: Logger,
  subgraphURL: string,
  tokenAddress: string,
): Promise<SubgraphTopPool[]> {
  let skip = 0;
  let first = 1000;
  let pools: SubgraphTopPool[] = [];

  let currentPools = await queryAvailablePoolsForToken(
    dexHelper,
    logger,
    subgraphURL,
    tokenAddress,
    skip * first,
    first,
  );

  pools = pools.concat(currentPools);

  while (currentPools.length === first) {
    skip++;
    currentPools = await queryAvailablePoolsForToken(
      dexHelper,
      logger,
      subgraphURL,
      tokenAddress,
      skip * first,
      first,
    );

    pools = pools.concat(currentPools);
  }

  return pools;
}

export function initializePoolState(
  id: string,
  currency0: Address,
  currency1: Address,
  fee: bigint,
  tickSpacing: bigint,
  hooks: Address,
): PoolState {
  return {
    id: id.toLowerCase(),
    key: {
      currency0: currency0.toLowerCase(),
      currency1: currency1.toLowerCase(),
      fee,
      tickSpacing,
      hooks: hooks.toLowerCase(),
    },
  };
}

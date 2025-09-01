import { Logger } from 'log4js';
import { SUBGRAPH_TIMEOUT } from '../../constants';
import { IDexHelper } from '../../dex-helper';
import {
  DexParams,
  SubgraphPool,
  SubgraphProtocolState,
  SubgraphTopPool,
  SubgraphTopPoolForPair,
} from './types';

export async function queryProtocolState(
  dexHelper: IDexHelper,
  logger: Logger,
  config: DexParams,
  blockNumber: number,
  latestBlock: boolean = false,
): Promise<SubgraphProtocolState | null> {
  if (!config.subgraphURL) return null;

  const query = `{
    bunniHook (
      id: "${config.bunniHook.address.toLowerCase()}"
      ${latestBlock ? '' : `block: { number: ${blockNumber}} `}
    ) {
      hookFeesModifier
      currentK
      pendingK
      activeBlock
    }
  }`;

  const res = await dexHelper.httpRequest.querySubgraph<{
    data: {
      bunniHook: SubgraphProtocolState;
    };
    errors?: { message: string }[];
  }>(
    config.subgraphURL,
    {
      query,
    },
    { timeout: SUBGRAPH_TIMEOUT },
  );

  if (res.errors && res.errors.length) {
    if (res.errors[0].message.includes('missing block')) {
      logger.info(
        `Subgraph missing block ${blockNumber}, fallback to the latest block...`,
      );
      return queryProtocolState(dexHelper, logger, config, blockNumber, true);
    } else {
      throw new Error(res.errors[0].message);
    }
  }

  return res.data.bunniHook || null;
}

export async function queryPools(
  dexHelper: IDexHelper,
  logger: Logger,
  config: DexParams,
  blockNumber: number,
  skip: number,
  first: number,
  latestBlock: boolean = false,
): Promise<SubgraphPool[]> {
  if (!config.subgraphURL) return [];

  const query = `query ($skip: Int!, $first: Int!) {
    pools (
      skip: $skip
      first: $first
      ${latestBlock ? '' : `block: { number: ${blockNumber}} `}
      where: {
        and: [
          { bunniHub_: { id: "${config.bunniHub.toLowerCase()}" } }
          { bunniHook_: { id: "${config.bunniHook.address.toLowerCase()}" } }
        ]
      }
    ) {
      id
      bunniHub { id }
      bunniToken { id }
      currency0 { id }
      currency1 { id }
      fee
      tickSpacing
      hooks
    }
  }`;

  const res = await dexHelper.httpRequest.querySubgraph<{
    data: {
      pools: SubgraphPool[];
    };
    errors?: { message: string }[];
  }>(
    config.subgraphURL,
    {
      query,
      variables: { skip, first },
    },
    { timeout: SUBGRAPH_TIMEOUT },
  );

  if (res.errors && res.errors.length) {
    if (res.errors[0].message.includes('missing block')) {
      logger.info(
        `Subgraph missing block ${blockNumber}, fallback to the latest block...`,
      );
      return queryPools(
        dexHelper,
        logger,
        config,
        blockNumber,
        skip,
        first,
        true,
      );
    } else {
      throw new Error(res.errors[0].message);
    }
  }

  return res.data.pools || [];
}

export async function queryAvailablePoolsForToken(
  dexHelper: IDexHelper,
  logger: Logger,
  config: DexParams,
  tokenAddress: string,
  skip: number,
  first: number,
): Promise<SubgraphTopPool[]> {
  const query = `
    query (
      $skip: Int,
      $first: Int,
    ) {
      pools (
        skip: $skip,
        first: $first,
        where: {
          and: [
            {
              or: [
                { currency0_: { id: "${tokenAddress.toLowerCase()}" } },
                { currency1_: { id: "${tokenAddress.toLowerCase()}" } },
              ]
            },
            { bunniToken_: { totalSupply_gt: 0.000001 } },
            { bunniHub_: { id: "${config.bunniHub.toLowerCase()}" } },
            { bunniHook_: { id: "${config.bunniHook.address.toLowerCase()}" } },
          ]
        }
      ) {
        id
        bunniToken {
          rawBalance0
          rawBalance1
          reserve0
          reserve1
          vault0 {
            id
            decimals
            pricePerVaultShare
          }
          vault1 {
            id
            decimals
            pricePerVaultShare
          }
        }
        currency0 {
          id
          decimals
          price
        }
        currency1 {
          id
          decimals
          price
        }
        priceCurrency0
        priceCurrency1
      }
    }
  `;

  const result = await dexHelper.httpRequest.querySubgraph<{
    data: { pools: SubgraphTopPool[] };
    errors?: { message: string }[];
  }>(
    config.subgraphURL,
    {
      query,
      variables: { skip: skip, first: first },
    },
    { timeout: SUBGRAPH_TIMEOUT },
  );

  if (result.errors && result.errors.length) {
    throw new Error(result.errors[0].message);
  }

  return result.data.pools || [];
}

export async function queryAvailablePoolsForPair(
  dexHelper: IDexHelper,
  logger: Logger,
  config: DexParams,
  srcToken: string,
  destToken: string,
  skip: number,
  first: number,
): Promise<SubgraphTopPoolForPair[]> {
  const [currency0, currency1] =
    parseInt(srcToken, 16) < parseInt(destToken, 16)
      ? [srcToken, destToken]
      : [destToken, srcToken];

  const query = `
    query (
      $skip: Int,
      $first: Int,
    ) {
      pools (
        skip: $skip,
        first: $first,
        where: {
          and: [
            { currency0_: { id: "${currency0.toLowerCase()}" } },
            { currency1_: { id: "${currency1.toLowerCase()}" } },
            { bunniToken_: { totalSupply_gt: 0.000001 } },
            { bunniHub_: { id: "${config.bunniHub.toLowerCase()}" } },
            { bunniHook_: { id: "${config.bunniHook.address.toLowerCase()}" } },
          ]
        }
      ) {
        id
        currency0 {
          id
        }
        currency1 {
          id
        }
        fee
        tickSpacing
        hooks
      }
    }
  `;

  const result = await dexHelper.httpRequest.querySubgraph<{
    data: { pools: SubgraphTopPoolForPair[] };
    errors?: { message: string }[];
  }>(
    config.subgraphURL,
    {
      query,
      variables: { skip: skip, first: first },
    },
    { timeout: SUBGRAPH_TIMEOUT },
  );

  if (result.errors && result.errors.length) {
    throw new Error(result.errors[0].message);
  }

  return result.data.pools || [];
}

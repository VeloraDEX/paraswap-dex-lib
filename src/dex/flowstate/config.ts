import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network } from '../../constants';

// FlowState buyFromPool router. CREATE2-deterministic → same address on every
// chain, and it is the address that on-chain evidence (deposits + buys + the
// indexer) confirms is live today. NOTE: the team flagged newer per-chain
// contracts (0x445124…) as a possible migration target — if/when that lands,
// only this constant changes (same 4-arg buyFromPool ABI either way).
const FLOWSTATE_ROUTER = '0x93B7C8A5d4F70Bc6158c2A03D77b1B3134224Bb1';

// 1inch spot price aggregator. Same address across ETH/BSC/Base/Arbitrum
// (from the contract's PriceOracleAddresses.getPriceOracleAddress()).
const ONE_INCH_ORACLE = '0x00000000000D6FFc74A8feb35aF5827bf57f6786';

const GRAPHQL_URL = 'https://gql.poolparty.market/v1/graphql';

// '' = no reseller code (buyFromPool accepts it and skips the reseller cut).
// Swap in the Velora code once it's registered on-chain (verifyReseller) — no
// other change needed.
const RESELLER_CODE = '';

export const FLOWSTATE_GAS_COST = 120_000;

export const FlowStateConfig: DexConfigMap<DexParams> = {
  FlowState: {
    [Network.MAINNET]: {
      router: FLOWSTATE_ROUTER,
      oracle: ONE_INCH_ORACLE,
      graphqlURL: GRAPHQL_URL,
      resellerCode: RESELLER_CODE,
    },
    [Network.BSC]: {
      router: FLOWSTATE_ROUTER,
      oracle: ONE_INCH_ORACLE,
      graphqlURL: GRAPHQL_URL,
      resellerCode: RESELLER_CODE,
    },
    [Network.BASE]: {
      router: FLOWSTATE_ROUTER,
      oracle: ONE_INCH_ORACLE,
      graphqlURL: GRAPHQL_URL,
      resellerCode: RESELLER_CODE,
    },
    [Network.ARBITRUM]: {
      router: FLOWSTATE_ROUTER,
      oracle: ONE_INCH_ORACLE,
      graphqlURL: GRAPHQL_URL,
      resellerCode: RESELLER_CODE,
    },
  },
};

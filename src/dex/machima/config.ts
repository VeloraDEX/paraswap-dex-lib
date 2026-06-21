import { Network } from '../../constants';
import { DexConfigMap, AdapterMappings } from '../../types';
import { MACHIMA_POOL_FEE } from './constants';
import { MachimaDexParams } from './types';

// Base-mainnet (chainId 8453) deployment. Addresses sourced from
// launch-contracts/constants/contracts.js and dex-contracts.
//
// The Uniswap V3 fork primitives (factory / quoter / pool init code hash) come
// from dex-contracts; the standard-interface wrappers (aggregatorRouter /
// aggregatorQuoter) come from launch-contracts/contracts/aggregator.
//
// `stateMulticall` / `uniswapMulticall` reuse the canonical Base deployments —
// getFullStateWithRelativeBitmaps takes the factory as a runtime argument, so
// the same helper works against the Machima factory.
export const MachimaConfig: DexConfigMap<MachimaDexParams> = {
  Elixir: {
    [Network.BASE]: {
      // Uniswap V3 fork core (dex-contracts)
      factory: '0xADd30837a707cCE4567eEa2C27d0617270d54C75',
      quoter: '0x2Df9BdA8bb50cE05B548B9AAAf1B23437732a498', // QuoterV2 (raw, pre-tax)
      // `router` is unused for execution (we route via aggregatorRouter) but the
      // base class requires it; point it at the aggregator router.
      router: '0x566250347E1401615B3e043918fc290B98448578',
      supportedFees: [MACHIMA_POOL_FEE],
      stateMulticall: '0x7160f736c52e1e78e92FD4eE4D73e21A7Cf4F950',
      uniswapMulticall: '0x091e99cb1C49331a94dD62755D168E941AbD0693',
      chunksCount: 10,
      initRetryFrequency: 10,
      // dex-contracts/periphery/libraries/PoolAddress.sol POOL_INIT_CODE_HASH
      initHash:
        '0x6e3c0baf192c2e87b57c1ff93ab1b77b3f0ab3387cffd07b2eddbffefc75603b',
      // Elixir subgraph (Machima Pool/Token schema). Used only by
      // getTopPoolsForToken for liquidity ranking; pool discovery itself runs
      // off the factory's PoolCreated events, so this is optional to route.
      // Set to the deployed Graph gateway URL / deployment id — the same value
      // elixir-backend reads from the SUBGRAPH_MACHIMA_URL env var
      // (config/chains/base.ts). Left blank here as it is an env-managed secret.
      subgraphURL: '',
      liquidityField: 'tvl',

      // Machima tax/anti-sniper layer + standard-interface wrappers
      weth: '0x4200000000000000000000000000000000000006',
      usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      xma: '0xA4985Faeb1e64Ba215282255dBb78ff59C63d7A9',
      clankNow: '0x44FefF82302D231dcC30f97280D1c9843F308D1a',
      swapAdapter: '0x9FFB6a12d14b0F86AC122486081e3B86728E65F9',
      aggregatorRouter: '0x566250347E1401615B3e043918fc290B98448578',
      aggregatorQuoter: '0x9dA94300DEC6ac282880f71df3270a922Bcbd034',
    },
  },
};

// ParaSwap V6 routes through getDexParam (no legacy adapters).
export const Adapters: Record<number, AdapterMappings> = {};

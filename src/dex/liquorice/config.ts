import { Network } from '../../constants';
import { DexConfigMap } from '../../types';
import { DexParams } from './types';

// LiquoriceSettlement is the call target; its BalanceManager pulls the input token,
// so it is the approval spender. Both are deployed at the same address on these chains.
//
// gasCost is the settle() call alone, measured 2026-10 on 2,241 historical
// settlements (single-settlement txs, cold storage, as in a Velora route) and
// live quotes simulated through Executor01. It depends on the maker: lending-pool
// settlement (repay/withdraw) ~660-750k on Ethereum, the 0x maker ~260-750k by size.
export const LiquoriceConfig: DexConfigMap<DexParams> = {
  Liquorice: {
    [Network.MAINNET]: {
      settlementAddress: '0x43dcd6586e6209ee7235a21bdc4aa301e5bc44e8',
      balanceManagerAddress: '0x56b4720e40df52c560e520238e34e9c33d57e593',
      gasCost: 650_000,
    },
    [Network.ARBITRUM]: {
      settlementAddress: '0x43dcd6586e6209ee7235a21bdc4aa301e5bc44e8',
      balanceManagerAddress: '0x56b4720e40df52c560e520238e34e9c33d57e593',
      gasCost: 600_000,
    },
  },
};

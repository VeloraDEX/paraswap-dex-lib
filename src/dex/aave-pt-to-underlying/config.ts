import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network } from '../../constants';

// Pendle V4 Router https://etherscan.io/address/0x888888888889758f76e7103c6cbf23abbf58f946#code
const PENDLE_ROUTER_ADDRESS = '0x888888888889758f76e7103c6cbf23abbf58f946';
// Pendle Oracle https://etherscan.io/address/0x9a9Fa8338dd5E5B2188006f1Cd2Ef26d921650C2
const ORACLE_ADDRESS = '0x9a9Fa8338dd5E5B2188006f1Cd2Ef26d921650C2';

export const AavePtToUnderlyingConfig: DexConfigMap<DexParams> = {
  AavePtToUnderlying: {
    [Network.MAINNET]: {
      pendleRouterAddress: PENDLE_ROUTER_ADDRESS,
      oracleAddress: ORACLE_ADDRESS,
      underlyingAddresses: {
        USDe: '0x4c9EDD5852cd905f086C759E8383e09bff1E68B3',
        sUSDe: '0x9D39A5DE30e57443BfF2A8307A4256c8797A3497',
      },
    },
  },
};

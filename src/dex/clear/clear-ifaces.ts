import { Interface } from '@ethersproject/abi';

import ClearFactoryAbi from '../../abi/clear/ClearFactory.json';
import ClearVaultAbi from '../../abi/clear/ClearVault.json';
import ClearSwapAbi from '../../abi/clear/ClearSwap.json';
import ClearOracleAbi from '../../abi/clear/ClearOracle.json';
import CurveStableNgAbi from '../../abi/curve-v1/CurveV1StableNg.json';

export const factoryIface = new Interface(ClearFactoryAbi);
export const vaultIface = new Interface(ClearVaultAbi);
export const swapIface = new Interface(ClearSwapAbi);
export const oracleIface = new Interface(ClearOracleAbi);
export const curveStableNgIface = new Interface(CurveStableNgAbi);

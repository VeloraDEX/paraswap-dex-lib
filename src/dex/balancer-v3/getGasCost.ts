import { STABLE_GAS_COST } from './stablePool';
import { Step } from './types';
import { WEIGHTED_GAS_COST } from './weightedPool';
import { GYROECLP_GAS_COST } from './gyroECLPPool';
import { RECLAMM_GAS_COST } from './reClammPool';

// https://sepolia.etherscan.io/tx/0x8c2c5ec7fc2855ed2ffab3467ee434f4e374e0ecf791e8d2b93c8d74e3f5b1fe
// 0x7ec61d6dcf0ea412327c30f013e60578c0ff4d83c334a95fb3a68739860e6f59
// 0xb45331fe60091bdf4ba4c201b7fdfefc1ca8087fa1b6bc28877ef84d167809f4
const FULL_BOOSTED_SWAP_GAS_COST = 283070;
// 0xb47bcae19ba4693d18f2148073d0d469ff59223e90d6f75eb25e06b0063f1556
// 0x4730b0c1dce820f14747698446865364b98d96d3ed926e8e74bbead6482b8f8b
const PARTIAL_BOOSTED_SWAP_GAS_COST = 259815;
// 0xef9037f992645a9ecf26ddbdf65690a71acbffce2cc68445c869bb9707cb706a
// 0x77aa06350df079a077147f1051b10e0612542eb3aff3ae1b3d4004341cb64690
const BUFFER_WRAP_UNWRAP_GAS_COST = 155921;

export function getGasCost(steps: Step[]): number {
  if (steps.length === 2) {
    // Partial boosted/buffer swap:
    // token[wrap]wrappedToken[swap]wrappedToken or
    // wrappedToken[swap]wrappedToken[unwrap]token
    return PARTIAL_BOOSTED_SWAP_GAS_COST;
  } else if (steps.length === 3) {
    // Full boosted/buffer swap: token[wrap]wrappedToken[swap]wrappedToken[unwrap]token
    return FULL_BOOSTED_SWAP_GAS_COST;
  } else {
    switch (steps[0].poolState.poolType) {
      case 'WEIGHTED':
        return WEIGHTED_GAS_COST;
      case 'STABLE':
        return STABLE_GAS_COST;
      case 'BUFFER':
        return BUFFER_WRAP_UNWRAP_GAS_COST;
      case 'GYROE':
        return GYROECLP_GAS_COST;
      case 'RECLAMM':
        return RECLAMM_GAS_COST;
      case 'RECLAMM_V2':
        return RECLAMM_GAS_COST;
      default:
        return WEIGHTED_GAS_COST;
    }
  }
}

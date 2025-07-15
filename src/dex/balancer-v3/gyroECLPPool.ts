import { GyroECLPImmutable } from '@balancer-labs/balancer-maths';

// https://sepolia.etherscan.io/tx/0x222800381cfc60b6af18c0f533149b6a3b4cda6c05aafb92cfbac42eb281bf76
export const GYROECLP_GAS_COST = 214120;

export type GyroECLPImmutableString = {
  [K in keyof Omit<
    GyroECLPImmutable,
    'paramsAlpha' | 'paramsBeta' | 'paramsC' | 'paramsS' | 'paramsLambda'
  >]: string;
} & {
  alpha: string;
  beta: string;
  c: string;
  s: string;
  lambda: string;
};

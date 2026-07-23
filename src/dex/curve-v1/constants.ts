import { CurveV1Config } from './config';
import { CurveForksConfig } from './forks/curve-forks/config';

export const DIRECT_METHOD_NAME = 'directCurveV1Swap';
export const DIRECT_METHOD_NAME_V6 = 'swapExactAmountInOnCurveV1';

export const AllCurveForks = [
  ...Object.keys(CurveV1Config),
  ...Object.keys(CurveForksConfig),
];

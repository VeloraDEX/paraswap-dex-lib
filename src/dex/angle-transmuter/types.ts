import { Address, Token } from '../../types';
import { ChainLinkState } from '../../lib/chainlink';

export type PoolState = {
  stablecoin: Token;
  transmuter: TransmuterState;
  oracles: {
    chainlink: { [address: string]: ChainLinkState };
    pyth: PythState;
    morphoVault: { [address: string]: MorphoVaultState };
  };
};

export type CollateralState = {
  whitelist: { status: boolean; data: string };
  fees: Fees;
  stablecoinsIssued: number;
  config: Oracle;
  stablecoinCap: number;
};

export type TransmuterState = {
  collaterals: {
    [token: string]: CollateralState;
  };
  isWhitelisted: {
    [type: number]: Set<string>;
  };
  xRedemptionCurve: number[];
  yRedemptionCurve: number[];
  totalStablecoinIssued: number;
};

export type ChainlinkConfig = {
  [address: string]: { proxy: Address; aggregator: Address; decimals: number };
};

export type PythConfig = { proxy: Address; ids: string[] };

export type MorphoConfig = {
  [address: string]: MorphoOracleState;
};

export type PoolConfig = {
  stablecoin: Token;
  transmuter: Address;
  collaterals: Address[];
  oracles: {
    chainlink: ChainlinkConfig;
    backed: ChainlinkConfig;
    redstone: ChainlinkConfig;
    pyth: PythConfig;
    morpho: MorphoConfig;
  };
};

export type MorphoVaultState = {
  totalAssets: bigint;
  totalSupply: bigint;
};

export type MorphoOracleState = {
  baseVault: Address;
  baseVaultConversion: bigint;
  quoteVault: Address;
  quoteVaultConversion: bigint;
  baseFeed1: Address;
  baseFeed2: Address;
  quoteFeed1: Address;
  quoteFeed2: Address;
  scaleFactor: bigint;
};

export type ChainlinkState = {
  answer: number;
  timestamp: number;
};

export type PythState = {
  [address: string]: {
    answer: number;
    expo: number;
    timestamp: number;
  };
};

export type AngleTransmuterData = {
  exchange: Address;
};

export type TransmuterParams = {
  stablecoin: Token;
  transmuter: Address;
  pyth: Address;
};
export type DexParams = {
  EUR?: TransmuterParams;
  USD?: TransmuterParams;
};

export enum QuoteType {
  MintExactInput = 0,
  MintExactOutput = 1,
  BurnExactInput = 2,
  BurnExactOutput = 3,
}

export enum OracleReadType {
  CHAINLINK_FEEDS = 0,
  EXTERNAL = 1,
  NO_ORACLE = 2,
  STABLE = 3,
  WSTETH = 4,
  CBETH = 5,
  RETH = 6,
  SFRXETH = 7,
  PYTH = 8,
  MAX = 9,
  MORPHO_ORACLE = 10,
}

export enum OracleQuoteType {
  UNIT = 0,
  TARGET = 1,
}

export type Fees = {
  xFeeMint: number[];
  yFeeMint: number[];
  xFeeBurn: number[];
  yFeeBurn: number[];
};

export type Pyth = {
  pyth: Address;
  feedIds: string[];
  stalePeriods: number[];
  isMultiplied: number[];
  quoteType: OracleQuoteType;
};

export type Chainlink = {
  circuitChainlink: Address[];
  stalePeriods: number[];
  circuitChainIsMultiplied: number[];
  chainlinkDecimals: number[];
  quoteType: OracleQuoteType;
};

export type MorphoOracle = {
  oracle: Address;
  normalizationFactor: bigint;
};

export type MaxOracle = {
  maxValue: number;
};

export type OracleFeed = {
  isChainlink: boolean;
  isPyth: boolean;
  isMorpho: boolean;
  chainlink?: Chainlink;
  pyth?: Pyth;
  morpho?: MorphoOracle;
  otherContract?: Address;
  maxValue?: number;
};

export type Oracle = {
  oracleType: OracleReadType;
  targetType: OracleReadType;
  externalOracle?: Address;
  oracleFeed: OracleFeed;
  targetFeed: OracleFeed;
  hyperparameters: string;
};

export type DecodedOracleConfig = {
  oracleType: OracleReadType;
  targetType: OracleReadType;
  oracleData: string;
  targetData: string;
  hyperparameters: string;
};

export type OracleHyperparameter = {
  userDeviation: bigint;
  burnRatioDeviation: bigint;
};

export type DecodedStateMultiCallResultPythOracle = {
  price: bigint;
  conf: number;
  expo: number;
  publishTime: number;
};

export const BASE_9 = 1; // 1e9
export const BASE_12 = 1e3; // 1e12

export const MAX_BURN_FEE = 0.999; // 999_000_000

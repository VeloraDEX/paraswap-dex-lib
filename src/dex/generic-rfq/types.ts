import BigNumber from 'bignumber.js';
import { RequestConfig } from '../../dex-helper/irequest-wrapper';
import { Address, NumberAsString, Token } from '../../types';
import {
  AugustusOrderWithString,
  OrderInfo,
} from '../paraswap-limit-orders/types';
import { Network, SwapSide } from '../../constants';
import { ErrorCode } from '../hashflow/types';

export type Pair = {
  base: string;
  quote: string;
  liquidityUSD: number;
};

export type PairMap = {
  [pairName: string]: Pair;
};

export type PairsResponse = {
  pairs: PairMap;
};

export type TokenWithInfo = Token & {
  name: string;
  description: string;
};

export type TokensResponse = {
  tokens: Record<string, TokenWithInfo>;
};

export type BlackListResponse = {
  blacklist: string[];
};

export type PriceAndAmount = [string, string];

export type PriceAndAmountBigNumber = [BigNumber, BigNumber];

export type PairPriceResponse = {
  bids?: PriceAndAmount[];
  asks?: PriceAndAmount[];
};

export type RatesResponse = {
  prices: { [pair: string]: PairPriceResponse };
};

export type RFQSecret = {
  domain: string;
  accessKey: string;
  secretKey: string;
};

export type FetcherParams = {
  reqParams: RequestConfig;
  secret: RFQSecret;
  intervalMs: number;
  dataTTLS: number;
};

export type Rates = Array<[string, string]>;
export type BigNumberRate = [BigNumber, BigNumber];
export type BigNumberRates = Array<BigNumberRate>;

type RequestConfigWithAuth = RequestConfig & {
  secret?: RFQSecret;
};

export type RFQConfig = {
  tokensConfig: FetcherParams;
  pairsConfig: FetcherParams;
  rateConfig: FetcherParams;
  firmRateConfig: RequestConfigWithAuth;
  blacklistConfig?: FetcherParams;
  maker: Address;
  pathToRemove?: string;
  minTradeUsd: number | null;
};

export type TokenWithAmount = Token & {
  amount: string;
};

export type RFQPayload = {
  makerAsset: Address;
  takerAsset: Address;
  makerAmount?: string;
  takerAmount?: string;
  userAddress: Address;
  takerAddress: Address;
  partner?: string;
  special?: boolean;
};

export type AugustusOrderWithStringAndSignature = AugustusOrderWithString & {
  signature: string;
};

export type RFQFirmRateResponse = {
  status: 'accepted' | 'rejected';
  order: AugustusOrderWithStringAndSignature;
};

export class BlacklistError extends Error {
  isBlacklistError = true;
  cause = 'BlacklistError';
  code = 'BLACKLIST';

  constructor(
    public dexKey: string,
    public network: Network,
    public user: Address,
  ) {
    const message = `User address ${user} is blacklisted on ${dexKey}-${network}`;
    super(message);
    this.name = 'BlacklistError';
  }
}

export class SlippageCheckError extends Error {
  isSlippageError = true;
  cause = 'SlippageCheckError';
  code: ErrorCode = 'SLIPPAGE';

  constructor(
    dexKey: string,
    network: Network,
    side: SwapSide,
    expectedAmount: string,
    quotedAmount: string,
    slippageFactor: BigNumber,
    insufficientOutput?: boolean,
  ) {
    const expected = new BigNumber(expectedAmount);
    const actual = new BigNumber(quotedAmount);

    const slipped =
      side === SwapSide.SELL
        ? new BigNumber(1).minus(actual.div(expected))
        : actual.div(expected).minus(1);

    const slippedPercentage = slipped.multipliedBy(100).toFixed(10);

    const errorDetails = {
      dexKey,
      network,
      side,
      expectedAmount: expected.toFixed(),
      quotedAmount: actual.toFixed(),
      slippageFactor: slippageFactor.toFixed(),
      slippedPercentage: `${slippedPercentage}%`,
      ...(insufficientOutput !== undefined && { insufficientOutput }),
    };

    super(JSON.stringify(errorDetails));
    this.name = 'SlippageCheckError';
  }
}

export class TooStrictSlippageCheckError extends SlippageCheckError {
  cause = 'TooStrictSlippageCheckError';

  constructor(
    dexKey: string,
    network: Network,
    side: SwapSide,
    expectedAmount: string,
    quotedAmount: string,
    slippageFactor: BigNumber,
  ) {
    super(dexKey, network, side, expectedAmount, quotedAmount, slippageFactor);
    this.name = 'TooStrictSlippageCheckError';
  }
}

export type RFQParams = [
  fromAmount: NumberAsString,
  toAmount: NumberAsString,
  wrapApproveDirection: NumberAsString,
  metadata: string,
  beneficiary: Address,
];

export type RFQDirectPayload = [
  params: RFQParams,
  orders: OrderInfo[],
  permit: string,
];

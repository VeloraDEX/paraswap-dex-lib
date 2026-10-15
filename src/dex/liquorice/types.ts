import { RequestHeaders } from '../../dex-helper';
import { Address, NumberAsString } from '../../types';

export type DexParams = {
  settlementAddress: Address;
  balanceManagerAddress: Address;
  // Gas of the LiquoriceSettlement call, reported to the router
  gasCost: number;
};

export type LiquoriceSide = 'SELL' | 'BUY';

// [price (dest per src), incremental src amount], human units, consumed in order
export type LiquoriceLevel = [string, string];

// One maker's curve. The maker only quotes amounts within [minAmount, sum of level amounts].
export type LiquoriceCurve = {
  minAmount: string;
  levels: LiquoriceLevel[];
};

export type LiquoricePricesResponse = {
  updatedAt: number;
  // Keyed by `${srcToken}_${destToken}`, lowercase. Directional: src is what the trader sells.
  pairs: Record<string, { curves: LiquoriceCurve[] }>;
};

export type LiquoriceToken = {
  address: Address;
  symbol: string;
  decimals: number;
};

export type LiquoriceTokensResponse = {
  tokens: LiquoriceToken[];
};

export type LiquoriceBlacklistResponse = {
  addresses: Address[];
};

export type LiquoriceFirmRequest = {
  chainId: number;
  srcToken: Address;
  destToken: Address;
  side: LiquoriceSide;
  // src amount for SELL, dest amount for BUY
  amount: NumberAsString;
  expectedAmount?: NumberAsString;
  slippageFactor?: string;
  // Augustus executor calling the settlement (Liquorice effectiveTrader)
  executionContract: Address;
  // Receiver of the dest token (Liquorice trader)
  recipient: Address;
  userAddress?: Address;
  txOrigin?: Address;
  partner?: string;
};

export type LiquoriceFirmResponse = {
  rfqId: string;
  makerRfqId: string;
  to: Address;
  data: string;
  value: NumberAsString;
  spender: Address;
  srcAmount: NumberAsString;
  destAmount: NumberAsString;
  // amountInPos: byte position of the fill amount in `data`, counted from the
  // start of calldata including the selector (ready for insertFromAmountPos)
  partialFill: { amountInPos: number; minSrcAmount: NumberAsString } | null;
  // Unix seconds
  expiry: number;
};

export type LiquoriceErrorResponse = {
  code: string;
  message: string;
};

export type LiquoriceData = {
  quote?: LiquoriceFirmResponse;
};

export type LiquoriceRateFetcherConfig = {
  pricesReqParams: { url: string; headers: RequestHeaders; params: any };
  tokensReqParams: { url: string; headers: RequestHeaders; params: any };
  blacklistReqParams: { url: string; headers: RequestHeaders; params: any };
  setBlacklist: (addresses: string[]) => Promise<void>;
};

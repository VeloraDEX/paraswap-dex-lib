import { Address, NumberAsString, Token } from '../../types';

export type PoolState = {
  tin: bigint; // toll in
  tout: bigint; // toll out
  rate: bigint;
  daiBalance: bigint; // `sellGem` ceiling
  gemBalance: bigint; // `buyGem` ceiling
};

export type LitePsmData = {
  psmAddress: Address;
  gemDecimals: number;
  toll: string;
  isApproved?: boolean;
};

export type PoolConfig = {
  gem: Token;
  pocketAddress: Address; // gem liquidity
  psmAddress: Address;
  identifier: string; // bytes32 of pool identifier (Eg. bytes32("PSM-USDC-A"))
};

export type DexParams = {
  dai: Token;
  usds: Token;
  usdsPsmAddress: Address;
  vatAddress: Address;
  pools: PoolConfig[];
};

export type LitePsmParams = [
  srcToken: Address,
  destToken: Address,
  fromAmount: NumberAsString,
  toAmount: NumberAsString,
  toll: NumberAsString,
  to18ConversionFactor: NumberAsString,
  exchange: Address,
  // psm (exchange) is the join for both dai and usds
  gemJoinAddress: Address,
  metadata: string,
  beneficiaryDirectionApproveFlag: NumberAsString,
];

export type LitePsmDirectPayload = [params: LitePsmParams, permit: string];

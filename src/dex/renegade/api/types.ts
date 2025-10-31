// Request body for assemble external match endpoint
export type AssembleExternalMatchRequest = {
  signed_quote: SignedExternalQuote;
  do_gas_estimation?: boolean;
  allow_shared?: boolean;
  matching_pool?: string;
  relayer_fee_rate?: number;
  receiver_address?: string | null;
  updated_order?: ExternalOrder | null;
};

// External order structure for Renegade match requests
export type ExternalOrder = {
  quote_mint: string;
  base_mint: string;
  side: 'Buy' | 'Sell';
  base_amount: string;
  quote_amount: string;
  exact_base_output: string;
  exact_quote_output: string;
  min_fill_size: string;
};

// Request body for quote endpoint
export type ExternalQuoteRequest = {
  external_order: ExternalOrder;
  matching_pool?: string;
  relayer_fee_rate?: number;
};

// Quote with signature binding it to the relayer
export type SignedExternalQuote = {
  quote: ApiExternalQuote;
  signature: string;
};

// Response from assemble endpoint
export type SponsoredMatchResponse = {
  match_bundle: AtomicMatchApiBundle;
  is_sponsored: boolean;
  gas_sponsorship_info?: GasSponsorshipInfo | null;
};

// Response from quote endpoint with signed quote and optional sponsorship
export type SponsoredQuoteResponse = {
  signed_quote: SignedExternalQuote;
  gas_sponsorship_info?: SignedGasSponsorshipInfo | null;
};

// Optional query parameters for quote and assembly endpoints
export type QuoteQueryParams = {
  disable_gas_sponsorship?: boolean;
  refund_address?: string;
  refund_native_eth?: boolean;
  use_gas_sponsorship?: boolean;
};

// Represents a token transfer with mint address and amount
type ApiExternalAssetTransfer = {
  mint: string;
  amount: string;
};

// Match result with quote/base mints, amounts, and direction
type ApiExternalMatchResult = {
  quote_mint: string;
  base_mint: string;
  quote_amount: string;
  base_amount: string;
  direction: 'Buy' | 'Sell';
};

// Price with timestamp
type ApiTimestampedPrice = {
  price: string;
  timestamp: number;
};

// Complete match bundle with settlement transaction
type AtomicMatchApiBundle = {
  match_result: ApiExternalMatchResult;
  fees: FeeTake;
  receive: ApiExternalAssetTransfer;
  send: ApiExternalAssetTransfer;
  settlement_tx: TransactionRequest;
};

// Complete quote structure with order, match result, fees, and pricing
type ApiExternalQuote = {
  order: ExternalOrder;
  match_result: ApiExternalMatchResult;
  fees: FeeTake;
  send: ApiExternalAssetTransfer;
  receive: ApiExternalAssetTransfer;
  price: ApiTimestampedPrice;
  timestamp: number;
};

// Relayer and protocol fees
type FeeTake = {
  relayer_fee: string;
  protocol_fee: string;
};

// Gas refund details
type GasSponsorshipInfo = {
  refund_amount: string;
  refund_native_eth: boolean;
  refund_address: string | null;
};

// Signed gas sponsorship info (deprecated signature field)
type SignedGasSponsorshipInfo = {
  gas_sponsorship_info: GasSponsorshipInfo;
  signature: string; // deprecated
};

// EIP-1559 / EIP-4844 aware transaction request
type TransactionRequest = {
  from?: string | null;
  to?: string | null;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  maxFeePerBlobGas?: string;
  gas?: string;
  value?: string;
  input?: string;
  data?: string;
  nonce?: string;
  chainId?: string;
  accessList?: Array<{
    address: string;
    storageKeys: string[];
  }>;
  type?: string;
  blobVersionedHashes?: string[];
  sidecar?: Record<string, any>;
  authorizationList?: Array<Record<string, any>>;
};

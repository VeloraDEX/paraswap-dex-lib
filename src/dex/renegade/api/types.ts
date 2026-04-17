export type ExternalOrder = {
  input_mint: string;
  output_mint: string;
  input_amount: string;
  output_amount: string;
  use_exact_output_amount: boolean;
  min_fill_size: string;
};

type AssetTransfer = {
  mint: string;
  amount: string;
};

type DirectOrderAssembly = {
  type: 'direct-order';
  external_order: ExternalOrder;
};

export type AssembleExternalMatchRequest = {
  do_gas_estimation?: boolean;
  order: DirectOrderAssembly;
};

export type SponsoredMatchResponse = {
  match_bundle: {
    min_receive: AssetTransfer;
    max_receive: AssetTransfer;
    min_send: AssetTransfer;
    max_send: AssetTransfer;
    deadline: number | string;
    settlement_tx: SettlementTxResponse;
  };
  input_amount?: string | null;
  gas_sponsorship_info?: {
    refund_amount: string;
    refund_native_eth: boolean;
    refund_address: string | null;
  } | null;
};

type SettlementTxResponse = {
  to: string;
  data?: string;
  input?: string;
  value?: string;
};

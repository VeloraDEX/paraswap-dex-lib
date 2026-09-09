export const WITHDRAW_TOPIC =
  '0xfbde797d201c681b91056529119e0b02407c7bb96a4a2c75c01fc9667232c8db';
export const DEPOSIT_TOPIC =
  '0xdcbc1c05240f31ff3ad067ef1ee35ce4997762752e3a095284754544f4c709d7';
export const TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// Vaults whose pool state is fully derivable from logs, so an event-derived state can be
// compared against on-chain. The rest are excluded because `totalAssets` moves without
// emitting anything (sUSDe vests its yield linearly over time).
export const LOG_DERIVABLE_STATE_VAULTS = new Set(['sftUSD']);

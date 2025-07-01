export type KelpPoolState = {
  rsETHToETHRate: bigint;
};

export type KelpData = {};

export type DexParams = {
  lrtDepositPool: string;
  rsETH: string;
  weth: string;
  stETH: string;
  wstETH: string;
  ETHx: string;
  lrtOracle: string;
};

export enum wstETHFunctions {
  unwrap = 'unwrap',
  getStETHByWstETH = 'getStETHByWstETH',
}

export enum lrtDepositPoolFunctions {
  getRsETHAmountToMint = 'getRsETHAmountToMint',
  depositETH = 'depositETH',
  depositAsset = 'depositAsset',
}

export enum lrtOracleFunctions {
  rsETHPrice = 'rsETHPrice',
}

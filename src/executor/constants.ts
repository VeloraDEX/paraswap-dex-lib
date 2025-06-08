import { toBeHex, zeroPadValue } from 'ethers';
import { Network } from '../constants';

export const BYTES_28_LENGTH = 28;
export const BYTES_64_LENGTH = 64;
export const BYTES_96_LENGTH = 96;

export const ZEROS_4_BYTES = zeroPadValue(toBeHex(0), 4);
export const ZEROS_12_BYTES = zeroPadValue(toBeHex(0), 12);
export const ZEROS_20_BYTES = zeroPadValue(toBeHex(0), 20);
export const ZEROS_28_BYTES = zeroPadValue(toBeHex(0), 28);
export const ZEROS_32_BYTES = zeroPadValue(toBeHex(0), 32);

export const SWAP_EXCHANGE_100_PERCENTAGE = 100;

export const NOT_EXISTING_EXCHANGE_PARAM_INDEX = -1;

export const ETH_SRC_TOKEN_POS_FOR_MULTISWAP_METADATA = '0xEEEEEEEEEEEEEEEE';

export const EXECUTOR_01_02_FUNCTION_CALL_DATA_TYPES: string[] = [
  'bytes20', // address
  'bytes4', // calldata Size
  'bytes2', // fromAmount Pos
  'bytes2', // srcTokenPos
  'bytes1', // returnAmount Pos
  'bytes1', // specialExchange
  'bytes2', // flag
  'bytes28', // zero padding
  'bytes', // dex calldata
];

export const EXECUTOR_03_FUNCTION_CALL_DATA_TYPES: string[] = [
  'bytes20', // address(bytes20)
  'bytes2', // calldata Size(bytes 2)
  'bytes2', // toAmount Pos(bytes2)
  'bytes2', // fromAmount Pos(bytes2)
  'bytes2', // srcTokenPos(bytes2)
  'bytes2', // specialExchange (bytes2)
  'bytes2', // flag(bytes2)
  'bytes28', // zero padding (bytes28)
  'bytes', // dex calldata (bytes)
];

export const APPROVE_CALLDATA_DEST_TOKEN_POS = 68;
export const WRAP_UNWRAP_FROM_AMOUNT_POS = 4;
export const DEFAULT_RETURN_AMOUNT_POS = 255;

export const RETURN_AMOUNT_POS_0 = 0;
export const RETURN_AMOUNT_POS_32 = 32;

// TODO-v6?: can it be removed  after approval/cache task, because we are going to give approvals only once,
// therefore for any case initial allowance would be 0
export const DISABLED_MAX_UNIT_APPROVAL_TOKENS: Partial<
  Record<Network, string[]>
> = {
  // USDT don't allow approve for MAX_UINT if current approval is not 0
  [Network.MAINNET]: [
    '0xdac17f958d2ee523a2206206994597c13d831ec7',
    '0xd101dcc414f310268c37eeb4cd376ccfa507f571',
    '0x0f5d2fb29fb7d3cfee444a200298f468908cc942',
  ],
};

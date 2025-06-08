import { ethers } from 'ethers';
import { PoolKey, UniswapV4Data } from './types';
import { Address } from '../../types';
import RouterAbi from '../../abi/uniswap-v4/router.abi.json';
import { Interface } from '@ethersproject/abi';
import { isETHAddress } from '../../utils';
import { NULL_ADDRESS } from '../../constants';

const routerIface = new Interface(RouterAbi);

enum Commands {
  V4_SWAP = 16, // 0x10 -> 16
}

export enum Actions {
  // Swapping
  SWAP_EXACT_IN_SINGLE = 6, // 0x06 -> 6
  SWAP_EXACT_IN = 7, // 0x07 -> 7
  SWAP_EXACT_OUT_SINGLE = 8, // 0x08 -> 8
  SWAP_EXACT_OUT = 9, // 0x09 -> 9

  // Settling (paying funds)
  SETTLE = 11, // 0x0b -> 11
  SETTLE_ALL = 12, // 0x0c -> 12
  SETTLE_PAIR = 13, // 0x0d -> 13

  // Taking (receiving funds)
  TAKE = 14, // 0x0e -> 14
  TAKE_ALL = 15, // 0x0f -> 15
  TAKE_PORTION = 16, // 0x10 -> 16
  TAKE_PAIR = 17, // 0x11 -> 17
}

enum ActionConstants {
  OPEN_DELTA = 0,
  // This value is equivalent to 1<<255, i.e. a singular 1 in the most significant bit.
  CONTRACT_BALANCE = '57896044618658097711785492504343953926634992332820282019728792003956564819968',
  // address(1)
  MSG_SENDER = '0x0000000000000000000000000000000000000001',
  // address(2)
  ADDRESS_THIS = '0x0000000000000000000000000000000000000002',
}

type PathKey = {
  intermediateCurrency: string;
  fee: bigint;
  tickSpacing: bigint;
  hooks: string;
  hookData: string;
};

interface ExactInputSingleParams {
  poolKey: PoolKey;
  zeroForOne: boolean;
  amountIn: bigint;
  amountOutMinimum: bigint;
  hookData: string;
}

interface ExactInputParams {
  currencyIn: string;
  amountIn: bigint;
  amountOutMinimum: bigint;
  path: PathKey[];
}

interface ExactOutputSingleParams {
  poolKey: PoolKey;
  zeroForOne: boolean;
  amountOut: bigint;
  amountInMaximum: bigint;
  hookData: string;
}

interface ExactOutputParams {
  currencyOut: string;
  amountOut: bigint;
  amountInMaximum: bigint;
  path: PathKey[];
}

const MAX_UINT128 = 340282366920938463463374607431768211455n;

function encodeActions(actions: Actions[]): string {
  const types = actions.map(() => 'uint8');
  return ethers.solidityPacked(types, actions);
}

function encodeInputForExecute(
  actions: string,
  actionValues: string[],
): string {
  const command = ethers.solidityPacked(['uint8'], [Commands.V4_SWAP]);

  const input = ethers.AbiCoder.defaultAbiCoder().encode(
    ['bytes', 'bytes[]'],
    [actions, actionValues],
  );

  return routerIface.encodeFunctionData('execute(bytes,bytes[])', [
    command,
    [input],
  ]);
}

function encodeSettle(
  srcToken: string,
  amountIn: ActionConstants | bigint,
  takeFundsFromMsgSender: boolean,
): string {
  const settle = ethers.AbiCoder.defaultAbiCoder().encode(
    ['address', 'uint256', 'bool'],
    // srcToken, amountIn (`OPEN_DELTA` to settle all needed funds), takeFundsFromMsgSender (Executor in our case)
    [
      isETHAddress(srcToken) ? NULL_ADDRESS : srcToken,
      amountIn,
      takeFundsFromMsgSender,
    ],
  );

  return settle;
}

function encodeTake(
  destToken: string,
  recipient: string,
  amountOut: ActionConstants | bigint,
) {
  const take = ethers.AbiCoder.defaultAbiCoder().encode(
    ['address', 'address', 'uint256'],
    // destToken, recipient, amountOut (`OPEN_DELTA` to take all funds)
    [isETHAddress(destToken) ? NULL_ADDRESS : destToken, recipient, amountOut],
  );

  return take;
}

// Single hop encoding for SELL side
export function swapExactInputSingleCalldata(
  srcToken: Address,
  destToken: Address,
  poolKey: PoolKey,
  zeroForOne: boolean,
  amountIn: bigint,
  amountOutMinimum: bigint,
  recipient: Address,
): string {
  const actions = encodeActions([
    Actions.SWAP_EXACT_IN_SINGLE,
    Actions.SETTLE,
    Actions.TAKE,
  ]);

  const exactInputSingleParams: ExactInputSingleParams = {
    poolKey,
    zeroForOne,
    amountIn,
    amountOutMinimum,
    hookData: '0x', // empty bytes
  };

  // encode SWAP_EXACT_IN_SINGLE
  const swap = ethers.AbiCoder.defaultAbiCoder().encode(
    [
      /*
         ExactInputSingleParams {
            PoolKey poolKey;
            bool zeroForOne;
            uint128 amountIn;
            uint128 amountOutMinimum;
            bytes hookData;
         }
      */
      'tuple((address,address,uint24,int24,address) poolKey, bool zeroForOne, uint128 amountIn, uint128 amountOutMinimum, bytes hookData)',
    ],
    [
      [
        [
          poolKey.currency0,
          poolKey.currency1,
          poolKey.fee,
          poolKey.tickSpacing,
          poolKey.hooks,
        ],
        exactInputSingleParams.zeroForOne,
        exactInputSingleParams.amountIn,
        exactInputSingleParams.amountOutMinimum,
        exactInputSingleParams.hookData,
      ],
    ],
  );

  const settle = encodeSettle(srcToken, ActionConstants.OPEN_DELTA, true);
  const take = encodeTake(destToken, recipient, ActionConstants.OPEN_DELTA);

  return encodeInputForExecute(actions, [swap, settle, take]);
}

// Multi-hop encoding for SELL side
export function swapExactInputCalldata(
  srcToken: Address,
  destToken: Address,
  data: UniswapV4Data,
  amountIn: bigint,
  amountOutMinimum: bigint,
  recipient: Address,
): string {
  const actions = encodeActions([
    Actions.SWAP_EXACT_IN,
    Actions.SETTLE,
    Actions.TAKE,
  ]);

  const exactInputParams: ExactInputParams = {
    currencyIn: isETHAddress(data.path[0].tokenIn)
      ? NULL_ADDRESS
      : data.path[0].tokenIn,
    amountIn,
    amountOutMinimum,
    path: data.path.map(path => ({
      intermediateCurrency: isETHAddress(path.tokenOut)
        ? NULL_ADDRESS
        : path.tokenOut,
      fee: BigInt(path.pool.key.fee),
      tickSpacing: BigInt(path.pool.key.tickSpacing),
      hooks: NULL_ADDRESS,
      hookData: '0x',
    })),
  };

  // encode SWAP_EXACT_IN
  const swap = ethers.AbiCoder.defaultAbiCoder().encode(
    [
      /*
        PathKey {
          Currency intermediateCurrency;
          uint24 fee;
          int24 tickSpacing;
          IHooks hooks;
          bytes hookData;
        }
        ExactInputParams {
          address currencyIn;
          PathKey[] path;
          uint128 amountIn;
          uint128 amountOutMinimum;
        }
      */
      'tuple(address currencyIn, (address,uint24,int24,address,bytes)[] path, uint128 amountIn, uint128 amountOutMinimum)',
    ],
    [
      {
        currencyIn: exactInputParams.currencyIn,
        path: exactInputParams.path.map(pathKey => {
          return [
            pathKey.intermediateCurrency,
            pathKey.fee,
            pathKey.tickSpacing,
            pathKey.hooks,
            pathKey.hookData,
          ];
        }),
        amountIn: exactInputParams.amountIn,
        amountOutMinimum: exactInputParams.amountOutMinimum,
      },
    ],
  );

  const settle = encodeSettle(srcToken, ActionConstants.OPEN_DELTA, true);
  const take = encodeTake(destToken, recipient, ActionConstants.OPEN_DELTA);

  return encodeInputForExecute(actions, [swap, settle, take]);
}

// Single hop encoding for BUY side
export function swapExactOutputSingleCalldata(
  srcToken: Address,
  destToken: Address,
  poolKey: PoolKey,
  zeroForOne: boolean,
  amountOut: bigint,
  recipient: Address,
): string {
  const actions = encodeActions([
    Actions.SWAP_EXACT_OUT_SINGLE,
    Actions.SETTLE,
    Actions.TAKE,
  ]);
  const exactOutputSingleParams: ExactOutputSingleParams = {
    poolKey,
    zeroForOne,
    amountOut,
    amountInMaximum: MAX_UINT128,
    hookData: '0x', // empty bytes
  };

  // encode SWAP_EXACT_OUTPUT_SINGLE
  const swap = ethers.AbiCoder.defaultAbiCoder().encode(
    [
      /*
        ExactOutputSingleParams {
          PoolKey poolKey;
          bool zeroForOne;
          uint128 amountOut;
          uint128 amountInMaximum;
          bytes hookData;
        }
      */
      'tuple((address,address,uint24,int24,address) poolKey, bool zeroForOne, uint128 amountOut, uint128 amountInMaximum, bytes hookData)',
    ],
    [
      [
        [
          poolKey.currency0,
          poolKey.currency1,
          poolKey.fee,
          poolKey.tickSpacing,
          poolKey.hooks,
        ],
        exactOutputSingleParams.zeroForOne,
        exactOutputSingleParams.amountOut,
        exactOutputSingleParams.amountInMaximum,
        exactOutputSingleParams.hookData,
      ],
    ],
  );

  const settle = encodeSettle(srcToken, ActionConstants.OPEN_DELTA, true);
  const take = encodeTake(destToken, recipient, ActionConstants.OPEN_DELTA);

  return encodeInputForExecute(actions, [swap, settle, take]);
}

// Multi-hop encoding for SELL side
export function swapExactOutputCalldata(
  srcToken: Address,
  destToken: Address,
  data: UniswapV4Data,
  amountOut: bigint,
  recipient: Address,
): string {
  const actions = encodeActions([
    Actions.SWAP_EXACT_OUT,
    Actions.SETTLE,
    Actions.TAKE,
  ]);

  const exactOutputParams: ExactOutputParams = {
    currencyOut: isETHAddress(data.path[data.path.length - 1].tokenOut)
      ? NULL_ADDRESS
      : data.path[data.path.length - 1].tokenOut,
    amountOut,
    amountInMaximum: MAX_UINT128,
    path: data.path.map(path => ({
      intermediateCurrency: isETHAddress(path.tokenIn)
        ? NULL_ADDRESS
        : path.tokenIn,
      fee: BigInt(path.pool.key.fee),
      tickSpacing: BigInt(path.pool.key.tickSpacing),
      hooks: NULL_ADDRESS,
      hookData: '0x',
    })),
  };

  // encode SWAP_EXACT_OUTPUT
  const swap = ethers.AbiCoder.defaultAbiCoder().encode(
    [
      /*
         PathKey {
          Currency intermediateCurrency;
          uint24 fee;
          int24 tickSpacing;
          IHooks hooks;
          bytes hookData;
        }
        ExactOutputParams {
          address currencyOut;
          PathKey[] path;
          uint128 amountOut;
          uint128 amountInMaximum;
        }
      */
      'tuple(address currencyOut, (address,uint24,int24,address,bytes)[] path, uint128 amountOut, uint128 amountInMaximum)',
    ],
    [
      {
        currencyOut: exactOutputParams.currencyOut,
        path: exactOutputParams.path.map(pathKey => {
          return [
            pathKey.intermediateCurrency,
            pathKey.fee,
            pathKey.tickSpacing,
            pathKey.hooks,
            pathKey.hookData,
          ];
        }),
        amountOut: exactOutputParams.amountOut,
        amountInMaximum: exactOutputParams.amountInMaximum,
      },
    ],
  );

  const settle = encodeSettle(srcToken, ActionConstants.OPEN_DELTA, true);
  const take = encodeTake(destToken, recipient, ActionConstants.OPEN_DELTA);

  return encodeInputForExecute(actions, [swap, settle, take]);
}

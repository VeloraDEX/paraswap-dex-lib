import { ethers } from 'ethers';
import { PoolKey, UniswapV4Data } from './types';
import { Address } from '../../types';
import RouterAbi from '../../abi/uniswap-v4/router.abi.json';
import { Interface } from '@ethersproject/abi';
import { isETHAddress } from '../../utils';
import { NULL_ADDRESS } from '../../constants';
import { SwapSide } from '@paraswap/core/build/constants';
import { BI_MAX_UINT128 } from '../../bigint-constants';

const routerIface = new Interface(RouterAbi);

enum Commands {
  PERMIT2_TRANSFER_FROM = 2, // 0x02 -> 2
  SWEEP = 4, // 0x04 -> 4
  WRAP_ETH = 11, // 0x0b -> 11
  UNWRAP_WETH = 12, // 0x0c -> 12
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

function encodeActions(actions: Actions[]): string {
  const types = actions.map(() => 'uint8');
  return ethers.utils.solidityPack(types, actions);
}

function encodeInputForExecute(
  srcToken: Address,
  destToken: Address,
  data: UniswapV4Data,
  side: SwapSide,
  amountIn: bigint,
  amountOut: bigint,
  recipient: string,
  encodedActions: string,
  encodedActionValues: string[],
  wethAddr: string,
): string {
  const isEthSrc = isETHAddress(srcToken);
  const isEthDest = isETHAddress(destToken);
  const isWethSrc = srcToken.toLowerCase() === wethAddr;
  const isWethDest = destToken.toLowerCase() === wethAddr;

  const firstPool = data.path[0];
  const lastPool = data.path[data.path.length - 1];

  const isWethPoolForSrc =
    firstPool.tokenIn.toLowerCase() === wethAddr ||
    firstPool.tokenOut.toLowerCase() === wethAddr;
  const isWethPoolForDest =
    lastPool.tokenOut.toLowerCase() === wethAddr ||
    lastPool.tokenIn.toLowerCase() === wethAddr;

  const isEthPoolForSrc =
    firstPool.tokenIn.toLowerCase() === NULL_ADDRESS ||
    firstPool.tokenOut.toLowerCase() === NULL_ADDRESS;
  const isEthPoolForDest =
    lastPool.tokenOut.toLowerCase() === NULL_ADDRESS ||
    lastPool.tokenIn.toLowerCase() === NULL_ADDRESS;

  const input = ethers.utils.defaultAbiCoder.encode(
    ['bytes', 'bytes[]'],
    [encodedActions, encodedActionValues],
  );

  let types = ['uint8'];
  let commands = [Commands.V4_SWAP];
  let inputs = [input];

  // Wrap ETH on Router for WETH pool
  if (isEthSrc && isWethPoolForSrc) {
    types.unshift('uint8');
    commands.unshift(Commands.WRAP_ETH);

    const wrapInput = ethers.utils.defaultAbiCoder.encode(
      ['address', 'uint256'],
      [ActionConstants.ADDRESS_THIS, ActionConstants.CONTRACT_BALANCE],
    );

    inputs.unshift(wrapInput);
  }

  // Unwrap WETH on Router for ETH pool
  if (isWethSrc && isEthPoolForSrc) {
    types.unshift('uint8');
    commands.unshift(Commands.UNWRAP_WETH);

    const unwrapInput = ethers.utils.defaultAbiCoder.encode(
      ['address', 'uint256'],
      // as all available balance will be unwrapped, set minAmount to 0
      [ActionConstants.ADDRESS_THIS, 0],
    );
    inputs.unshift(unwrapInput);
  }

  // Unwrap ETH on Router for WETH pool
  if (isEthDest && isWethPoolForDest) {
    types.push('uint8');
    commands.push(Commands.UNWRAP_WETH);

    const unwrapInput = ethers.utils.defaultAbiCoder.encode(
      ['address', 'uint256'],
      [recipient, 0],
    );
    inputs.push(unwrapInput);
  }

  // Wrap ETH on Router for ETH pool
  if (isWethDest && isEthPoolForDest) {
    types.push('uint8');
    commands.push(Commands.WRAP_ETH);

    const wrapInput = ethers.utils.defaultAbiCoder.encode(
      ['address', 'uint256'],
      [recipient, ActionConstants.CONTRACT_BALANCE],
    );

    inputs.push(wrapInput);
  }

  // take srcToken leftovers after BUY
  if (side === SwapSide.BUY) {
    // unwrap if src token was wrapped
    if (isEthSrc && isWethPoolForSrc) {
      types.push('uint8');
      commands.push(Commands.UNWRAP_WETH);

      const unwrapInput = ethers.utils.defaultAbiCoder.encode(
        ['address', 'uint256'],
        // as all available balance will be unwrapped, set minAmount to 0
        [ActionConstants.ADDRESS_THIS, 0],
      );
      inputs.push(unwrapInput);
    }
    // wrap if src token was unwrapped
    if (isWethSrc && isEthPoolForSrc) {
      types.push('uint8');
      commands.push(Commands.WRAP_ETH);

      const wrapInput = ethers.utils.defaultAbiCoder.encode(
        ['address', 'uint256'],
        [ActionConstants.ADDRESS_THIS, ActionConstants.CONTRACT_BALANCE],
      );

      inputs.push(wrapInput);
    }

    types.push('uint8');
    commands.push(Commands.SWEEP);

    const sweepInput = ethers.utils.defaultAbiCoder.encode(
      // token, recipient, minAmount
      ['address', 'address', 'uint256'],
      [isETHAddress(srcToken) ? NULL_ADDRESS : srcToken, recipient, 0],
    );

    inputs.push(sweepInput);
  }

  const command = ethers.utils.solidityPack(types, commands);

  return routerIface.encodeFunctionData('execute(bytes,bytes[])', [
    command,
    inputs,
  ]);
}

function encodeSettle(
  srcToken: string,
  data: UniswapV4Data,
  wethAddr: string,
): string {
  const isEthSrc = isETHAddress(srcToken);
  const isWethSrc = srcToken.toLowerCase() === wethAddr;
  const firstPool = data.path[0];

  const isWethPool =
    firstPool.tokenIn.toLowerCase() === wethAddr ||
    firstPool.tokenOut.toLowerCase() === wethAddr;
  const isEthPool =
    firstPool.tokenIn.toLowerCase() === NULL_ADDRESS ||
    firstPool.tokenOut.toLowerCase() === NULL_ADDRESS;

  const settle = ethers.utils.defaultAbiCoder.encode(
    ['address', 'uint256', 'bool'],
    // srcToken, amountIn (`OPEN_DELTA` to settle all needed funds), takeFundsFromMsgSender (Executor in our case)
    [
      isEthSrc && isWethPool
        ? wethAddr
        : (isEthSrc && isEthPool) || (isWethSrc && isEthPool)
        ? NULL_ADDRESS
        : srcToken,
      ActionConstants.OPEN_DELTA,
      false, // we rely on srcToken transfer before swap, so no need to take funds from msg.sender
    ],
  );

  return settle;
}

function encodeTake(
  destToken: string,
  data: UniswapV4Data,
  recipient: string,
  wethAddr: string,
) {
  const isEthDest = isETHAddress(destToken);
  const isWethDest = destToken.toLowerCase() === wethAddr;
  const lastPool = data.path[data.path.length - 1];
  const isWethPool =
    lastPool.tokenOut.toLowerCase() === wethAddr ||
    lastPool.tokenIn.toLowerCase() === wethAddr;
  const isEthPool =
    lastPool.tokenOut.toLowerCase() === NULL_ADDRESS ||
    lastPool.tokenIn.toLowerCase() === NULL_ADDRESS;

  const take = ethers.utils.defaultAbiCoder.encode(
    ['address', 'address', 'uint256'],
    // destToken, recipient, amountOut (`OPEN_DELTA` to take all funds)
    [
      isEthDest && isWethPool
        ? wethAddr
        : (isWethDest && isEthPool) || (isEthDest && isEthPool)
        ? NULL_ADDRESS
        : destToken,
      (isEthDest && isWethPool) || (isWethDest && isEthPool)
        ? ActionConstants.ADDRESS_THIS
        : recipient,
      ActionConstants.OPEN_DELTA,
    ],
  );

  return take;
}

// Single hop encoding for SELL side
export function swapExactInputSingleCalldata(
  srcToken: Address,
  destToken: Address,
  data: UniswapV4Data,
  amountIn: bigint,
  amountOutMinimum: bigint,
  recipient: Address,
  weth: Address,
): string {
  const path = data.path[0];
  const poolKey = path.pool.key;

  const actions = encodeActions([
    Actions.SWAP_EXACT_IN_SINGLE,
    Actions.SETTLE,
    Actions.TAKE,
  ]);

  const exactInputSingleParams: ExactInputSingleParams = {
    poolKey,
    zeroForOne: path.zeroForOne,
    amountIn,
    amountOutMinimum,
    hookData: '0x', // TODO: Implement hook-specific data encoding
  };

  // encode SWAP_EXACT_IN_SINGLE
  const swap = ethers.utils.defaultAbiCoder.encode(
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

  const settle = encodeSettle(srcToken, data, weth);

  const take = encodeTake(destToken, data, recipient, weth);

  return encodeInputForExecute(
    srcToken,
    destToken,
    data,
    SwapSide.SELL,
    amountIn,
    amountOutMinimum,
    recipient,
    actions,
    [swap, settle, take],
    weth,
  );
}

// Multi-hop encoding for SELL side
export function swapExactInputCalldata(
  srcToken: Address,
  destToken: Address,
  data: UniswapV4Data,
  amountIn: bigint,
  amountOutMinimum: bigint,
  recipient: Address,
  weth: Address,
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
      hooks: path.pool.key.hooks,
      hookData: '0x', // TODO: Implement hook-specific data encoding
    })),
  };

  // encode SWAP_EXACT_IN
  const swap = ethers.utils.defaultAbiCoder.encode(
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

  const settle = encodeSettle(srcToken, data, weth);
  const take = encodeTake(destToken, data, recipient, weth);

  return encodeInputForExecute(
    srcToken,
    destToken,
    data,
    SwapSide.SELL,
    amountIn,
    amountOutMinimum,
    recipient,
    actions,
    [swap, settle, take],
    weth,
  );
}

// Single hop encoding for BUY side
export function swapExactOutputSingleCalldata(
  srcToken: Address,
  destToken: Address,
  data: UniswapV4Data,
  amountIn: bigint,
  amountOut: bigint,
  recipient: Address,
  weth: Address,
): string {
  const path = data.path[0];
  const poolKey = path.pool.key;
  const amountInMaximum = BI_MAX_UINT128;
  const actions = encodeActions([
    Actions.SWAP_EXACT_OUT_SINGLE,
    Actions.SETTLE,
    Actions.TAKE,
  ]);
  const exactOutputSingleParams: ExactOutputSingleParams = {
    poolKey,
    zeroForOne: path.zeroForOne,
    amountOut,
    amountInMaximum,
    hookData: '0x', // TODO: Implement hook-specific data encoding
  };

  // encode SWAP_EXACT_OUTPUT_SINGLE
  const swap = ethers.utils.defaultAbiCoder.encode(
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

  const settle = encodeSettle(srcToken, data, weth);
  const take = encodeTake(destToken, data, recipient, weth);

  return encodeInputForExecute(
    srcToken,
    destToken,
    data,
    SwapSide.BUY,
    amountIn,
    amountOut,
    recipient,
    actions,
    [swap, settle, take],
    weth,
  );
}

// Multi-hop encoding for SELL side
export function swapExactOutputCalldata(
  srcToken: Address,
  destToken: Address,
  data: UniswapV4Data,
  amountIn: bigint,
  amountOut: bigint,
  recipient: Address,
  weth: string,
): string {
  const actions = encodeActions([
    Actions.SWAP_EXACT_OUT,
    Actions.SETTLE,
    Actions.TAKE,
  ]);

  const amountInMaximum = BI_MAX_UINT128;
  const exactOutputParams: ExactOutputParams = {
    currencyOut: isETHAddress(data.path[data.path.length - 1].tokenOut)
      ? NULL_ADDRESS
      : data.path[data.path.length - 1].tokenOut,
    amountOut,
    amountInMaximum,
    path: data.path.map(path => ({
      intermediateCurrency: isETHAddress(path.tokenIn)
        ? NULL_ADDRESS
        : path.tokenIn,
      fee: BigInt(path.pool.key.fee),
      tickSpacing: BigInt(path.pool.key.tickSpacing),
      hooks: path.pool.key.hooks,
      hookData: '0x', // TODO: Implement hook-specific data encoding
    })),
  };

  // encode SWAP_EXACT_OUTPUT
  const swap = ethers.utils.defaultAbiCoder.encode(
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

  const settle = encodeSettle(srcToken, data, weth);
  const take = encodeTake(destToken, data, recipient, weth);

  return encodeInputForExecute(
    srcToken,
    destToken,
    data,
    SwapSide.BUY,
    amountIn,
    amountOut,
    recipient,
    actions,
    [swap, settle, take],
    weth,
  );
}

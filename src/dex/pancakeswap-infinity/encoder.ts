import { ethers } from 'ethers';
import { Interface } from '@ethersproject/abi';
import { SwapSide } from '@paraswap/core/build/constants';
import { Address } from '../../types';
import { isETHAddress } from '../../utils';
import { NULL_ADDRESS } from '../../constants';
import { BI_MAX_UINT128 } from '../../bigint-constants';
import { PancakeSwapInfinityData, PathStep } from './types';
import RouterAbi from '../../abi/uniswap-v4/router.abi.json';

const routerIface = new Interface(RouterAbi);

// PancakeSwapInfinity PoolKey ABI tuple
// (address currency0, address currency1, address hooks, address poolManager, uint24 fee, bytes32 parameters)
const POOL_KEY_TUPLE = '(address,address,address,address,uint24,bytes32)';

enum Commands {
  PERMIT2_TRANSFER_FROM = 2, // 0x02
  SWEEP = 4, // 0x04
  WRAP_ETH = 11, // 0x0b
  UNWRAP_WETH = 12, // 0x0c
  V4_SWAP = 16, // 0x10
}

enum Actions {
  SWAP_EXACT_IN_SINGLE = 6, // 0x06
  SWAP_EXACT_IN = 7, // 0x07
  SWAP_EXACT_OUT_SINGLE = 8, // 0x08
  SWAP_EXACT_OUT = 9, // 0x09
  SETTLE = 11, // 0x0b
  SETTLE_ALL = 12, // 0x0c
  TAKE = 14, // 0x0e
  TAKE_ALL = 15, // 0x0f
}

enum ActionConstants {
  OPEN_DELTA = 0,
  CONTRACT_BALANCE = '57896044618658097711785492504343953926634992332820282019728792003956564819968',
  MSG_SENDER = '0x0000000000000000000000000000000000000001',
  ADDRESS_THIS = '0x0000000000000000000000000000000000000002',
}

function encodeActions(actions: Actions[]): string {
  const types = actions.map(() => 'uint8');
  return ethers.utils.solidityPack(types, actions);
}

function getFirstStep(data: PancakeSwapInfinityData): PathStep {
  const step = data.path[0];
  if (!step) {
    throw new Error('PancakeSwapInfinityData.path must have at least one step');
  }
  return step;
}

// CL pool `parameters` bytes32 layout:
//   bits [0:15]  — hooks registration bitmap (uint16), must match what the
//                  hook contract self-registers at pool init
//   bits [16:39] — tickSpacing (int24)
//   bits [40:]   — reserved / zero for CL pools
//
// WARNING — incorrect for pools with hook callbacks registered:
// The new PancakeSwapInfinityData shape carries only `tickSpacing`, not the
// hooks registration bitmap, so we zero out bits [0:15]. For pools where
// `hooks == address(0)` (or a hook contract that registers no callbacks)
// the bitmap is 0 and this is correct. For any pool with registered hook
// callbacks, the produced `parameters` differs from the on-chain value,
// which changes `poolId = keccak256(poolKey)` and causes the swap to revert
// (`PoolNotInitialized`). Fix requires either extending the input shape
// with `hooksRegistration`, or reading the bitmap from the hook contract.
function encodeParameters(tickSpacing: number): string {
  return ethers.utils.hexZeroPad(
    ethers.utils.hexlify(BigInt(tickSpacing) << 16n),
    32,
  );
}

function encodePoolKeyTuple(step: PathStep): any[] {
  const { key } = step.pool;
  return [
    key.currency0,
    key.currency1,
    key.hooks,
    key.poolManager,
    key.fee,
    encodeParameters(key.tickSpacing),
  ];
}

function getPoolCurrencies(step: PathStep) {
  const { key } = step.pool;
  const srcCurrency = step.zeroForOne ? key.currency0 : key.currency1;
  const destCurrency = step.zeroForOne ? key.currency1 : key.currency0;
  return { srcCurrency, destCurrency };
}

function isNativeCurrency(currency: string): boolean {
  return currency.toLowerCase() === NULL_ADDRESS;
}

function isWethCurrency(currency: string, wethAddr: string): boolean {
  return currency.toLowerCase() === wethAddr;
}

function encodeSettle(
  srcToken: string,
  step: PathStep,
  wethAddr: string,
): string {
  const isEthSrc = isETHAddress(srcToken);
  const isWethSrc = srcToken.toLowerCase() === wethAddr;
  const { srcCurrency } = getPoolCurrencies(step);
  const isWethPool = isWethCurrency(srcCurrency, wethAddr);
  const isEthPool = isNativeCurrency(srcCurrency);

  const settleToken =
    isEthSrc && isWethPool
      ? wethAddr
      : (isEthSrc && isEthPool) || (isWethSrc && isEthPool)
      ? NULL_ADDRESS
      : srcToken;

  return ethers.utils.defaultAbiCoder.encode(
    ['address', 'uint256', 'bool'],
    [settleToken, ActionConstants.OPEN_DELTA, false],
  );
}

function encodeTake(
  destToken: string,
  step: PathStep,
  recipient: string,
  wethAddr: string,
): string {
  const isEthDest = isETHAddress(destToken);
  const isWethDest = destToken.toLowerCase() === wethAddr;
  const { destCurrency } = getPoolCurrencies(step);
  const isWethPool = isWethCurrency(destCurrency, wethAddr);
  const isEthPool = isNativeCurrency(destCurrency);

  const takeToken =
    isEthDest && isWethPool
      ? wethAddr
      : (isWethDest && isEthPool) || (isEthDest && isEthPool)
      ? NULL_ADDRESS
      : destToken;

  const takeRecipient =
    (isEthDest && isWethPool) || (isWethDest && isEthPool)
      ? ActionConstants.ADDRESS_THIS
      : recipient;

  return ethers.utils.defaultAbiCoder.encode(
    ['address', 'address', 'uint256'],
    [takeToken, takeRecipient, ActionConstants.OPEN_DELTA],
  );
}

function encodeInputForExecute(
  srcToken: Address,
  destToken: Address,
  step: PathStep,
  side: SwapSide,
  recipient: string,
  encodedActions: string,
  encodedActionValues: string[],
  wethAddr: string,
): string {
  const isEthSrc = isETHAddress(srcToken);
  const isEthDest = isETHAddress(destToken);
  const isWethSrc = srcToken.toLowerCase() === wethAddr;
  const isWethDest = destToken.toLowerCase() === wethAddr;

  const { srcCurrency, destCurrency } = getPoolCurrencies(step);
  const isWethPoolForSrc = isWethCurrency(srcCurrency, wethAddr);
  const isEthPoolForSrc = isNativeCurrency(srcCurrency);
  const isWethPoolForDest = isWethCurrency(destCurrency, wethAddr);
  const isEthPoolForDest = isNativeCurrency(destCurrency);

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
    inputs.unshift(
      ethers.utils.defaultAbiCoder.encode(
        ['address', 'uint256'],
        [ActionConstants.ADDRESS_THIS, ActionConstants.CONTRACT_BALANCE],
      ),
    );
  }

  // Unwrap WETH on Router for native pool
  if (isWethSrc && isEthPoolForSrc) {
    types.unshift('uint8');
    commands.unshift(Commands.UNWRAP_WETH);
    inputs.unshift(
      ethers.utils.defaultAbiCoder.encode(
        ['address', 'uint256'],
        [ActionConstants.ADDRESS_THIS, 0],
      ),
    );
  }

  // Unwrap WETH on Router after swap for ETH dest + WETH pool
  if (isEthDest && isWethPoolForDest) {
    types.push('uint8');
    commands.push(Commands.UNWRAP_WETH);
    inputs.push(
      ethers.utils.defaultAbiCoder.encode(
        ['address', 'uint256'],
        [recipient, 0],
      ),
    );
  }

  // Wrap WETH on Router after swap for WETH dest + native pool
  if (isWethDest && isEthPoolForDest) {
    types.push('uint8');
    commands.push(Commands.WRAP_ETH);
    inputs.push(
      ethers.utils.defaultAbiCoder.encode(
        ['address', 'uint256'],
        [recipient, ActionConstants.CONTRACT_BALANCE],
      ),
    );
  }

  // Sweep src token leftovers after BUY
  if (side === SwapSide.BUY) {
    if (isEthSrc && isWethPoolForSrc) {
      types.push('uint8');
      commands.push(Commands.UNWRAP_WETH);
      inputs.push(
        ethers.utils.defaultAbiCoder.encode(
          ['address', 'uint256'],
          [ActionConstants.ADDRESS_THIS, 0],
        ),
      );
    }
    if (isWethSrc && isEthPoolForSrc) {
      types.push('uint8');
      commands.push(Commands.WRAP_ETH);
      inputs.push(
        ethers.utils.defaultAbiCoder.encode(
          ['address', 'uint256'],
          [ActionConstants.ADDRESS_THIS, ActionConstants.CONTRACT_BALANCE],
        ),
      );
    }
    types.push('uint8');
    commands.push(Commands.SWEEP);
    inputs.push(
      ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint256'],
        [isETHAddress(srcToken) ? NULL_ADDRESS : srcToken, recipient, 0],
      ),
    );
  }

  const command = ethers.utils.solidityPack(types, commands);
  return routerIface.encodeFunctionData('execute(bytes,bytes[])', [
    command,
    inputs,
  ]);
}

export function swapExactInputSingleCalldata(
  srcToken: Address,
  destToken: Address,
  data: PancakeSwapInfinityData,
  amountIn: bigint,
  amountOutMinimum: bigint,
  recipient: Address,
  weth: Address,
): string {
  const step = getFirstStep(data);

  const actions = encodeActions([
    Actions.SWAP_EXACT_IN_SINGLE,
    Actions.SETTLE,
    Actions.TAKE,
  ]);

  const swap = ethers.utils.defaultAbiCoder.encode(
    [
      `tuple(${POOL_KEY_TUPLE} poolKey, bool zeroForOne, uint128 amountIn, uint128 amountOutMinimum, bytes hookData)`,
    ],
    [
      [
        encodePoolKeyTuple(step),
        step.zeroForOne,
        amountIn,
        amountOutMinimum,
        '0x',
      ],
    ],
  );

  const settle = encodeSettle(srcToken, step, weth);
  const take = encodeTake(destToken, step, recipient, weth);

  return encodeInputForExecute(
    srcToken,
    destToken,
    step,
    SwapSide.SELL,
    recipient,
    actions,
    [swap, settle, take],
    weth,
  );
}

export function swapExactOutputSingleCalldata(
  srcToken: Address,
  destToken: Address,
  data: PancakeSwapInfinityData,
  _amountInMaximum: bigint,
  amountOut: bigint,
  recipient: Address,
  weth: Address,
): string {
  const step = getFirstStep(data);

  const actions = encodeActions([
    Actions.SWAP_EXACT_OUT_SINGLE,
    Actions.SETTLE,
    Actions.TAKE,
  ]);

  const swap = ethers.utils.defaultAbiCoder.encode(
    [
      `tuple(${POOL_KEY_TUPLE} poolKey, bool zeroForOne, uint128 amountOut, uint128 amountInMaximum, bytes hookData)`,
    ],
    [
      [
        encodePoolKeyTuple(step),
        step.zeroForOne,
        amountOut,
        BI_MAX_UINT128,
        '0x',
      ],
    ],
  );

  const settle = encodeSettle(srcToken, step, weth);
  const take = encodeTake(destToken, step, recipient, weth);

  return encodeInputForExecute(
    srcToken,
    destToken,
    step,
    SwapSide.BUY,
    recipient,
    actions,
    [swap, settle, take],
    weth,
  );
}

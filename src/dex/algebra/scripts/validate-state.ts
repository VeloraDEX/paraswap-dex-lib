/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Network } from '../../../constants';
import { DummyDexHelper } from '../../../dex-helper';
import { Algebra } from '../algebra';
import { uint256ToBigInt } from '../../../lib/decoders';
import {
  DecodedStateMultiCallResultWithRelativeBitmapsV1_9,
  PoolState_v1_9,
} from '../types';
import { decodeStateMultiCallResultWithRelativeBitmapsV1_9 } from '../utils';
import { MultiCallParams, MultiWrapper } from '../../../lib/multi-wrapper';
import Web3 from 'web3';
import multiABIV2 from '../../../abi/multi-v2.json';
import ERC20ABI from '../../../abi/erc20.json';
import { getLogger } from '../../../lib/log4js';
import { Interface } from 'ethers';
import { AbiItem } from 'web3-utils';
import AlgebraStateMulticallABI from '../../../abi/algebra/AlgebraStateMulticall.abi.json';
import { TICK_BITMAP_TO_USE, TICK_BITMAP_BUFFER } from '../constants';
import { BlockHeader } from 'web3-eth';

// public RPC, replace to RPC with archive node
const web3Provider = new Web3('');

// pool and tokens for specific broken tx - 0x9a296a13f7c5eb8ce838e15ecbe3888e8998a14803a1ec46838611e1ff118d6e
const factoryAddress = '0x1a3c9b1d2f0529d97f2afc5136cc23e58f1fd35b';
const poolAddress = '0xb1026b8e7276e7ac75410f1fcbbe21796e8f7526';
const srcToken = {
  address: `0x82af49447d8a07e3bd95bd0d56f35241523fbab1`,
  decimals: 18,
};
const destToken = {
  address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
  decimals: 6,
};
const blockHeaders: Record<number, BlockHeader> = {};

const multiContract = new web3Provider.eth.Contract(
  multiABIV2 as any,
  '0x7eCfBaa8742fDf5756DAC92fbc8b90a19b8815bF',
);
const stateMultiContract = new web3Provider.eth.Contract(
  AlgebraStateMulticallABI as AbiItem[],
  '0x2cB568442a102dF518b3D37CBD0d2884523C940B',
);

const multiWrapper = new MultiWrapper(multiContract, getLogger(`Ticks`));
const erc20Interface = new Interface(ERC20ABI);

function getBitmapRangeToRequest() {
  return TICK_BITMAP_TO_USE + TICK_BITMAP_BUFFER;
}

async function _fetchPoolState_v1_9SingleStep(
  blockNumber: number,
): Promise<
  [bigint, bigint, DecodedStateMultiCallResultWithRelativeBitmapsV1_9]
> {
  const callData: MultiCallParams<
    bigint | DecodedStateMultiCallResultWithRelativeBitmapsV1_9
  >[] = [
    {
      target: srcToken.address,
      callData: erc20Interface.encodeFunctionData('balanceOf', [poolAddress]),
      decodeFunction: uint256ToBigInt,
    },
    {
      target: destToken.address,
      callData: erc20Interface.encodeFunctionData('balanceOf', [poolAddress]),
      decodeFunction: uint256ToBigInt,
    },
    {
      target: stateMultiContract.options.address,
      callData: stateMultiContract.methods
        .getFullStateWithRelativeBitmaps(
          factoryAddress,
          srcToken.address,
          destToken.address,
          getBitmapRangeToRequest(),
          getBitmapRangeToRequest(),
        )
        .encodeABI(),
      decodeFunction: decodeStateMultiCallResultWithRelativeBitmapsV1_9,
    },
  ];

  const [resBalance0, resBalance1, resState] = await multiWrapper.tryAggregate<
    bigint | DecodedStateMultiCallResultWithRelativeBitmapsV1_9
  >(false, callData, blockNumber, multiWrapper.defaultBatchSize, false);

  const [balance0, balance1, _state] = [
    resBalance0.returnData,
    resBalance1.returnData,
    resState.returnData,
  ] as [bigint, bigint, DecodedStateMultiCallResultWithRelativeBitmapsV1_9];

  return [balance0, balance1, _state];
}

function preprocessField(value: any): string {
  if (typeof value === 'bigint' || typeof value === 'number') {
    return value.toString();
  }
  return value;
}

function compareAndLogDifferences<T extends object, Y extends object>(
  obj1: T,
  obj2: Y,
  keyNames: Array<keyof T & keyof Y>,
  checkEachKey = false,
) {
  let isValid = true;
  let keys = keyNames;

  if (checkEachKey) {
    // find common keys
    const keys1 = Object.keys(obj1);
    const keys2 = new Set(Object.keys(obj2));
    keys = keys1.filter(key => keys2.has(key)) as Array<keyof T & keyof Y>;
  }

  for (let fieldName of keys) {
    const value1 = preprocessField(obj1[fieldName]);
    const value2 = preprocessField(obj2[fieldName]);

    if (value1 !== value2) {
      console.log(
        `${fieldName.toString()} mismatch: actual: ${value1} vs pool: ${value2}`,
      );
      isValid = false;
    }
  }

  return isValid;
}

async function isPoolStateEqualToReal(
  state: PoolState_v1_9,
  blockNumber: number,
) {
  const [balance0, balance1, contractState] =
    await _fetchPoolState_v1_9SingleStep(blockNumber);

  const isValidBalances = compareAndLogDifferences(
    state,
    { balance0, balance1, ...contractState },
    ['balance0', 'balance1', 'liquidity', 'tickSpacing'],
  );

  const isValidGlobalState = compareAndLogDifferences(
    state.globalState,
    contractState.globalState,
    // can check only for one of them, because they are directly co-related
    ['price', 'tick'],
  );

  const isValidTickBitmap = compareAndLogDifferences(
    state.tickBitmap,
    contractState.tickBitmap,
    [],
    true,
  );

  let isValidTicks = true;
  for (let tick of contractState.ticks) {
    const stateTick = state?.ticks[tick.index];

    const isValidTick = compareAndLogDifferences(stateTick, tick.value, [
      'liquidityGross',
      'liquidityNet',
      // next fields doesn't affect pricing, so skip checks
      // 'initialized',
      // 'secondsOutside',
      // 'secondsPerLiquidityOutsideX128',
      // 'tickCumulativeOutside'
    ]);

    if (isValidTicks && !isValidTick) {
      isValidTicks = false;
    }
  }

  return (
    isValidBalances && isValidGlobalState && isValidTicks && isValidTickBitmap
  );
}

async function checkPoolStateForBlockRange(
  startBlockNumber: number,
  endBlockNumber: number,
): Promise<boolean> {
  const network = Network.ARBITRUM;
  const dexKey = 'CamelotV3';
  const dexHelper = new DummyDexHelper(network);

  const algebra = new Algebra(network, dexKey, dexHelper);
  const pool = await algebra.getPool(
    srcToken.address,
    destToken.address,
    startBlockNumber,
  );

  const logsToDispatch = await dexHelper.provider.getLogs({
    fromBlock: startBlockNumber,
    toBlock: endBlockNumber,
    address: poolAddress,
  });

  console.log(logsToDispatch.length);

  // group logs by block number
  const logsByBlockNumber: Record<number, any[]> = {};
  for (let log of logsToDispatch) {
    if (!logsByBlockNumber[log.blockNumber]) {
      logsByBlockNumber[log.blockNumber] = [];
    }
    logsByBlockNumber[log.blockNumber].push(log);
  }

  const sortedBlocks = Object.keys(logsByBlockNumber)
    .map(Number)
    .sort((a, b) => Number(a) - Number(b));

  for (let blockNumber of sortedBlocks) {
    if (!blockHeaders[blockNumber]) {
      blockHeaders[blockNumber] = await dexHelper.web3Provider.eth.getBlock(
        blockNumber,
      );
    }

    await pool?.update(logsByBlockNumber[blockNumber], {
      [blockNumber]: blockHeaders[blockNumber],
    });
  }

  const state = pool?.getState(startBlockNumber) as PoolState_v1_9;
  return isPoolStateEqualToReal(state, endBlockNumber);
}

async function findBreakingBlock(startBlock: number, endBlock: number) {
  let left = startBlock;
  let right = endBlock;

  // If the state is valid at the start, then there's no breaking block in the range
  if (await checkPoolStateForBlockRange(left, right)) {
    return -1; // Indicates no breaking block found
  }

  while (left <= right) {
    const mid = left + Math.floor((right - left) / 2);
    const isValid = await checkPoolStateForBlockRange(startBlock, mid);

    if (isValid) {
      // If the state is valid up to mid, the issue must be in the second half
      left = mid + 1;
    } else {
      // If the state is not valid up to mid, the issue is in the first half
      // But we need to check if mid is the first occurrence of the issue
      if (
        mid === startBlock ||
        (await checkPoolStateForBlockRange(startBlock, mid - 1))
      ) {
        return mid; // Found the breaking block
      }
      right = mid - 1;
    }
  }

  return -1; // Should not reach here if there's a breaking block
}

async function main() {
  // use findBreakingBlock to find the block where the state is broken
  // console.log(await findBreakingBlock(startBlockNumber, endBlockNumber));
  // previously broken block 150502863
  // console.log(await checkPoolStateForBlockRange(150502853, 150502873));
  // console.log(await checkPoolStateForBlockRange(152087800, 152287800));
  // console.log(await checkPoolStateForBlockRange(152100945, 152100947));
}

main()
  .then(() => console.log('Done'))
  .catch(e => console.error(e));

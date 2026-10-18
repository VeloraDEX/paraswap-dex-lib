/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Interface, Result } from '@ethersproject/abi';
import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { MaverickV1 } from './maverick-v1';
import {
  checkPoolPrices,
  checkPoolsLiquidity,
  checkConstantPoolPrices,
} from '../../../tests/utils';
import PoolInspectorABI from '../../abi/maverick-v1/pool-inspector.json';

import { Tokens } from '../../../tests/constants-e2e';
import { MaverickV1Config } from './config';
import { ExchangePrices } from '../../types';
import { MaverickV1Data } from './types';
import { assert } from 'ts-essentials';

const network = Network.MAINNET;
const TokenASymbol = 'ETH';
const TokenA = Tokens[network][TokenASymbol];

const TokenBSymbol = 'USDT';
const TokenB = Tokens[network][TokenBSymbol];

const amounts = [0n, BI_POWS[18], 2n * BI_POWS[18], 3n * BI_POWS[18]];

const dexHelper = new DummyDexHelper(network);
const dexKey = 'MaverickV1';

function getReaderCalldata(
  poolAddress: string,
  readerIface: Interface,
  amounts: bigint[],
  funcName: string,
  tokenAIn: boolean,
  exactOutput: boolean,
) {
  return amounts.map(amount => ({
    target: MaverickV1Config[dexKey][network].poolInspectorAddress,
    callData: readerIface.encodeFunctionData(funcName, [
      poolAddress,
      amount,
      tokenAIn,
      exactOutput,
    ]),
  }));
}

function decodeReaderResult(
  results: Result,
  readerIface: Interface,
  funcName: string,
) {
  // TODO: Adapt this function for your needs
  return results.map(result => {
    const parsed = readerIface.decodeFunctionResult(funcName, result);
    return BigInt(parsed[0]._hex);
  });
}

async function checkOnChainPricing(
  maverickV1: MaverickV1,
  funcName: string,
  blockNumber: number,
  pools: ExchangePrices<MaverickV1Data>,
  srcToken: string,
) {
  await Promise.all(
    pools.map(async pool => {
      const poolAddress = pool.data.pool;

      const readerIface = new Interface(PoolInspectorABI);

      const readerCallData = getReaderCalldata(
        poolAddress,
        readerIface,
        amounts.slice(1),
        'calculateSwap',
        pool.data.tokenA.toLowerCase() == srcToken.toLowerCase(),
        false,
      );
      const readerResult = (
        await dexHelper.multiContract.methods
          .aggregate(readerCallData)
          .call({}, blockNumber)
      ).returnData;

      const expectedPrices = [0n].concat(
        decodeReaderResult(readerResult, readerIface, funcName),
      );

      console.log(
        `${TokenASymbol} <> ${TokenBSymbol} On Chain Prices: `,
        amounts,
        pool.prices,
        expectedPrices,
      );
      expect(pool.prices).toEqual(expectedPrices);
    }),
  );
}

describe('MaverickV1', function () {
  let blockNumber: number;
  let maverickV1: MaverickV1;

  beforeAll(async () => {
    blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();

    maverickV1 = new MaverickV1(network, dexKey, dexHelper);
    await maverickV1.initializePricing(blockNumber);
  });

  it('getPoolIdentifiers and getPricesVolume SELL', async function () {
    const pools = await maverickV1.getPoolIdentifiers(
      TokenA,
      TokenB,
      SwapSide.SELL,
      blockNumber,
    );

    console.log(`${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `, pools);

    expect(pools.length).toBeGreaterThan(0);

    const poolPrices = await maverickV1.getPricesVolume(
      TokenA,
      TokenB,
      amounts,
      SwapSide.SELL,
      blockNumber,
      pools,
    );
    console.log(`${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `, poolPrices);

    expect(poolPrices).not.toBeNull();
    if (maverickV1.hasConstantPriceLargeAmounts) {
      checkConstantPoolPrices(poolPrices!, amounts, dexKey);
    } else {
      checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);
    }

    // Check if onchain pricing equals to calculated ones
    await checkOnChainPricing(
      maverickV1,
      'calculateSwap', // TODO: Put here the functionName to call
      blockNumber,
      poolPrices!,
      TokenA.address,
    );
  });

  it('search for broken event', async function () {
    const startBlockNumber = 18233872;
    // const startBlockNumber = 18235059;
    // const blockNumberCheck = 18235060;
    const blocksToLookForward = 10000;
    const poolAddress = '0x352B186090068Eb35d532428676cE510E17AB581';
    const srcToken = {
      address: `0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee`,
      decimals: 18,
    };
    const destToken = {
      address: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      decimals: 6,
    };
    const inputParams = {
      srcToken,
      destToken,
      amounts: [0n, BI_POWS[18]],
      side: SwapSide.SELL,
      blockNumber: startBlockNumber,
      limitPools: ['MaverickV1_0x352b186090068eb35d532428676ce510e17ab581'],
    };

    maverickV1 = new MaverickV1(network, dexKey, dexHelper);
    await maverickV1.initializePricing(startBlockNumber);
    const pool = maverickV1.pools[poolAddress.toLowerCase()];
    assert(pool, 'pool not found');
    assert(
      pool.addressesSubscribed.length === 1,
      'Pool must subscribe to only one pool',
    );

    // const correctState = await pool.generateState(blockNumberCheck);

    const logsToDispatch = await dexHelper.provider.getLogs({
      fromBlock: startBlockNumber,
      toBlock: startBlockNumber + blocksToLookForward,
      address: pool.addressesSubscribed[0],
    });

    console.log(`Subscribed addresses: ${pool.addressesSubscribed.join(', ')}`);
    console.log(`Received ${logsToDispatch.length} logs to dispatch`);

    let output = (
      await maverickV1.getPricesVolume(
        inputParams.srcToken,
        inputParams.destToken,
        inputParams.amounts,
        inputParams.side,
        inputParams.blockNumber,
        inputParams.limitPools,
      )
    )?.[0].prices[1];

    console.log(`Init output: ${output}`);
    let currentBlock = await dexHelper.web3Provider.eth.getBlock(
      startBlockNumber,
    );

    for (const [i, log] of logsToDispatch.entries()) {
      if (log.blockNumber > currentBlock.number) {
        inputParams.blockNumber = log.blockNumber;
        currentBlock = await dexHelper.web3Provider.eth.getBlock(
          log.blockNumber,
        );
      }

      pool.update([log], {
        [inputParams.blockNumber]: currentBlock,
      });

      let output = (
        await maverickV1.getPricesVolume(
          inputParams.srcToken,
          inputParams.destToken,
          inputParams.amounts,
          inputParams.side,
          inputParams.blockNumber,
          inputParams.limitPools,
        )
      )?.[0].prices[1];

      console.log(
        `Output after ${log.blockNumber}/${inputParams.blockNumber} and topic0 ${log.topics[0]}, txHash=${log.transactionHash}, txInd=${log.transactionIndex}: ${output}`,
      );

      // if (i === 2) {
      //   const incorrectState = pool.getState(blockNumberCheck);
      //   expect(correctState).toEqual(incorrectState);
      // }

      // console.log(
      //   getReaderCalldata(
      //     poolAddress,
      //     new Interface(PoolInspectorABI),
      //     inputParams.amounts,
      //     'calculateSwap',
      //     true,
      //     false,
      //   ),
      // );
      // expect(output).toBeLessThan(1800000000);
    }

    // const incorrectState = pool.getState(blockNumberCheck);
    //
    // expect(correctState).toEqual(incorrectState);
    //
    // output = (
    //   await maverickV1.getPricesVolume(
    //     inputParams.srcToken,
    //     inputParams.destToken,
    //     inputParams.amounts,
    //     inputParams.side,
    //     blockNumberCheck,
    //     inputParams.limitPools,
    //   )
    // )?.[0].prices[1];
    //
    // console.log(`Output after ${blockNumberCheck}: ${output}`);
  });
});

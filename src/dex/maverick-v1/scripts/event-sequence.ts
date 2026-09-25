/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { SwapSide } from '@paraswap/core';
import { assert } from 'ts-essentials';
import { BI_POWS } from '../../../bigint-constants';
import { Network } from '../../../constants';
import { DummyDexHelper } from '../../../dex-helper';
import { MaverickV1 } from '../maverick-v1';

async function main() {
  const network = Network.MAINNET;
  const dexKey = 'MaverickV1';
  const dexHelper = new DummyDexHelper(network);
  // const startBlockNumber = 18233872;
  const startBlockNumber = 18235059;
  // const blockNumberCheck = 18235060;
  const blocksToLookForward = 1;
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

  const maverickV1 = new MaverickV1(network, dexKey, dexHelper);
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
    if (i === 143) {
      continue;
    }
    if (log.blockNumber > currentBlock.number) {
      inputParams.blockNumber = log.blockNumber;
      currentBlock = await dexHelper.web3Provider.eth.getBlock(log.blockNumber);
    }

    await pool.update([log], {
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

    if (output! > 1800000000) {
      console.log(
        `\n\n\n (${i}/${logsToDispatch.length}) !!!Output after ${log.blockNumber}/${inputParams.blockNumber} and topic0 ${log.topics[0]}, txHash=${log.transactionHash}, txInd=${log.transactionIndex}: ${output}!!!\n\n\n`,
      );
    } else {
      console.log(
        `\n(${i}/${logsToDispatch.length}) Output after ${log.blockNumber}/${inputParams.blockNumber} and topic0 ${log.topics[0]}, txHash=${log.transactionHash}, txInd=${log.transactionIndex}: ${output}`,
      );
    }

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
}

main()
  .then(() => console.log('Done'))
  .catch(e => console.error(e));

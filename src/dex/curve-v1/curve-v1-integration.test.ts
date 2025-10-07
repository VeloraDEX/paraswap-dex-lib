import dotenv from 'dotenv';
dotenv.config();

import { Interface, Result } from '@ethersproject/abi';
import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { CurveV1 } from './curve-v1';
import {
  checkPoolPrices,
  checkConstantPoolPrices,
  checkPoolsLiquidity,
} from '../../../tests/utils';
import { Tokens } from '../../../tests/constants-e2e';
import { CurveV1Data } from './types';
import _ from 'lodash';

const network = Network.MAINNET;
const TokenASymbol = 'USDT';
const TokenA = Tokens[network][TokenASymbol];

const TokenBSymbol = 'DAI';
const TokenB = Tokens[network][TokenBSymbol];

const bigPowAmounts = _.range(1, 11).map(i => BI_POWS[8] * BigInt(i));

const amounts = [0n, ...bigPowAmounts];

const amountToUse = amounts.slice(1);

const dexHelper = new DummyDexHelper(network);
const dexKey = 'CurveV1';

function getReaderCalldata(
  readerIface: Interface,
  data: CurveV1Data,
  amounts: bigint[],
) {
  return amountToUse.map(amount => ({
    target: data.exchange,
    callData: data.underlyingSwap
      ? readerIface.encodeFunctionData('get_dy_underlying', [
          data.i,
          data.j,
          amount,
        ])
      : readerIface.encodeFunctionData('get_dy', [data.i, data.j, amount]),
  }));
}

function decodeReaderResult(
  data: CurveV1Data,
  results: Result,
  readerIface: Interface,
) {
  return results.map(result => {
    const parsed = data.underlyingSwap
      ? readerIface.decodeFunctionResult('get_dy_underlying', result)
      : readerIface.decodeErrorResult('get_dy', result);
    return BigInt(parsed[0]._hex);
  });
}

async function checkOnChainPricing(
  curveV1: CurveV1,
  blockNumber: number,
  data: CurveV1Data,
  prices: bigint[],
) {
  const readerIface = curveV1.poolInterface;

  const readerCallData = getReaderCalldata(readerIface, data, amountToUse);

  const readerResult = (
    await dexHelper.multiContract.methods
      .aggregate(readerCallData)
      .call({}, blockNumber)
  ).returnData;

  const expectedPrices = [0n].concat(
    decodeReaderResult(data, readerResult, readerIface),
  );

  expect(prices).toEqual(expectedPrices);
}

describe('CurveV1', function () {
  let blockNumber: number;
  let curveV1: CurveV1;

  beforeAll(async () => {
    blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
    curveV1 = new CurveV1(Network.MAINNET, dexKey, dexHelper);
  });

  it('getPoolIdentifiers and getPricesVolume SELL', async function () {
    const pools = await curveV1.getPoolIdentifiers(
      TokenA,
      TokenB,
      SwapSide.SELL,
      blockNumber,
    );
    console.log(`${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `, pools);

    expect(pools.length).toBeGreaterThan(0);

    const poolPrices = await curveV1.getPricesVolume(
      TokenA,
      TokenB,
      amounts,
      SwapSide.SELL,
      blockNumber,
      pools,
    );
    console.log(`${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `, poolPrices);

    expect(poolPrices).not.toBeNull();
    if (curveV1.hasConstantPriceLargeAmounts) {
      checkConstantPoolPrices(poolPrices!, amounts, dexKey);
    } else {
      checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);
    }

    // Check if onchain pricing equals to calculated ones
    await checkOnChainPricing(
      curveV1,
      blockNumber,
      poolPrices![0].data,
      poolPrices![0].prices,
    );
  });

  it.only('getTopPoolsForToken', async function () {
    await curveV1.updatePoolState();
    const poolLiquidity = await curveV1.getTopPoolsForToken(
      '0x0000000000085d4780b73119b644ae5ecd22b376',
      10,
    );
    console.log(`${TokenASymbol} Top Pools:`, poolLiquidity);

    if (!curveV1.hasConstantPriceLargeAmounts) {
      checkPoolsLiquidity(poolLiquidity, TokenA.address, dexKey);
    }
  });
});

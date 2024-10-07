import dotenv from 'dotenv';
dotenv.config();

import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { checkPoolPrices, checkPoolsLiquidity } from '../../../tests/utils';
import { Tokens } from '../../../tests/constants-e2e';
import { BI_POWS } from '../../bigint-constants';
import { Spark } from './spark';
import { MultiCallParams } from '../../lib/multi-wrapper';
import { uint256ToBigInt } from '../../lib/decoders';

const network = Network.MAINNET;

const amounts = [0n, BI_POWS[18], 2000000000000000000n];

const dexHelper = new DummyDexHelper(network);
let blocknumber: number;
let spark: Spark;

describe('Spark', function () {
  const dexKey = 'Spark';
  const SDaiSymbol = 'sDAI';
  const SDaiToken = Tokens[network][SDaiSymbol];

  const DaiSymbol = 'DAI';
  const DaiToken = Tokens[network][DaiSymbol];

  beforeAll(async () => {
    blocknumber = await dexHelper.web3Provider.eth.getBlockNumber();
    spark = new Spark(network, dexKey, dexHelper);
    if (spark.initializePricing) {
      await spark.initializePricing(blocknumber);
    }
  });

  it('getPoolIdentifiers and getPricesVolume DAI -> sDAI SELL', async function () {
    const pools = await spark.getPoolIdentifiers(
      DaiToken,
      SDaiToken,
      SwapSide.SELL,
      blocknumber,
    );
    console.log(`${DaiSymbol} <> ${SDaiSymbol} Pool Identifiers: `, pools);

    expect(pools.length).toBeGreaterThan(0);

    const poolPrices = await spark.getPricesVolume(
      DaiToken,
      SDaiToken,
      amounts,
      SwapSide.SELL,
      blocknumber,
      pools,
    );
    console.log(`${DaiSymbol} <> ${SDaiSymbol} Pool Prices: `, poolPrices);

    expect(poolPrices).not.toBeNull();
    checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);
  });

  it('getPoolIdentifiers and getPricesVolume sDAI -> DAI SELL', async function () {
    const pools = await spark.getPoolIdentifiers(
      SDaiToken,
      DaiToken,
      SwapSide.SELL,
      blocknumber,
    );
    console.log(`${SDaiSymbol} <> ${DaiSymbol} Pool Identifiers: `, pools);

    expect(pools.length).toBeGreaterThan(0);

    const poolPrices = await spark.getPricesVolume(
      SDaiToken,
      DaiToken,
      amounts,
      SwapSide.SELL,
      blocknumber,
      pools,
    );
    console.log(`${SDaiSymbol} <> ${DaiSymbol} Pool Prices: `, poolPrices);

    expect(poolPrices).not.toBeNull();
    checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);
  });

  it('getPoolIdentifiers and getPricesVolume DAI -> sDAI BUY', async function () {
    const pools = await spark.getPoolIdentifiers(
      DaiToken,
      SDaiToken,
      SwapSide.BUY,
      blocknumber,
    );
    console.log(`${DaiSymbol} <> ${SDaiSymbol} Pool Identifiers: `, pools);

    expect(pools.length).toBeGreaterThan(0);

    const poolPrices = await spark.getPricesVolume(
      DaiToken,
      SDaiToken,
      amounts,
      SwapSide.BUY,
      blocknumber,
      pools,
    );
    console.log(`${DaiSymbol} <> ${SDaiSymbol} Pool Prices: `, poolPrices);

    expect(poolPrices).not.toBeNull();
    checkPoolPrices(poolPrices!, amounts, SwapSide.BUY, dexKey);
  });

  it('getPoolIdentifiers and getPricesVolume sDAI -> DAI BUY', async function () {
    const pools = await spark.getPoolIdentifiers(
      SDaiToken,
      DaiToken,
      SwapSide.BUY,
      blocknumber,
    );
    console.log(`${SDaiSymbol} <> ${DaiSymbol} Pool Identifiers: `, pools);

    expect(pools.length).toBeGreaterThan(0);

    const poolPrices = await spark.getPricesVolume(
      SDaiToken,
      DaiToken,
      amounts,
      SwapSide.BUY,
      blocknumber,
      pools,
    );
    console.log(`${SDaiSymbol} <> ${DaiSymbol} Pool Prices: `, poolPrices);

    expect(poolPrices).not.toBeNull();
    checkPoolPrices(poolPrices!, amounts, SwapSide.BUY, dexKey);
  });

  it('Dai getTopPoolsForToken', async function () {
    const poolLiquidity = await spark.getTopPoolsForToken(DaiToken.address, 10);
    console.log(`${DaiSymbol} Top Pools:`, poolLiquidity);

    checkPoolsLiquidity(poolLiquidity, DaiToken.address, dexKey);
  });

  it('SDai getTopPoolsForToken', async function () {
    const poolLiquidity = await spark.getTopPoolsForToken(
      SDaiToken.address,
      10,
    );
    console.log(`${SDaiSymbol} Top Pools:`, poolLiquidity);

    checkPoolsLiquidity(poolLiquidity, SDaiToken.address, dexKey);
  });
});

describe('sUSDS', function () {
  const dexKey = 'sUSDS';
  const SDaiSymbol = 'sUSDS';
  const SDaiToken = Tokens[network][SDaiSymbol];

  const DaiSymbol = 'USDS';
  const DaiToken = Tokens[network][DaiSymbol];

  beforeAll(async () => {
    blocknumber = await dexHelper.web3Provider.eth.getBlockNumber();
    spark = new Spark(network, dexKey, dexHelper);
    if (spark.initializePricing) {
      await spark.initializePricing(blocknumber);
    }
  });

  it('getPoolIdentifiers and getPricesVolume USDS -> sUSDS SELL', async function () {
    const pools = await spark.getPoolIdentifiers(
      DaiToken,
      SDaiToken,
      SwapSide.SELL,
      blocknumber,
    );
    console.log(`${DaiSymbol} <> ${SDaiSymbol} Pool Identifiers: `, pools);

    expect(pools.length).toBeGreaterThan(0);

    const poolPrices = await spark.getPricesVolume(
      DaiToken,
      SDaiToken,
      amounts,
      SwapSide.SELL,
      blocknumber,
      pools,
    );
    console.log(`${DaiSymbol} <> ${SDaiSymbol} Pool Prices: `, poolPrices);

    const onChainPrices = await Promise.all(
      amounts.map(async amount => {
        const callData: MultiCallParams<bigint>[] = [
          {
            target: '0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD',
            callData: spark.abiInterface.encodeFunctionData('previewDeposit', [
              amount,
            ]),
            decodeFunction: uint256ToBigInt,
          },
        ];

        const results = await spark.dexHelper.multiWrapper.aggregate<bigint>(
          callData,
          blocknumber,
        );
        return results[0];
      }),
    );

    console.log('On-chain price:', onChainPrices);

    const chiCalldata: MultiCallParams<bigint>[] = [
      {
        target: '0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD',
        callData: spark.abiInterface.encodeFunctionData('chi', []),
        decodeFunction: uint256ToBigInt,
      },
    ];

    const results = await spark.dexHelper.multiWrapper.aggregate<bigint>(
      chiCalldata,
      blocknumber,
    );
    console.log(`ON_CHAIN_CHI at block=${blocknumber}`, results[0]);

    expect(poolPrices).not.toBeNull();
    expect(poolPrices?.[0].prices).toEqual(onChainPrices);
    checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);
  });

  it('getPoolIdentifiers and getPricesVolume sUSDS -> USDS SELL', async function () {
    const pools = await spark.getPoolIdentifiers(
      SDaiToken,
      DaiToken,
      SwapSide.SELL,
      blocknumber,
    );
    console.log(`${SDaiSymbol} <> ${DaiSymbol} Pool Identifiers: `, pools);

    expect(pools.length).toBeGreaterThan(0);

    const poolPrices = await spark.getPricesVolume(
      SDaiToken,
      DaiToken,
      amounts,
      SwapSide.SELL,
      blocknumber,
      pools,
    );
    console.log(`${SDaiSymbol} <> ${DaiSymbol} Pool Prices: `, poolPrices);

    const onChainPrices = await Promise.all(
      amounts.map(async amount => {
        const callData: MultiCallParams<bigint>[] = [
          {
            target: '0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD',
            callData: spark.abiInterface.encodeFunctionData('previewRedeem', [
              amount,
            ]),
            decodeFunction: uint256ToBigInt,
          },
        ];

        const results = await spark.dexHelper.multiWrapper.aggregate<bigint>(
          callData,
          blocknumber,
        );
        return results[0];
      }),
    );

    console.log('On-chain price:', onChainPrices);

    const chiCalldata: MultiCallParams<bigint>[] = [
      {
        target: '0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD',
        callData: spark.abiInterface.encodeFunctionData('chi', []),
        decodeFunction: uint256ToBigInt,
      },
    ];

    const results = await spark.dexHelper.multiWrapper.aggregate<bigint>(
      chiCalldata,
      blocknumber,
    );
    console.log('ON_CHAIN_CHI:', results[0]);

    expect(poolPrices).not.toBeNull();
    expect(poolPrices?.[0].prices).toEqual(onChainPrices);
    checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);
  });

  it('getPoolIdentifiers and getPricesVolume USDS -> sUSDS BUY', async function () {
    const pools = await spark.getPoolIdentifiers(
      DaiToken,
      SDaiToken,
      SwapSide.BUY,
      blocknumber,
    );
    console.log(`${DaiSymbol} <> ${SDaiSymbol} Pool Identifiers: `, pools);

    expect(pools.length).toBeGreaterThan(0);

    const poolPrices = await spark.getPricesVolume(
      DaiToken,
      SDaiToken,
      amounts,
      SwapSide.BUY,
      blocknumber,
      pools,
    );
    console.log(`${DaiSymbol} <> ${SDaiSymbol} Pool Prices: `, poolPrices);

    const onChainPrices = await Promise.all(
      amounts.map(async amount => {
        const callData: MultiCallParams<bigint>[] = [
          {
            target: '0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD',
            callData: spark.abiInterface.encodeFunctionData('previewMint', [
              amount,
            ]),
            decodeFunction: uint256ToBigInt,
          },
        ];

        const results = await spark.dexHelper.multiWrapper.aggregate<bigint>(
          callData,
          blocknumber,
        );
        return results[0];
      }),
    );

    console.log('On-chain price:', onChainPrices);

    const chiCalldata: MultiCallParams<bigint>[] = [
      {
        target: '0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD',
        callData: spark.abiInterface.encodeFunctionData('chi', []),
        decodeFunction: uint256ToBigInt,
      },
    ];

    const results = await spark.dexHelper.multiWrapper.aggregate<bigint>(
      chiCalldata,
      blocknumber,
    );
    console.log('ON_CHAIN_CHI:', results[0]);
    expect(poolPrices).not.toBeNull();
    expect(poolPrices?.[0].prices).toEqual(onChainPrices);
    checkPoolPrices(poolPrices!, amounts, SwapSide.BUY, dexKey);
  });

  it('getPoolIdentifiers and getPricesVolume sUSDS -> USDS BUY', async function () {
    const pools = await spark.getPoolIdentifiers(
      SDaiToken,
      DaiToken,
      SwapSide.BUY,
      blocknumber,
    );
    console.log(`${SDaiSymbol} <> ${DaiSymbol} Pool Identifiers: `, pools);

    expect(pools.length).toBeGreaterThan(0);

    const poolPrices = await spark.getPricesVolume(
      SDaiToken,
      DaiToken,
      amounts,
      SwapSide.BUY,
      blocknumber,
      pools,
    );
    console.log(`${SDaiSymbol} <> ${DaiSymbol} Pool Prices: `, poolPrices);

    const onChainPrices = await Promise.all(
      amounts.map(async amount => {
        const callData: MultiCallParams<bigint>[] = [
          {
            target: '0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD',
            callData: spark.abiInterface.encodeFunctionData('previewWithdraw', [
              amount,
            ]),
            decodeFunction: uint256ToBigInt,
          },
        ];

        const results = await spark.dexHelper.multiWrapper.aggregate<bigint>(
          callData,
          blocknumber,
        );
        return results[0];
      }),
    );

    console.log('On-chain price:', onChainPrices);

    const chiCalldata: MultiCallParams<bigint>[] = [
      {
        target: '0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD',
        callData: spark.abiInterface.encodeFunctionData('chi', []),
        decodeFunction: uint256ToBigInt,
      },
    ];

    const results = await spark.dexHelper.multiWrapper.aggregate<bigint>(
      chiCalldata,
      blocknumber,
    );
    console.log('ON_CHAIN_CHI:', results[0]);

    expect(poolPrices).not.toBeNull();
    expect(poolPrices?.[0].prices).toEqual(onChainPrices);
    checkPoolPrices(poolPrices!, amounts, SwapSide.BUY, dexKey);
  });

  it('USDS getTopPoolsForToken', async function () {
    const poolLiquidity = await spark.getTopPoolsForToken(DaiToken.address, 10);
    console.log(`${DaiSymbol} Top Pools:`, poolLiquidity);

    checkPoolsLiquidity(poolLiquidity, DaiToken.address, dexKey);
  });

  it('sUSDS getTopPoolsForToken', async function () {
    const poolLiquidity = await spark.getTopPoolsForToken(
      SDaiToken.address,
      10,
    );
    console.log(`${SDaiSymbol} Top Pools:`, poolLiquidity);

    checkPoolsLiquidity(poolLiquidity, SDaiToken.address, dexKey);
  });
});

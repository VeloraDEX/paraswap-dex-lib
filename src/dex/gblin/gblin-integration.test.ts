/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Interface } from '@ethersproject/abi';
import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { Gblin } from './gblin';
import { GblinEventPool } from './gblin-pool';
import { GblinConfig } from './config';
import { checkPoolPrices, checkPoolsLiquidity } from '../../../tests/utils';
import GBLIN_LENS_ABI from '../../abi/gblin/GBLINLens.json';

const network = Network.BASE;
const dexKey = 'Gblin';
const { vault, lens, weth } = GblinConfig[dexKey][network];
const wethToken = { address: weth, decimals: 18 };
const gblinToken = { address: vault, decimals: 18 };
// Evenly spaced amounts: checkPoolPrices compares consecutive price deltas and
// therefore assumes a constant step between amounts.
const amounts = [
  0n,
  BI_POWS[17],
  2n * BI_POWS[17],
  3n * BI_POWS[17],
  4n * BI_POWS[17],
  5n * BI_POWS[17],
];
// Arbitrary amounts for the exact comparison against the on-chain Lens quote.
const lensAmounts = [
  0n,
  BI_POWS[15],
  BI_POWS[16],
  BI_POWS[17],
  BI_POWS[18],
  5n * BI_POWS[18],
];

describe('Gblin', function () {
  let dexHelper: DummyDexHelper;
  let blockNumber: number;
  let gblin: Gblin;

  beforeAll(async () => {
    dexHelper = new DummyDexHelper(network);
    blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
    gblin = new Gblin(network, dexKey, dexHelper);
    await gblin.initializePricing(blockNumber);
  });

  it('getPoolIdentifiers and getPricesVolume WETH -> GBLIN SELL', async function () {
    const pools = await gblin.getPoolIdentifiers(
      wethToken,
      gblinToken,
      SwapSide.SELL,
      blockNumber,
    );
    console.log('WETH <> GBLIN pool identifiers:', pools);
    expect(pools.length).toBeGreaterThan(0);

    const poolPrices = await gblin.getPricesVolume(
      wethToken,
      gblinToken,
      amounts,
      SwapSide.SELL,
      blockNumber,
      pools,
    );
    console.log('WETH <> GBLIN pool prices:', poolPrices);
    expect(poolPrices).not.toBeNull();
    checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);
  });

  it('prices match GBLINLens.quoteBuy at the same block', async function () {
    const pools = await gblin.getPoolIdentifiers(
      wethToken,
      gblinToken,
      SwapSide.SELL,
      blockNumber,
    );
    const poolPrices = await gblin.getPricesVolume(
      wethToken,
      gblinToken,
      lensAmounts,
      SwapSide.SELL,
      blockNumber,
      pools,
    );
    expect(poolPrices).not.toBeNull();

    const lensIface = new Interface(GBLIN_LENS_ABI);
    const lensContract = new dexHelper.web3Provider.eth.Contract(
      GBLIN_LENS_ABI as any,
      lens,
    );
    for (let i = 0; i < lensAmounts.length; i++) {
      const onChain = await lensContract.methods
        .quoteBuy(vault, lensAmounts[i].toString())
        .call({}, blockNumber);
      const expected = BigInt(onChain.out ?? onChain[0]);
      expect(poolPrices![0].prices[i]).toEqual(expected);
    }
    expect(lensIface.getFunction('quoteBuy')).toBeDefined();
  });

  it('GBLIN -> WETH and BUY side are not served', async function () {
    expect(
      await gblin.getPoolIdentifiers(
        gblinToken,
        wethToken,
        SwapSide.SELL,
        blockNumber,
      ),
    ).toEqual([]);
    expect(
      await gblin.getPoolIdentifiers(
        wethToken,
        gblinToken,
        SwapSide.BUY,
        blockNumber,
      ),
    ).toEqual([]);
    expect(
      await gblin.getPricesVolume(
        wethToken,
        gblinToken,
        amounts,
        SwapSide.BUY,
        blockNumber,
      ),
    ).toBeNull();
  });

  it('reports an unreliable NAV instead of throwing when a required read fails', async function () {
    const helper = new DummyDexHelper(network);
    const pool = new GblinEventPool(
      dexKey,
      network,
      helper,
      helper.getLogger(dexKey),
      vault,
      lens,
      GblinConfig[dexKey][network].feedAggregators,
    );
    const real = helper.multiWrapper.tryAggregate.bind(helper.multiWrapper);
    jest
      .spyOn(helper.multiWrapper, 'tryAggregate')
      .mockImplementation(async (mandatory, calls, block) => {
        const results = await real(mandatory, calls, block);
        // totalEthValue reverting is what a stale price feed looks like
        results[1] = { success: false, returnData: undefined };
        return results;
      });
    const state = await pool.generateState(blockNumber);
    expect(state.navReliable).toBe(false);
    expect(state.navEth).toEqual(0n);
  });

  it('getTopPoolsForToken', async function () {
    const poolLiquidity = await gblin.getTopPoolsForToken(weth, 10);
    console.log('WETH top pools:', poolLiquidity);
    checkPoolsLiquidity(poolLiquidity, weth, dexKey);
    expect(await gblin.getTopPoolsForToken(vault, 10)).toEqual([]);
  });
});

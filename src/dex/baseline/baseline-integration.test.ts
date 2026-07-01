/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Interface, Result } from '@ethersproject/abi';
import { DummyDexHelper, IDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { Baseline } from './baseline';
import { checkPoolPrices, checkPoolsLiquidity } from '../../../tests/utils';
import { Tokens } from '../../../tests/constants-e2e';
import { BaselineConfig } from './config';

/*
  Baseline (Mercury) is a power-law AMM with block-batched pricing. The relay
  exposes on-chain quote views (quoteSellExactIn / quoteBuyExactOut /
  quoteBuyExactIn / quoteSellExactOut) that resolve the frozen-snapshot +
  in-block-delta pricing, so this integration prices statelessly by calling those
  views via Multicall. There is no event-replicated pool state, so no events test.

  Prices are checked for shape and marginal monotonicity (checkPoolPrices) and for
  exact per-amount equality against the relay's own quote views, rebuilt
  independently below. Spread and round-trip invariants and pinned-block fixtures
  guard against dispatch and direction errors.
*/

const network = Network.BASE;
const dexKey = 'Baseline';

const RELAY = BaselineConfig[dexKey][network].relay;
const REPPO = Tokens[network].REPPO; // bToken (18 dec)
const VIRTUAL = Tokens[network].VIRTUAL; // reserve token (18 dec)
// ZRP: launched with zero reserves (creation tx
// 0x2172b650e80349353c64279b63b5178b51034a5dad47e0247b834d5bd41bcc98, block
// 47159566), so its early blocks sit in the safety regime on a zero-circ
// snapshot — the edge paths mainstream pools never reach. Discovered via the
// subgraph; not in the configured list.
const ZRP = {
  address: '0xf4881E8FB4D0567B4E6aD507557A51BB03BAF4C8',
  decimals: 18,
};

// Relay quote views. Each: fn(address bToken, uint256 amount)
//   -> (uint256 amount, uint256 fees, uint256 slippageWad)
const relayQuoteIface = new Interface([
  'function quoteSellExactIn(address,uint256) view returns (uint256,uint256,uint256)',
  'function quoteBuyExactIn(address,uint256) view returns (uint256,uint256,uint256)',
  'function quoteBuyExactOut(address,uint256) view returns (uint256,uint256,uint256)',
  'function quoteSellExactOut(address,uint256) view returns (uint256,uint256,uint256)',
]);

// The (src, dest, side) -> relay view dispatch, mirrored independently of the
// pricing code so the oracle does not reuse it. bToken is always the address arg.
function quoteFuncFor(
  bToken: string,
  srcAddress: string,
  destAddress: string,
  side: SwapSide,
): string {
  const srcIsBToken = srcAddress.toLowerCase() === bToken.toLowerCase();
  if (side === SwapSide.SELL) {
    // exact input: selling bToken -> sellExactIn; spending reserve -> buyExactIn
    return srcIsBToken ? 'quoteSellExactIn' : 'quoteBuyExactIn';
  }
  // BUY = exact output: receiving bToken -> buyExactOut; receiving reserve -> sellExactOut
  const destIsBToken = destAddress.toLowerCase() === bToken.toLowerCase();
  return destIsBToken ? 'quoteBuyExactOut' : 'quoteSellExactOut';
}

function getReaderCalldata(
  bToken: string,
  amounts: bigint[],
  funcName: string,
) {
  return amounts.map(amount => ({
    target: RELAY,
    callData: relayQuoteIface.encodeFunctionData(funcName, [
      bToken,
      amount.toString(),
    ]),
  }));
}

function decodeReaderResult(results: Result, funcName: string) {
  // First return value is the price amount (out for SELL, in for BUY).
  return results.map(result =>
    BigInt(relayQuoteIface.decodeFunctionResult(funcName, result)[0]._hex),
  );
}

// Differential oracle: compare the dex's prices to the relay's own quotes,
// built independently here, at the same block.
async function checkOnChainPricing(
  dexHelper: IDexHelper,
  bToken: string,
  srcAddress: string,
  destAddress: string,
  side: SwapSide,
  blockNumber: number,
  prices: bigint[],
  amounts: bigint[],
) {
  const funcName = quoteFuncFor(bToken, srcAddress, destAddress, side);

  const readerCallData = getReaderCalldata(bToken, amounts.slice(1), funcName);
  const readerResult = (
    await dexHelper.multiContract.methods
      .aggregate(readerCallData)
      .call({}, blockNumber)
  ).returnData;

  const expectedPrices = [0n].concat(
    decodeReaderResult(readerResult, funcName),
  );

  expect(prices).toEqual(expectedPrices);
}

async function testPricingOnNetwork(
  baseline: Baseline,
  bToken: string,
  blockNumber: number,
  srcToken: { address: string; decimals: number },
  destToken: { address: string; decimals: number },
  side: SwapSide,
  amounts: bigint[],
) {
  const pools = await baseline.getPoolIdentifiers(
    srcToken,
    destToken,
    side,
    blockNumber,
  );
  expect(pools.length).toBeGreaterThan(0);

  const poolPrices = await baseline.getPricesVolume(
    srcToken,
    destToken,
    amounts,
    side,
    blockNumber,
    pools,
  );
  expect(poolPrices).not.toBeNull();
  expect(poolPrices!.length).toBeGreaterThan(0);

  // Shape and marginal monotonicity; the pool is well outside the low-circulation
  // regime where buffer rounding can quantize price and break monotonicity.
  checkPoolPrices(poolPrices!, amounts, side, dexKey);

  // Exact equality vs the relay's own quotes.
  await checkOnChainPricing(
    baseline.dexHelper,
    bToken,
    srcToken.address,
    destToken.address,
    side,
    blockNumber,
    poolPrices![0].prices,
    amounts,
  );
}

// BUY with the bToken as input (an exact reserve amount out) is declined: the
// relay's sellTokensExactOut needs a reserve-token approval the aggregator
// never grants (see resolvePool in baseline.ts).
async function expectSideDeclined(
  baseline: Baseline,
  blockNumber: number,
  srcToken: { address: string; decimals: number },
  destToken: { address: string; decimals: number },
) {
  const pools = await baseline.getPoolIdentifiers(
    srcToken,
    destToken,
    SwapSide.BUY,
    blockNumber,
  );
  expect(pools).toEqual([]);

  const prices = await baseline.getPricesVolume(
    srcToken,
    destToken,
    [0n, BI_POWS[18]],
    SwapSide.BUY,
    blockNumber,
  );
  expect(prices).toBeNull();
}

describe('Baseline', () => {
  describe('Base — REPPO/VIRTUAL', () => {
    const dexHelper = new DummyDexHelper(network);
    let blockNumber: number;
    let baseline: Baseline;

    // Even spacing is required by checkPoolPrices' marginal-monotonicity loop.
    const amountsForSellReppo = [
      0n,
      ...Array.from({ length: 10 }, (_, i) => BigInt(i + 1) * BI_POWS[18]),
    ];
    const amountsForSellVirtual = amountsForSellReppo;
    const amountsForBuyReppo = amountsForSellReppo;

    beforeAll(async () => {
      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      baseline = new Baseline(network, dexKey, dexHelper);
      await baseline.initializePricing(blockNumber);
    });

    it('SELL REPPO -> VIRTUAL', async () => {
      await testPricingOnNetwork(
        baseline,
        REPPO.address,
        blockNumber,
        REPPO,
        VIRTUAL,
        SwapSide.SELL,
        amountsForSellReppo,
      );
    });

    it('SELL VIRTUAL -> REPPO', async () => {
      await testPricingOnNetwork(
        baseline,
        REPPO.address,
        blockNumber,
        VIRTUAL,
        REPPO,
        SwapSide.SELL,
        amountsForSellVirtual,
      );
    });

    it('BUY REPPO (pay VIRTUAL)', async () => {
      await testPricingOnNetwork(
        baseline,
        REPPO.address,
        blockNumber,
        VIRTUAL,
        REPPO,
        SwapSide.BUY,
        amountsForBuyReppo,
      );
    });

    it('BUY VIRTUAL (pay REPPO) is declined', async () => {
      await expectSideDeclined(baseline, blockNumber, REPPO, VIRTUAL);
    });

    it('spread: buying a bToken costs more than selling it yields', async () => {
      const one = [0n, BI_POWS[18]];

      const sell = await baseline.getPricesVolume(
        REPPO,
        VIRTUAL,
        one,
        SwapSide.SELL,
        blockNumber,
      );
      const buy = await baseline.getPricesVolume(
        VIRTUAL,
        REPPO,
        one,
        SwapSide.BUY,
        blockNumber,
      );

      const sellYield = sell![0].prices[1]; // VIRTUAL out for 1 REPPO sold
      const buyCost = buy![0].prices[1]; // VIRTUAL in for 1 REPPO bought
      expect(buyCost).toBeGreaterThan(sellYield);
    });

    it('round-trip: sell then buy-back returns fewer bTokens', async () => {
      const n = 100n * BI_POWS[18];

      const sell = await baseline.getPricesVolume(
        REPPO,
        VIRTUAL,
        [0n, n],
        SwapSide.SELL,
        blockNumber,
      );
      const virtualOut = sell![0].prices[1];

      const back = await baseline.getPricesVolume(
        VIRTUAL,
        REPPO,
        [0n, virtualOut],
        SwapSide.SELL,
        blockNumber,
      );
      const reppoBack = back![0].prices[1];

      expect(reppoBack).toBeGreaterThan(0n);
      expect(reppoBack).toBeLessThan(n);
    });

    it('getTopPoolsForToken', async () => {
      // Only a bToken query resolves a pool; the reserve (VIRTUAL) returns [].
      const fresh = new Baseline(network, dexKey, dexHelper);
      const poolLiquidity = await fresh.getTopPoolsForToken(REPPO.address, 10);
      checkPoolsLiquidity(poolLiquidity, REPPO.address, dexKey);
    });
  });

  describe('Mainnet — B/WETH', () => {
    const mainnet = Network.MAINNET;
    const dexHelper = new DummyDexHelper(mainnet);
    const B = Tokens[mainnet].B; // bToken (18 dec)
    const WETH = Tokens[mainnet].WETH; // reserve token (18 dec)
    let blockNumber: number;
    let baseline: Baseline;

    const amounts = [
      0n,
      ...Array.from({ length: 10 }, (_, i) => BigInt(i + 1) * BI_POWS[18]),
    ];

    beforeAll(async () => {
      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      baseline = new Baseline(mainnet, dexKey, dexHelper);
      await baseline.initializePricing(blockNumber);
    });

    it('SELL B -> WETH', async () => {
      await testPricingOnNetwork(
        baseline,
        B.address,
        blockNumber,
        B,
        WETH,
        SwapSide.SELL,
        amounts,
      );
    });

    it('SELL WETH -> B', async () => {
      await testPricingOnNetwork(
        baseline,
        B.address,
        blockNumber,
        WETH,
        B,
        SwapSide.SELL,
        amounts,
      );
    });

    it('BUY B (pay WETH)', async () => {
      await testPricingOnNetwork(
        baseline,
        B.address,
        blockNumber,
        WETH,
        B,
        SwapSide.BUY,
        amounts,
      );
    });

    it('BUY WETH (pay B) is declined', async () => {
      await expectSideDeclined(baseline, blockNumber, B, WETH);
    });
  });

  describe('Base — BSR/cbBTC (8-dec reserve)', () => {
    const dexHelper = new DummyDexHelper(network);
    const BSR = Tokens[network].BSR; // bToken (18 dec)
    const cbBTC = Tokens[network].cbBTC; // reserve token (8 dec)
    let blockNumber: number;
    let baseline: Baseline;

    // bToken amounts are 18-decimal; reserve amounts are cbBTC's 8-decimal, which
    // exercises the reserve-side normalize/denormalize on both quote directions.
    const bTokenAmounts = [
      0n,
      ...Array.from({ length: 10 }, (_, i) => BigInt(i + 1) * BI_POWS[18]),
    ];
    const reserveAmounts = [
      0n,
      ...Array.from({ length: 10 }, (_, i) => BigInt(i + 1) * BI_POWS[5]),
    ];

    beforeAll(async () => {
      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      baseline = new Baseline(network, dexKey, dexHelper);
      await baseline.initializePricing(blockNumber);
    });

    it('SELL BSR -> cbBTC', async () => {
      await testPricingOnNetwork(
        baseline,
        BSR.address,
        blockNumber,
        BSR,
        cbBTC,
        SwapSide.SELL,
        bTokenAmounts,
      );
    });

    it('SELL cbBTC -> BSR', async () => {
      await testPricingOnNetwork(
        baseline,
        BSR.address,
        blockNumber,
        cbBTC,
        BSR,
        SwapSide.SELL,
        reserveAmounts,
      );
    });

    it('BUY BSR (pay cbBTC)', async () => {
      await testPricingOnNetwork(
        baseline,
        BSR.address,
        blockNumber,
        cbBTC,
        BSR,
        SwapSide.BUY,
        bTokenAmounts,
      );
    });

    it('BUY cbBTC (pay BSR) is declined', async () => {
      await expectSideDeclined(baseline, blockNumber, BSR, cbBTC);
    });

    it('prices the 8-decimal reserve payout in range', async () => {
      // Selling one bToken pays out cbBTC; a positive 8-decimal amount confirms
      // the reserve-side denormalization rather than a silent out-of-range zero.
      const sell = await baseline.getPricesVolume(
        BSR,
        cbBTC,
        [0n, BI_POWS[18]],
        SwapSide.SELL,
        blockNumber,
      );
      expect(sell![0].prices[1]).toBeGreaterThan(0n);
    });
  });

  describe('Base — ZRP/WETH (near-floor, ultra-low price)', () => {
    const dexHelper = new DummyDexHelper(network);
    // ZRP trades close to its BLV floor (~7e-11 WETH per token, sub-WETH total
    // reserves): payouts quantize and the sell-floor path can bind, which the
    // mainstream pools never exercise.
    const WETH = Tokens[network].WETH;
    let blockNumber: number;
    let baseline: Baseline;

    const zrpAmounts = [
      0n,
      ...Array.from({ length: 10 }, (_, i) => BigInt(i + 1) * BI_POWS[24]),
    ];
    const wethAmounts = [
      0n,
      ...Array.from({ length: 10 }, (_, i) => BigInt(i + 1) * BI_POWS[13]),
    ];

    beforeAll(async () => {
      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      baseline = new Baseline(network, dexKey, dexHelper);
      await baseline.initializePricing(blockNumber);
    });

    // checkPoolPrices' marginal-monotonicity fudge is not meaningful at this
    // price scale; wei-exact equality against the relay is the assertion.
    async function differential(
      srcToken: { address: string; decimals: number },
      destToken: { address: string; decimals: number },
      side: SwapSide,
      amounts: bigint[],
    ) {
      const poolPrices = await baseline.getPricesVolume(
        srcToken,
        destToken,
        amounts,
        side,
        blockNumber,
      );
      expect(poolPrices).not.toBeNull();
      await checkOnChainPricing(
        dexHelper,
        ZRP.address,
        srcToken.address,
        destToken.address,
        side,
        blockNumber,
        poolPrices![0].prices,
        amounts,
      );
    }

    it('SELL ZRP -> WETH', async () => {
      await differential(ZRP, WETH, SwapSide.SELL, zrpAmounts);
    });

    it('SELL WETH -> ZRP', async () => {
      await differential(WETH, ZRP, SwapSide.SELL, wethAmounts);
    });

    it('BUY ZRP (pay WETH)', async () => {
      await differential(WETH, ZRP, SwapSide.BUY, zrpAmounts);
    });

    it('BUY WETH (pay ZRP) is declined', async () => {
      await expectSideDeclined(baseline, blockNumber, ZRP, WETH);
    });
  });

  // ZRP's launch burst, pinned: trading starts at 47159692 on a ZERO-CIRC
  // snapshot (circ = 0, reserves = 0) with buys accumulating in-block while the
  // pool is at/above the safety threshold. Every quote is checked wei-exact
  // against the relay at the same historical block. Requires an archive RPC.
  describe('ZRP launch burst @ pinned blocks (safety regime, zero-circ snapshot)', () => {
    const FIRST_TRADING_BLOCK = 47159692;
    const LAUNCH_BLOCKS = [47159700, 47159800, 47160000];
    const WETH = Tokens[network].WETH;

    const zrpAmounts = [
      0n,
      ...Array.from({ length: 5 }, (_, i) => BigInt(i + 1) * BI_POWS[24]),
    ];
    const wethAmounts = [
      0n,
      ...Array.from({ length: 5 }, (_, i) => BigInt(i + 1) * BI_POWS[13]),
    ];

    // A fresh instance per pinned block, so each pool subscriber holds exactly
    // that block's state rather than rolling between pinned blocks.
    async function baselineAt(blockNumber: number) {
      const dexHelper = new DummyDexHelper(network);
      const baseline = new Baseline(network, dexKey, dexHelper);
      await baseline.initializePricing(blockNumber);
      return { baseline, dexHelper };
    }

    async function launchDifferential(
      blockNumber: number,
      srcToken: { address: string; decimals: number },
      destToken: { address: string; decimals: number },
      side: SwapSide,
      amounts: bigint[],
    ) {
      const { baseline, dexHelper } = await baselineAt(blockNumber);
      const poolPrices = await baseline.getPricesVolume(
        srcToken,
        destToken,
        amounts,
        side,
        blockNumber,
      );
      expect(poolPrices).not.toBeNull();
      await checkOnChainPricing(
        dexHelper,
        ZRP.address,
        srcToken.address,
        destToken.address,
        side,
        blockNumber,
        poolPrices![0].prices,
        amounts,
      );
    }

    it('first trading block: SELL WETH -> ZRP off the zero-circ snapshot', async () => {
      await launchDifferential(
        FIRST_TRADING_BLOCK,
        WETH,
        ZRP,
        SwapSide.SELL,
        wethAmounts,
      );
    });

    it('first trading block: BUY ZRP (pay WETH) off the zero-circ snapshot', async () => {
      await launchDifferential(
        FIRST_TRADING_BLOCK,
        WETH,
        ZRP,
        SwapSide.BUY,
        zrpAmounts,
      );
    });

    it('first trading block: sells are refused, priced 0 like the relay', async () => {
      // maxSellDelta derives from the frozen snapshot's circulation, which is
      // zero: the relay reverts every sell quote this block, so we price 0.
      const { baseline } = await baselineAt(FIRST_TRADING_BLOCK);
      const prices = await baseline.getPricesVolume(
        ZRP,
        WETH,
        [0n, BI_POWS[24]],
        SwapSide.SELL,
        FIRST_TRADING_BLOCK,
      );
      expect(prices![0].prices).toEqual([0n, 0n]);
    });

    LAUNCH_BLOCKS.forEach(block => {
      it(`launch block ${block}: SELL ZRP -> WETH`, async () => {
        await launchDifferential(block, ZRP, WETH, SwapSide.SELL, zrpAmounts);
      });

      it(`launch block ${block}: SELL WETH -> ZRP`, async () => {
        await launchDifferential(block, WETH, ZRP, SwapSide.SELL, wethAmounts);
      });

      it(`launch block ${block}: BUY ZRP (pay WETH)`, async () => {
        await launchDifferential(block, WETH, ZRP, SwapSide.BUY, zrpAmounts);
      });
    });
  });

  describe('Base — discovery beyond the configured set', () => {
    const dexHelper = new DummyDexHelper(network);
    const baseline = new Baseline(network, dexKey, dexHelper);
    // A pool absent from the configured bTokens; only discovery knows it.
    const BLU = {
      address: '0x2A6b1BF66542CB1463541d211747B28C6bb39e83',
      decimals: 18,
    };
    const WETH = Tokens[network].WETH;
    let blockNumber: number;

    beforeAll(async () => {
      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      await baseline.initializePricing(blockNumber);
    });

    it('resolves a pool that is not in the configured list', async () => {
      const pools = await baseline.getPoolIdentifiers(
        BLU,
        WETH,
        SwapSide.SELL,
        blockNumber,
      );
      expect(pools.length).toBeGreaterThan(0);
    });

    it('enumerates pools from the reserve side of the pair', async () => {
      // Several bTokens hold WETH as their reserve; a reserve-token query must
      // surface them, which the forward-only relay mapping could not.
      const top = await baseline.getTopPoolsForToken(WETH.address, 10);
      expect(top.length).toBeGreaterThan(0);
    });
  });

  // Fixed expected values at a pinned block; requires an archive RPC
  // (HTTP_PROVIDER_8453).
  describe('golden fixtures @ block 47987768', () => {
    const PINNED_BLOCK = 47987768;
    const dexHelper = new DummyDexHelper(network);
    const baseline = new Baseline(network, dexKey, dexHelper);

    const goldenAmounts = [
      0n,
      1n * BI_POWS[18],
      10n * BI_POWS[18],
      100n * BI_POWS[18],
      1000n * BI_POWS[18],
    ];

    beforeAll(async () => {
      await baseline.initializePricing(PINNED_BLOCK);
    });

    it('SELL REPPO -> VIRTUAL matches captured quotes', async () => {
      const prices = await baseline.getPricesVolume(
        REPPO,
        VIRTUAL,
        goldenAmounts,
        SwapSide.SELL,
        PINNED_BLOCK,
      );
      expect(prices![0].prices).toEqual([
        0n,
        38306790445928727n,
        383067278752393300n,
        3830610217586756800n,
        38299845934295582000n,
      ]);
    });

    it('BUY REPPO (pay VIRTUAL) matches captured quotes', async () => {
      const prices = await baseline.getPricesVolume(
        VIRTUAL,
        REPPO,
        goldenAmounts,
        SwapSide.BUY,
        PINNED_BLOCK,
      );
      expect(prices![0].prices).toEqual([
        0n,
        38693716908658688n,
        386937801115441020n,
        3869441214799661100n,
        38700733272435257000n,
      ]);
    });
  });
});

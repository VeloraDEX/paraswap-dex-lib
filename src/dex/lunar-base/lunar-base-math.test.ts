import { quoteXToY, quoteYToX } from './math';
import { LunarBasePoolState } from './types';

// Contract outputs of `quoteXToY` / `quoteYToX` called by a whitelisted
// caller at the pinned block (see lunar-base-integration.test.ts for the live
// version). Idle pools were made quotable with storage overrides.
type Fixture = {
  name: string;
  block: number;
  state: LunarBasePoolState;
  xToY: [string, string][];
  yToX: [string, string][];
};

const fixtures: Fixture[] = [
  {
    name: 'Base ETH/USDC',
    block: 52850455,
    state: {
      model: 'punishment',
      anchorPrice: 3864750141416366355251200n,
      feeAskX24: 1537,
      feeBidX24: 315,
      latestUpdateBlock: 52850455,
      reserveX: 7384244192268175714n,
      reserveY: 21221555601n,
      blockDelay: 3,
      maxPunishmentX24: 5000,
      concentrationK: 0,
      blacklistFeeMultiplier: 100n,
      executorsWhitelist: {},
      paused: false,
    },
    xToY: [
      ['1', '0'],
      ['123456789', '0'],
      ['163027795774436', '387915'],
      ['5428825599288720', '12917586'],
      ['201257813883541260', '478879965'],
      ['1630277957744360153', '3879039795'],
      ['8151389788721800761', '19392886778'],
      ['16286476797866157922', '0'],
      ['24454169366165402284', '0'],
      ['48908338732330804570', '0'],
    ],
    yToX: [
      ['1', '420215636'],
      ['123456789', '51878940534839610'],
      ['387922', '163012504433720'],
      ['12917831', '5428328008480923'],
      ['478890726', '201238632344288134'],
      ['3879228240', '1630079920937989390'],
      ['19396141199', '0'],
      ['38753490117', '0'],
      ['58188423598', '0'],
      ['116376847198', '0'],
    ],
  },
  {
    name: 'Base cbBTC/USDC (revived in storage)',
    block: 52850457,
    state: {
      model: 'punishment',
      anchorPrice: 2769829290558487516820799488n,
      feeAskX24: 5772,
      feeBidX24: 2350,
      latestUpdateBlock: 52850457,
      reserveX: 50000000000n,
      reserveY: 61110641n,
      blockDelay: 42200,
      maxPunishmentX24: 125829,
      concentrationK: 0,
      blacklistFeeMultiplier: 100n,
      executorsWhitelist: {},
      paused: false,
    },
    xToY: [
      ['1', '0'],
      ['123456789', '150868'],
      ['999999', '1222'],
      ['33300000', '40694'],
      ['1234499993', '1508470'],
      ['9999999945', '12211250'],
      ['49999999721', '60872915'],
      ['99899999444', '0'],
      ['149999999164', '0'],
      ['299999998330', '0'],
    ],
    yToX: [
      ['1', '800'],
      ['123456789', '0'],
      ['1222', '999479'],
      ['40700', '33288708'],
      ['1508821', '1233960329'],
      ['12222129', '9989060092'],
      ['61110641', '49795296214'],
      ['122099061', '0'],
      ['183331923', '0'],
      ['366663847', '0'],
    ],
  },
  {
    name: 'BSC BNB/USDT',
    block: 128726095,
    state: {
      model: 'punishment',
      anchorPrice: 2137141885706893696466019155968n,
      feeAskX24: 584,
      feeBidX24: 1190,
      latestUpdateBlock: 128726089,
      reserveX: 52034189337037088525n,
      reserveY: 31539924551851692603782n,
      blockDelay: 10,
      maxPunishmentX24: 7500,
      concentrationK: 0,
      blacklistFeeMultiplier: 20n,
      executorsWhitelist: {},
      paused: false,
    },
    xToY: [
      ['1', '701'],
      ['123456789', '89823855134'],
      ['953805964267673', '693963689402082239'],
      ['31761738610113524', '23108988102087391248'],
      ['1177473462888442788', '856693476419839031688'],
      ['9538059642676733811', '6939326646052637696763'],
      ['47690298213383669053', '0'],
      ['95285215830340570768', '0'],
      ['143070894640151007159', '0'],
      ['286141789280302014319', '0'],
    ],
    yToX: [
      ['1', '0'],
      ['123456789', '169665'],
      ['694012956779430739', '953772706277248'],
      ['23110631460755043630', '31760627332738056'],
      ['856758995144207248051', '1177425949073613470'],
      ['6940129567794307396126', '9537300678279841416'],
      ['34700647838971536980626', '47677975701546483539'],
      ['69331894382265130887292', '0'],
      ['104101943516914610941879', '0'],
      ['208203887033829221883760', '0'],
    ],
  },
  {
    name: 'BSC BTCB/USDT (anchor refreshed in storage)',
    block: 128726103,
    state: {
      model: 'concentration',
      anchorPrice: 314352447262406993235673088n,
      feeAskX24: 4542,
      feeBidX24: 5114,
      latestUpdateBlock: 128726103,
      reserveX: 163085519986736056361n,
      reserveY: 2192531810382299n,
      blockDelay: 10,
      maxPunishmentX24: 0,
      concentrationK: 4000,
      blacklistFeeMultiplier: 100n,
      executorsWhitelist: {},
      paused: false,
    },
    xToY: [
      ['1', '0'],
      ['123456789', '1943'],
      ['3023599465775252', '47584595609'],
      ['100685862210315919', '1584567033711'],
      ['3732633540499549583', '58743066075111'],
      ['30235994657752528016', '475340838674661'],
      ['151179973288762640078', '2083822524084523'],
      ['302057586630947754877', '1683789448978012'],
      ['453539919866287920235', '1899378297379740'],
      ['907079839732575840472', '2190881028814464'],
    ],
    yToX: [
      ['1', '63496'],
      ['123456789', '7840122766068'],
      ['47599104680', '3022780903921934'],
      ['1585050185851', '100658604097452058'],
      ['58761094727683', '3731616667631828816'],
      ['475991046801811', '30200402391484359973'],
      ['2379955234009052', '134817452899660242085'],
      ['4755150557550086', '118096793781034179394'],
      ['7139865702027156', '135136884930120969896'],
      ['14279731404054313', '158801572661328394463'],
    ],
  },
];

describe('LunarBase math matches recorded contract quotes', () => {
  fixtures.forEach(f => {
    it(`${f.name} @ ${f.block}: X -> Y`, () => {
      for (const [amount, expected] of f.xToY) {
        expect([amount, quoteXToY(f.state, BigInt(amount)).amountOut]).toEqual([
          amount,
          BigInt(expected),
        ]);
      }
    });

    it(`${f.name} @ ${f.block}: Y -> X`, () => {
      for (const [amount, expected] of f.yToX) {
        expect([amount, quoteYToX(f.state, BigInt(amount)).amountOut]).toEqual([
          amount,
          BigInt(expected),
        ]);
      }
    });
  });

  it('applies the fee multiplier of a caller that is not whitelisted', () => {
    const f = fixtures[0];
    const amount = BigInt(f.xToY[Math.floor(f.xToY.length / 2)][0]);
    const base = quoteXToY(f.state, amount, 1n);
    const penalised = quoteXToY(f.state, amount, 100n);
    expect(penalised.fee).toEqual(base.fee * 100n);
    expect(penalised.amountOut).toEqual(
      base.amountOut + base.fee - base.fee * 100n,
    );
  });

  it('rejects inputs beyond the inventory instead of reverting', () => {
    for (const f of fixtures) {
      const huge = 10n ** 40n;
      expect(quoteXToY(f.state, huge).amountOut).toEqual(0n);
      expect(quoteYToX(f.state, huge).amountOut).toEqual(0n);
    }
  });
});

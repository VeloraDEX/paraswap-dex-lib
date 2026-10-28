import dotenv from 'dotenv';
dotenv.config();

import { Contract } from '@ethersproject/contracts';
import { Network } from '../../constants';
import { DummyDexHelper } from '../../dex-helper/index';
import { testEventSubscriber } from '../../../tests/utils-events';
import { bigNumberify } from '../../utils';
import { SidechainPool } from './pools/sidechain-pool';
import { Optimism3Pool } from './pools/optimism-3pool';
import { Gnosis3Pool } from './pools/gnosis-3pool';
import { Arbitrum2Pool } from './pools/arbitrum-2pool';

jest.setTimeout(120 * 1000);

type SerializedState = {
  A: string;
  fee: string;
  admin_fee: string;
  supply: string;
  balances: string[];
};

async function fetchPoolState(
  pool: SidechainPool,
  blockNumber: number,
): Promise<SerializedState> {
  const state = await pool.generateState(blockNumber);
  return {
    A: state.A.toFixed(),
    fee: state.fee.toFixed(),
    admin_fee: state.admin_fee.toFixed(),
    supply: state.supply.toFixed(),
    balances: state.balances.map(b => b.toFixed()),
  };
}

const serialize = (state: any): SerializedState => ({
  A: bigNumberify(state.A).toFixed(),
  fee: bigNumberify(state.fee).toFixed(),
  admin_fee: bigNumberify(state.admin_fee).toFixed(),
  supply: bigNumberify(state.supply).toFixed(),
  balances: state.balances.map((b: any) => bigNumberify(b).toFixed()),
});

const testCases: {
  network: Network;
  createPool: (dexHelper: DummyDexHelper) => SidechainPool;
  events: Record<string, number[]>;
  // Whole-coin amounts used for the get_dy parity check
  amounts: number[];
}[] = [
  {
    network: Network.OPTIMISM,
    createPool: dexHelper => new Optimism3Pool('CurveV1', dexHelper),
    events: {
      TokenExchange: [158809432, 158809433],
      AddLiquidity: [158712066, 158703084],
      RemoveLiquidity: [158803204, 158800210],
      RemoveLiquidityOne: [158808918, 158805246, 158804451],
      RemoveLiquidityImbalance: [138920477, 137853756],
      NewFee: [127345344],
    },
    amounts: [1, 1000, 50000],
  },
  {
    network: Network.GNOSIS,
    createPool: dexHelper => new Gnosis3Pool('CurveV1', dexHelper),
    events: {
      TokenExchange: [48991723, 48991720],
      AddLiquidity: [48990858, 48990833],
      RemoveLiquidityOne: [48991703, 48991655, 48991597],
    },
    amounts: [1, 1000, 100000],
  },
  {
    network: Network.ARBITRUM,
    createPool: dexHelper => new Arbitrum2Pool('CurveV1', dexHelper),
    events: {
      TokenExchange: [519146087, 519146083],
      AddLiquidity: [518992408, 517989096],
      RemoveLiquidity: [519043467, 519037687],
      RemoveLiquidityOne: [519099470, 519085213, 518552545],
      RemoveLiquidityImbalance: [454124732, 424212692],
      NewFee: [269217685],
    },
    amounts: [1, 1000, 100000],
  },
];

testCases.forEach(({ network, createPool, events, amounts }) => {
  describe(`CurveV1 sidechain pool events (${network})`, () => {
    const dexHelper = new DummyDexHelper(network);
    let pool: SidechainPool;

    beforeEach(() => {
      pool = createPool(dexHelper);
    });

    Object.entries(events).forEach(([event, blockNumbers]) => {
      describe(event, () => {
        blockNumbers.forEach(blockNumber => {
          it(`State after ${blockNumber}`, async () => {
            // State is compared in its serialized form
            await testEventSubscriber<SerializedState>(
              pool as any,
              pool.addressesSubscribed,
              (_blockNumber: number) => fetchPoolState(pool, _blockNumber),
              blockNumber,
              `CurveV1_${network}_${pool.address}`,
              dexHelper.provider,
              (state, expectedState) =>
                expect(serialize(state)).toEqual(serialize(expectedState)),
            );
          });
        });
      });
    });

    it('get_dy matches on-chain', async () => {
      const blockNumber = await dexHelper.provider.getBlockNumber();
      const state = await pool.generateState(blockNumber);
      const contract = new Contract(
        pool.address,
        pool.poolIface,
        dexHelper.provider,
      );

      for (let i = 0; i < pool.N_COINS; i++) {
        for (let j = 0; j < pool.N_COINS; j++) {
          if (i === j) continue;
          for (const amount of amounts) {
            const dx = bigNumberify(amount)
              .times(1e18)
              .idiv(pool.PRECISION_MUL[i])
              .toFixed();
            const expected = await contract.get_dy(i, j, dx, {
              blockTag: blockNumber,
            });
            const actual = pool.get_dy(i, j, bigNumberify(dx), state);
            expect(actual.toFixed()).toEqual(expected.toString());
          }
        }
      }
    });
  });
});

describe('CurveV1 sidechain pool RemoveLiquidityOne coin ties', () => {
  const dexHelper = new DummyDexHelper(Network.ARBITRUM);
  const blockNumber = 519099470;

  const removeLiquidityOneLog = (
    pool: SidechainPool,
    tokenAmount: string,
    coinAmount: string,
    tokenSupply: string,
  ) => {
    const { data, topics } = pool.poolIface.encodeEventLog(
      pool.poolIface.getEvent('RemoveLiquidityOne'),
      [
        '0x000000000000000000000000000000000000dEaD',
        tokenAmount,
        coinAmount,
        tokenSupply,
      ],
    );
    return {
      address: pool.address,
      data,
      topics,
      logIndex: 0,
      transactionIndex: 0,
      transactionHash: `0x${'11'.repeat(32)}`,
      blockHash: `0x${'22'.repeat(32)}`,
      blockNumber,
    };
  };

  const setup = async (tokenAmount: string) => {
    const pool = new Arbitrum2Pool('CurveV1', dexHelper);
    const state = await pool.generateState(blockNumber - 1);
    pool.setState(state, blockNumber - 1);
    pool.isTracking = () => true;

    const lp = bigNumberify(tokenAmount);
    const dys = [0, 1].map(i => pool.calc_withdraw_one_coin(lp, i, state));
    const log = removeLiquidityOneLog(
      pool,
      tokenAmount,
      dys[1].toFixed(),
      state.supply.minus(lp).toFixed(),
    );
    const refetched = { ...state, supply: bigNumberify(42) };
    const generateState = jest
      .spyOn(pool, 'generateState')
      .mockResolvedValue(refetched);
    await pool.update([log], {
      [blockNumber]: { number: blockNumber } as any,
    });
    return { pool, dys, generateState, refetched };
  };

  it('refetches the block when coins withdraw the same amount', async () => {
    const { pool, dys, generateState, refetched } = await setup(
      '10000000000000',
    );
    expect(dys[0].eq(dys[1])).toBe(true);
    expect(generateState).toHaveBeenCalledWith(blockNumber);
    expect(pool.getState(blockNumber)).toEqual(refetched);
  });

  it('applies the event when one coin matches', async () => {
    const { pool, dys, generateState } = await setup('1000000000000000000000');
    expect(dys[0].eq(dys[1])).toBe(false);
    expect(generateState).not.toHaveBeenCalled();
    expect(pool.getState(blockNumber)!.supply).not.toEqual(bigNumberify(42));
  });
});

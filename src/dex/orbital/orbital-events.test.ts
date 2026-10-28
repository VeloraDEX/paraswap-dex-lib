/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Interface } from '@ethersproject/abi';
import { OrbitalEventPool } from './orbital-pool';
import { Network } from '../../constants';
import { Address } from '../../types';
import { DummyDexHelper } from '../../dex-helper/index';
import { testEventSubscriber } from '../../../tests/utils-events';
import { PoolState } from './types';
import OrbitalPoolABI from '../../abi/orbital/OrbitalPool.json';

jest.setTimeout(120 * 1000);

// Polygon USDC / USDT0 / DAI pool: assets, decimals and fee are immutable.
const POOL_INFO = {
  address: '0x6b229b018Cc4B5ba48ab3C7a5b4578E17Bc117DA',
  assets: [
    '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063',
  ] as [Address, Address, Address],
  decimals: [6, 6, 18] as [number, number, number],
  fee: 5n * 10n ** 12n,
};

// eventName -> blockNumbers
type EventMappings = Record<string, number[]>;

describe('Orbital EventPool Polygon', function () {
  const dexKey = 'Orbital';
  const network = Network.POLYGON;
  const dexHelper = new DummyDexHelper(network);
  const logger = dexHelper.getLogger(dexKey);
  let orbitalPool: OrbitalEventPool;

  const eventsToTest: Record<Address, EventMappings> = {
    [POOL_INFO.address]: {
      // Replayed through the exact quote path, checked against the logged amounts.
      Swap: [
        95922062, 95930016, 95977962, 96011933, 96187805, 96211448, 96243120,
        96297399, 96323946,
      ],
      SwapExactOutput: [95918966, 95918976],
      // Regenerated at the end of the block.
      Mint: [95919514, 95922057, 95980864, 96198265],
      // Burn, Collect and Mint in one block: regenerated once, nothing replayed on top.
      Burn: [95981536],
    },
  };

  beforeEach(async () => {
    orbitalPool = new OrbitalEventPool(
      dexKey,
      network,
      dexHelper,
      logger,
      POOL_INFO,
      new Interface(OrbitalPoolABI),
    );
  });

  Object.entries(eventsToTest).forEach(
    ([poolAddress, events]: [string, EventMappings]) => {
      describe(`Events for ${poolAddress}`, () => {
        Object.entries(events).forEach(
          ([eventName, blockNumbers]: [string, number[]]) => {
            describe(`${eventName}`, () => {
              blockNumbers.forEach((blockNumber: number) => {
                it(`State after ${blockNumber}`, async function () {
                  await testEventSubscriber(
                    orbitalPool,
                    orbitalPool.addressesSubscribed,
                    (_blockNumber: number) =>
                      orbitalPool.generateState(
                        _blockNumber,
                      ) as Promise<PoolState>,
                    blockNumber,
                    `${dexKey}_${poolAddress}`,
                    dexHelper.provider,
                  );
                });
              });
            });
          },
        );
      });
    },
  );
});

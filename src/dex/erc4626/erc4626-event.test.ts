import dotenv from 'dotenv';

dotenv.config();

import { ERC4626EventPool } from './erc-4626-pool';
import { ERC4626Config } from './config';
import { Network } from '../../constants';
import { DummyDexHelper } from '../../dex-helper/index';
import ERC4626_ABI from '../../abi/ERC4626.json';
import { DEPOSIT_TOPIC, TRANSFER_TOPIC, WITHDRAW_TOPIC } from './constants';
import { testEventSubscriber } from '../../../tests/utils-events';
import { ERC4626PoolState } from './types';

import { Interface } from '@ethersproject/abi';
import _ from 'lodash';

jest.setTimeout(50 * 1000);
const networks = [
  Network.MAINNET,
  Network.ARBITRUM,
  Network.BASE,
  Network.POLYGON,
  Network.OPTIMISM,
  Network.GNOSIS,
];

async function fetchPoolState(
  wusdmPool: ERC4626EventPool,
  blockNumber: number,
): Promise<ERC4626PoolState> {
  const eventState = wusdmPool.getState(blockNumber);
  if (eventState) return eventState;
  const onChainState = await wusdmPool.generateState(blockNumber);
  wusdmPool.setState(onChainState, blockNumber);
  return onChainState;
}

describe('Wusdm', function () {
  const dexKey = 'Wusdm';
  const multichainBlockNumbers: {
    [network: string]: { [eventName: string]: number[] };
  } = {
    [Network.MAINNET]: {
      deposit: [20808811, 20692902, 20685702],
      withdraw: [20873278, 20869272, 20862960],
    },
    [Network.ARBITRUM]: {
      deposit: [259463653, 259456755, 259448821],
      withdraw: [259421319, 259420791, 259419437],
    },
    [Network.BASE]: {
      deposit: [20521934, 20460747, 20436449],
      withdraw: [20492729, 20409282, 20274826],
    },
    [Network.POLYGON]: {
      deposit: [62509681, 62359608, 62160587],
      withdraw: [62505429, 62381506, 62125779],
    },
    [Network.OPTIMISM]: {
      deposit: [126118678, 126116167, 126110439],
      withdraw: [126113314, 126108196, 126107784],
    },
    [Network.GNOSIS]: {
      deposit: [
        38964215, 38964218, 38964219, 38964222, 38964224, 38964243, 38964244,
        38964245, 38964247, 38964249, 38964253, 38964263, 38964303, 38964309,
        38964311, 38964314,
      ],
      withdraw: [
        38964215, 38964218, 38964219, 38964221, 38964222, 38964224, 38964225,
        38964230, 38964233, 38964236, 38964238, 38964243, 38964244, 38964245,
        38964246, 38964277, 38964278, 38964279, 38964289, 38964294, 38964302,
        38964309, 38964314,
      ],
    },
  };

  networks.forEach(network => {
    describe(`${network}`, function () {
      const dexKey = network === Network.GNOSIS ? 'sDAI' : 'wUSDM';

      const wUSDMAddress = ERC4626Config[dexKey][network].vault;
      const USDMAddress = ERC4626Config[dexKey][network].asset;

      const wUSDMIface: Interface = new Interface(ERC4626_ABI);

      const blockNumbers = Array.from(
        new Set(
          Object.values(multichainBlockNumbers[network])
            .flat()
            .sort((a, b) => a - b),
        ),
      );

      blockNumbers.forEach((blockNumber: number) => {
        it(`Should return the correct state after the ${blockNumber}`, async function () {
          const dexHelper = new DummyDexHelper(network);
          const logger = dexHelper.getLogger(dexKey);

          const wusdmPool = new ERC4626EventPool(
            dexKey,
            network,
            `wusdm-pool`,
            dexHelper,
            wUSDMAddress,
            USDMAddress,
            wUSDMIface,
            logger,
            DEPOSIT_TOPIC,
            WITHDRAW_TOPIC,
            TRANSFER_TOPIC,
          );

          // await wusdmPool.initialize(blockNumber - 1);

          await testEventSubscriber(
            wusdmPool,
            wusdmPool.addressesSubscribed,
            (_blockNumber: number) => fetchPoolState(wusdmPool, _blockNumber),
            blockNumber,
            `${dexKey}_${wUSDMAddress}`,
            dexHelper.provider,
          );
        });
      });
    });
  });
});

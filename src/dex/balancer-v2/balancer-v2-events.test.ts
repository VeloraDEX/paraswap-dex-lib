import dotenv from 'dotenv';
dotenv.config();

import { BalancerV2EventPool } from './balancer-v2';
import { SubgraphPoolBase, PoolStateMap } from './types';
import { BalancerConfig } from './config';
import { Network } from '../../constants';
import { DummyDexHelper } from '../../dex-helper/index';
import { testEventSubscriber } from '../../../tests/utils-events';
import axios from 'axios';

jest.setTimeout(50 * 1000);
const dexKey = 'BalancerV2';
const network = Network.MAINNET;
const config = BalancerConfig[dexKey][network];

async function getSubgraphPool(
  address: string,
  blockNumber: number,
): Promise<SubgraphPoolBase> {
  address = address.toLowerCase();

  const query = `query ($blockNumber: Int, $address: Bytes!) {
    pools: pools(block: { number: $blockNumber }, where: {address: $address}) {
      id
      address
      poolType
      tokens {
        address
        decimals
      }
    }
  }`;

  const variables = {
    blockNumber,
    address,
  };

  const data = await axios.post(
    config.subgraphURL,
    { query, variables },
    { timeout: 5000 },
  );
  return data.data.data.pools[0];
}

async function fetchOnePoolState(
  balancerPools: BalancerV2EventPool,
  blockNumber: number,
  poolAddress: string,
): Promise<PoolStateMap> {
  const subPools: SubgraphPoolBase[] = [
    await getSubgraphPool(poolAddress, blockNumber),
  ];
  const poolsStateMap = await balancerPools.getOnChainState(
    subPools,
    blockNumber,
  );
  return poolsStateMap;
}

describe('BalancerV2 Event', function () {
  const blockNumbers: { [event: string]: [number, string][] } = {
    Swap: [
      [14132661, '0xaac98ee71d4f8a156b6abaa6844cdb7789d086ce'],
      [14132685, '0xaac98ee71d4f8a156b6abaa6844cdb7789d086ce'],
      [14132691, '0xa6f548df93de924d73be7d25dc02554c6bd66db5'],
      [14132693, '0xaac98ee71d4f8a156b6abaa6844cdb7789d086ce'],
      [14132697, '0x5c6ee304399dbdb9c8ef030ab642b10820db8f56'],
      [14132712, '0xa6f548df93de924d73be7d25dc02554c6bd66db5'],
      [14132713, '0xec60a5fef79a92c741cb74fdd6bfc340c0279b01'],
      [14132714, '0xec60a5fef79a92c741cb74fdd6bfc340c0279b01'],
      [14132744, '0x231e687c9961d3a27e6e266ac5c433ce4f8253e4'],
      [14132748, '0x01abc00e86c7e258823b9a055fd62ca6cf61a163'],
      [14132749, '0x0b09dea16768f0799065c475be02919503cb2a35'],
      [14132751, '0xa6f548df93de924d73be7d25dc02554c6bd66db5'],
      [14132752, '0x06df3b2bbb68adc8b0e302443692037ed9f91b42'],
      [14132753, '0x072f14b85add63488ddad88f855fda4a99d6ac9b'],
      [14132760, '0x0b09dea16768f0799065c475be02919503cb2a35'],
      [14132763, '0x90291319f1d4ea3ad4db0dd8fe9e12baf749e845'],
      [14132764, '0x186084ff790c65088ba694df11758fae4943ee9e'],
      [14132781, '0x5e6989c0e2b6600ab585d56bf05479d5450a60c8'],
    ],
    PoolBalanceChanged: [
      [14133122, '0x87165b659ba7746907a48763063efa3b323c2b07'],
      [14133354, '0xf4c0dd9b82da36c07605df83c8a416f11724d88b'],
      [14133439, '0x2d6e3515c8b47192ca3913770fa741d3c4dac354'],
      // [14133532, '0x32296969ef14eb0c6d29669c550d4a0449130230'], // MetaStable pool not supported
      [14133594, '0x9e030b67a8384cbba09d5927533aa98010c87d91'],
      [14133906, '0xa6f548df93de924d73be7d25dc02554c6bd66db5'],
      [14134019, '0x29d7a7e0d781c957696697b94d4bc18c651e358e'],
      [14134022, '0x5d6e3d7632d6719e04ca162be652164bec1eaa6b'],
      [14134311, '0x5c6ee304399dbdb9c8ef030ab642b10820db8f56'],
      [14134479, '0x5c6ee304399dbdb9c8ef030ab642b10820db8f56'],
      [14134601, '0xf4c0dd9b82da36c07605df83c8a416f11724d88b'],
      // [14134676, '0x32296969ef14eb0c6d29669c550d4a0449130230'], // MetaStable pool not supported
      [14135455, '0xccf5575570fac94cec733a58ff91bb3d073085c7'],
      [14135835, '0xf3a605da753e9de545841de10ea8bffbd1da9c75'],
    ],
  };

  describe('BalancerV2EventPool', function () {
    Object.keys(blockNumbers).forEach((event: string) => {
      blockNumbers[event].forEach(([blockNumber, poolAddress]) => {
        it(`Should return the correct state after the ${blockNumber}:${event}`, async function () {
          const dexHelper = new DummyDexHelper(network);
          const logger = dexHelper.getLogger(dexKey);

          const balancerPools = new BalancerV2EventPool(
            dexKey,
            network,
            config.vaultAddress,
            config.apiNetworkName,
            dexHelper,
            logger,
          );

          await testEventSubscriber(
            balancerPools,
            balancerPools.addressesSubscribed,
            (_blockNumber: number) =>
              fetchOnePoolState(balancerPools, _blockNumber, poolAddress),
            blockNumber,
            `${dexKey}_${poolAddress}`,
            dexHelper.provider,
          );
        });
      });
    });
  });
});

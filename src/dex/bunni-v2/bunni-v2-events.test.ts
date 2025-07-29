/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { BunniV2EventPool } from './bunni-v2-pool';
import { Network } from '../../constants';
import { DummyDexHelper } from '../../dex-helper/index';
import { testEventSubscriber } from '../../../tests/utils-events';
import { PoolState, ProtocolState } from './types';

async function fetchPoolState(
  bunniV2EventPool: BunniV2EventPool,
  blockNumber: number,
): Promise<ProtocolState> {
  return (await bunniV2EventPool.generateState(blockNumber)) as ProtocolState;
}

function compareState(poolState: PoolState, expectedPoolState: PoolState) {
  expect(poolState.id).toEqual(expectedPoolState.id);

  expect(poolState.key.currency0).toEqual(expectedPoolState.key.currency0);
  expect(poolState.key.currency1).toEqual(expectedPoolState.key.currency1);
  expect(poolState.key.fee).toEqual(expectedPoolState.key.fee);
  expect(poolState.key.tickSpacing).toEqual(expectedPoolState.key.tickSpacing);
  expect(poolState.key.hooks).toEqual(expectedPoolState.key.hooks);

  expect(poolState.slot0.sqrtPriceX96).toEqual(
    expectedPoolState.slot0.sqrtPriceX96,
  );
  expect(poolState.slot0.tick).toEqual(expectedPoolState.slot0.tick);
  expect(poolState.slot0.lastSwapTimestamp).toEqual(
    expectedPoolState.slot0.lastSwapTimestamp,
  );
  expect(poolState.slot0.lastSurgeTimestamp).toEqual(
    expectedPoolState.slot0.lastSurgeTimestamp,
  );

  expect(poolState.rawBalance0).toEqual(expectedPoolState.rawBalance0);
  expect(poolState.rawBalance1).toEqual(expectedPoolState.rawBalance1);
  expect(poolState.reserve0).toEqual(expectedPoolState.reserve0);
  expect(poolState.reserve1).toEqual(expectedPoolState.reserve1);
  expect(poolState.idleBalance).toEqual(expectedPoolState.idleBalance);
  expect(poolState.totalSupply).toEqual(expectedPoolState.totalSupply);
  expect(poolState.ldfState).toEqual(expectedPoolState.ldfState);
  expect(poolState.curatorFeeRate).toEqual(expectedPoolState.curatorFeeRate);
  expect(poolState.rebalanceOrderHash).toEqual(
    expectedPoolState.rebalanceOrderHash,
  );

  expect(poolState.liquidityDensityFunction).toEqual(
    expectedPoolState.liquidityDensityFunction,
  );
  expect(poolState.bunniHub).toEqual(expectedPoolState.bunniHub);
  expect(poolState.bunniToken).toEqual(expectedPoolState.bunniToken);
  expect(poolState.hooklet).toEqual(expectedPoolState.hooklet);
  expect(poolState.twapSecondsAgo).toEqual(expectedPoolState.twapSecondsAgo);
  expect(poolState.ldfParams).toEqual(expectedPoolState.ldfParams);
  expect(poolState.hookParams).toEqual(expectedPoolState.hookParams);
  expect(poolState.vault0).toEqual(expectedPoolState.vault0);
  expect(poolState.vault1).toEqual(expectedPoolState.vault1);
  expect(poolState.ldfType).toEqual(expectedPoolState.ldfType);
  expect(poolState.minRawTokenRatio0).toEqual(
    expectedPoolState.minRawTokenRatio0,
  );
  expect(poolState.targetRawTokenRatio0).toEqual(
    expectedPoolState.targetRawTokenRatio0,
  );
  expect(poolState.maxRawTokenRatio0).toEqual(
    expectedPoolState.maxRawTokenRatio0,
  );
  expect(poolState.minRawTokenRatio1).toEqual(
    expectedPoolState.minRawTokenRatio1,
  );
  expect(poolState.targetRawTokenRatio1).toEqual(
    expectedPoolState.targetRawTokenRatio1,
  );
  expect(poolState.maxRawTokenRatio1).toEqual(
    expectedPoolState.maxRawTokenRatio1,
  );
  expect(poolState.currency0Decimals).toEqual(
    expectedPoolState.currency0Decimals,
  );
  expect(poolState.currency1Decimals).toEqual(
    expectedPoolState.currency1Decimals,
  );
  expect(poolState.vault0Decimals).toEqual(expectedPoolState.vault0Decimals);
  expect(poolState.vault1Decimals).toEqual(expectedPoolState.vault1Decimals);

  expect(poolState.index).toEqual(expectedPoolState.index);
  expect(poolState.cardinality).toEqual(expectedPoolState.cardinality);
  expect(poolState.cardinalityNext).toEqual(expectedPoolState.cardinalityNext);
  expect(poolState.intermediateObservation.blockTimestamp).toEqual(
    expectedPoolState.intermediateObservation.blockTimestamp,
  );
  expect(poolState.intermediateObservation.prevTick).toEqual(
    expectedPoolState.intermediateObservation.prevTick,
  );
  expect(poolState.intermediateObservation.tickCumulative).toEqual(
    expectedPoolState.intermediateObservation.tickCumulative,
  );
  expect(poolState.intermediateObservation.initialized).toEqual(
    expectedPoolState.intermediateObservation.initialized,
  );

  expect(poolState.observations.length).toEqual(
    expectedPoolState.observations.length,
  );

  poolState.observations.forEach((observation, i) => {
    expect(observation.blockTimestamp).toEqual(
      expectedPoolState.observations[i].blockTimestamp,
    );
    expect(observation.prevTick).toEqual(
      expectedPoolState.observations[i].prevTick,
    );
    expect(observation.tickCumulative).toEqual(
      expectedPoolState.observations[i].tickCumulative,
    );
    expect(observation.initialized).toEqual(
      expectedPoolState.observations[i].initialized,
    );
  });

  expect(poolState.initialized).toEqual(expectedPoolState.initialized);
  expect(poolState.sharePrice0).toEqual(expectedPoolState.sharePrice0);
  expect(poolState.sharePrice1).toEqual(expectedPoolState.sharePrice1);

  expect(poolState.topBid.manager).toEqual(expectedPoolState.topBid.manager);
  expect(poolState.topBid.blockIdx).toEqual(expectedPoolState.topBid.blockIdx);
  expect(poolState.topBid.payload).toEqual(expectedPoolState.topBid.payload);
  expect(poolState.topBid.rent).toEqual(expectedPoolState.topBid.rent);
  expect(poolState.topBid.deposit).toEqual(expectedPoolState.topBid.deposit);

  expect(poolState.nextBid.manager).toEqual(expectedPoolState.nextBid.manager);
  expect(poolState.nextBid.blockIdx).toEqual(
    expectedPoolState.nextBid.blockIdx,
  );
  expect(poolState.nextBid.payload).toEqual(expectedPoolState.nextBid.payload);
  expect(poolState.nextBid.rent).toEqual(expectedPoolState.nextBid.rent);
  expect(poolState.nextBid.deposit).toEqual(expectedPoolState.nextBid.deposit);

  expect(poolState.overrideZeroToOne).toEqual(
    expectedPoolState.overrideZeroToOne,
  );
  expect(poolState.feeZeroToOne).toEqual(expectedPoolState.feeZeroToOne);
  expect(poolState.overrideOneToZero).toEqual(
    expectedPoolState.overrideOneToZero,
  );
  expect(poolState.feeOneToZero).toEqual(expectedPoolState.feeOneToZero);
}

describe('BunniV2 EventPool', function () {
  const dexKey = 'BunniV2';

  describe('MAINNET', function () {
    const network = Network.MAINNET;
    const dexHelper = new DummyDexHelper(network);
    const logger = dexHelper.getLogger(dexKey);
    let bunniV2Pool: BunniV2EventPool;

    beforeEach(async () => {
      bunniV2Pool = new BunniV2EventPool(dexKey, network, dexHelper, logger);
    });

    describe('USDC-USDT: 0xd9f673912e1da331c9e56c5f0dbc7273c0eb684617939a375ec5e227c62d6707', function () {
      const poolId =
        '0xd9f673912e1da331c9e56c5f0dbc7273c0eb684617939a375ec5e227c62d6707';

      const eventsToTest: { [eventName: string]: number[] } = {
        ['Initialize']: [
          22976646, // https://etherscan.io/tx/0x099f0a8680cb1b5cd069ad4f632b04ba88fe7ebca33ff41c4e7474fd943fa8d5
        ],
        ['Deposit']: [
          22976663, // https://etherscan.io/tx/0x51ff5d13b6bba9b0f056b3e9b5b6af740e40c1fd616ff4e6ce5779677be6b2a1
          22987212, // https://etherscan.io/tx/0xca758cf5902bd2462a32888f49a512e5811755743d4b84db2383d6d4bfde12d3
          22988475, // https://etherscan.io/tx/0x2906d222d0ce6a32e6361f02aa85aff8e17059965748cf9cb471029141927bcc
          22988645, // https://etherscan.io/tx/0x29477dd7c7c68d28d0db48aa670f3d8d3bc9068a551b73912b32438e611602e3
          22988716, // https://etherscan.io/tx/0xef1575576cb320745521a5983dd5f73e920d70af8ef5f7422dab1a0112181232
          22988787, // https://etherscan.io/tx/0x5ca9ca7962d2823d0d1f63559b2abe5acf965d058a5d0637fd1436588c057a4d
          22988795, // https://etherscan.io/tx/0xfdf0543f6234d691cde4fc10f84791759664e5f4d4f99a2a3a20ef34d106e7a5
          22988823, // https://etherscan.io/tx/0x0342b47731240fc0bf2cec65168809e9eaf97c49ef5e68b813c98fe4ae451916
          22988836, // https://etherscan.io/tx/0xcfdc2776dd7ec1c82fb450af1864eed5010dcf107c999766af42c53bb0317de9
          22988916, // https://etherscan.io/tx/0x38110db0f6cc8cec719986a7864c591b92eb13406b6dd04941c183faef83f546
        ],
        ['Withdraw']: [],
        ['Swap']: [
          22976701, // https://etherscan.io/tx/0x149a651910116b4e26b5343166a10ab8c098ebc20aabe52e750c496cb57f9fd0
          22976795, // https://etherscan.io/tx/0x6ed9b71fd587cea25571acf76c04dd773cf8305a6f465e9af4e5acc31b104a1a
          22977390, // https://etherscan.io/tx/0x329c730b3bbad52411c38757de9dad26a126a3320e68f427255d9c5513b55bdc
          22985518, // https://etherscan.io/tx/0x0063ac595d499652788d9914e57a14655f1e7faeae9205a92b7fb4bf6bf06574
          22986195, // https://etherscan.io/tx/0x649f09b6986263bb0ce5bf32299482f4d2d51d4855ed63da713e415f2383b0a4
          22987224, // https://etherscan.io/tx/0xaa732647a3cc11334f5676ab6aa8c801ea250500282baf61ebdc8c0029319405
          22987280, // https://etherscan.io/tx/0x3e7b5792baa4583098fc3e29a67299768faee2d630ca3c02769ff9b604301861
          22987322, // https://etherscan.io/tx/0xa51984bd70bb5741eeba72910ce36249ff10dc64da607ae056b799063c3806b5
          22987332, // https://etherscan.io/tx/0x423d77d51fde9557bc232e524cce91a148f21dac2024155ac4a3a9927840f1dc
          22987337, // https://etherscan.io/tx/0x1d48bb91ad7c7973f0076e1c2bea76003218371769dc4aae17a087f8c4507d72
        ],
        ['OrderEtched']: [
          22985518, // https://etherscan.io/tx/0x0063ac595d499652788d9914e57a14655f1e7faeae9205a92b7fb4bf6bf06574
          22986195, // https://etherscan.io/tx/0x649f09b6986263bb0ce5bf32299482f4d2d51d4855ed63da713e415f2383b0a4
          22987224, // https://etherscan.io/tx/0xaa732647a3cc11334f5676ab6aa8c801ea250500282baf61ebdc8c0029319405
          22987280, // https://etherscan.io/tx/0x3e7b5792baa4583098fc3e29a67299768faee2d630ca3c02769ff9b604301861
          22987322, // https://etherscan.io/tx/0xa51984bd70bb5741eeba72910ce36249ff10dc64da607ae056b799063c3806b5
          22987356, // https://etherscan.io/tx/0x7fccb76d898031d42d9b961d3bd668e7a099a68a76d061bb4c8aa0c8ce29b492
          22988384, // https://etherscan.io/tx/0x596b3e199e8af8511f072728e2d0a9723b82aa76dd0cdf816bea7f70ec6bd9b6
          22988765, // https://etherscan.io/tx/0x6300c9e666b3e81ad0ac4fcf815fab8ec5a612c178c80fb29d2bba5e230ecf98
          22988804, // https://etherscan.io/tx/0xdfc035f9d5100b638a20c896465ea3028f4d6e9f5478a7e22d531d8c05f984c2
          22989223, // https://etherscan.io/tx/0x3e94a63689a24a478b1653bb2c8f74237dc789cbe347087eb18446ed471d05df
        ],
        ['OrderFulfilled']: [
          22989421, // https://etherscan.io/tx/0x0f1506725dbd7b8b0ee9b8b682937ba2ba7a0d97f0e210b72a2eb44230397ca4
        ],
      };

      const stateCompare = (
        state: ProtocolState,
        expectedState: ProtocolState,
      ) => {
        const poolState = state.poolStates[poolId];
        const expectedPoolState = expectedState.poolStates[poolId];
        poolState
          ? compareState(poolState, expectedPoolState)
          : expect(poolState).toEqual(expectedPoolState);
      };

      Object.keys(eventsToTest).forEach((event: string) => {
        eventsToTest[event].forEach(blockNumber => {
          it(`${event}:${blockNumber} - should return correct state`, async function () {
            await testEventSubscriber(
              bunniV2Pool,
              bunniV2Pool.addressesSubscribed,
              (_blockNumber: number) =>
                fetchPoolState(bunniV2Pool, _blockNumber),
              blockNumber,
              `${dexKey}_${poolId}`,
              dexHelper.provider,
              stateCompare,
            );
          });
        });
      });
    });

    describe('USD0-USD0++: 0x54ff1fd1d62f3bc6224082ecfdb3190a34e8428611b058ade19ce6c083cb608b', function () {
      const poolId =
        '0x54ff1fd1d62f3bc6224082ecfdb3190a34e8428611b058ade19ce6c083cb608b';

      const eventsToTest: { [eventName: string]: number[] } = {
        ['Initialize']: [
          22798113, //
        ],
        ['Deposit']: [
          22798128, // https://etherscan.io/tx/0x28d1685f0c1e243762a90fc5df6112abb3eb0b20b4b244478ab2430a7e579a4f
          22824518, // https://etherscan.io/tx/0x6fd55f366cad7efa8d4affde63038bc4fbd6ab0c36ffc8c5c34b7a0c3e936f67
          22831152, // https://etherscan.io/tx/0x2d7bb6b22368bd02432d0e2b222b2eb9cd9d7a61525414570573e724154bef94
          22831170, // https://etherscan.io/tx/0x966a0cca5287d7909a584b23ac932aaf6b419cb6d54c532787ccad406b73e7cb
          22837930, // https://etherscan.io/tx/0xfb2c3f4ba4a1d17e9257db4f4391751dc2d9068a04d8edcc1d0cffa769cb6fbf
          22855403, // https://etherscan.io/tx/0xd200c21b9a4d6aa2177f2959079f684aa472fcecb46f53bcadaf93760191aee1
        ],
        ['Withdraw']: [],
        ['Swap']: [
          22831187, // https://etherscan.io/tx/0x5688c817ea8abb8701bbcb3cad153efa4f8cfd94bb1f9130015789b79fe0b1ba
          22839150, // https://etherscan.io/tx/0x4eb0643db30f163454b646f5a07d73dc051b3bc18ada39011f550fab386dde6d
          22840757, // https://etherscan.io/tx/0x34ca56743749ae57006f97cfd81f384bf333913c88a08afd446676dd02a0b6ef
          22848716, // https://etherscan.io/tx/0x47260728a40e33c97dcb755522c28ac977d8b148f2447d08a331be2359ea3979
          22849291, // https://etherscan.io/tx/0x99b4ca5ee85a3455d3351794e9c364b63ba3c842dc5639f230464460ad5c4a40
          22851963, // https://etherscan.io/tx/0xfc504e613a7fcb4710366513aa430d77900ad737f9856c05c47de04960588f95
          22855636, // https://etherscan.io/tx/0x0cb3268dcb07a5317a47674231dd6839532c032bae6e5ba9e9cf219dd8be41ab
          22856761, // https://etherscan.io/tx/0x8e256ead043b4c14e9e342819568b6b8c9ceb31729e1768f301b1e66105e8895
          22860765, // https://etherscan.io/tx/0xaeb3e97ebea59e2e6a263b66769c5ae47232b3944b04b16a18df43fb8acb3ae0
          22861463, // https://etherscan.io/tx/0x56708544df89bbf8c26b39df8a6a93b8d22ac64969e8f5c009691b58c667eff7
        ],
      };

      const stateCompare = (
        state: ProtocolState,
        expectedState: ProtocolState,
      ) => {
        const poolState = state.poolStates[poolId];
        const expectedPoolState = expectedState.poolStates[poolId];
        poolState
          ? compareState(poolState, expectedPoolState)
          : expect(poolState).toEqual(expectedPoolState);
      };

      Object.keys(eventsToTest).forEach((event: string) => {
        eventsToTest[event].forEach(blockNumber => {
          it(`${event}:${blockNumber} - should return correct state`, async function () {
            await testEventSubscriber(
              bunniV2Pool,
              bunniV2Pool.addressesSubscribed,
              (_blockNumber: number) =>
                fetchPoolState(bunniV2Pool, _blockNumber),
              blockNumber,
              `${dexKey}_${poolId}`,
              dexHelper.provider,
              stateCompare,
            );
          });
        });
      });
    });

    describe('USDT-USDf: 0x68306351b1155f7329bc4428657aa73b8a32e87e916f897b7dcb1328f2ec60a3', function () {
      const poolId =
        '0x68306351b1155f7329bc4428657aa73b8a32e87e916f897b7dcb1328f2ec60a3';

      const eventsToTest: { [eventName: string]: number[] } = {
        ['Initialize']: [
          22297355, // https://etherscan.io/tx/0x77acdc0f9680ba2c9c71eb449ff1e4e1b27b32bc5cb100e3311b276a9a52c721
        ],
        ['Deposit']: [
          22297462, // https://etherscan.io/tx/0x5ea0eb8f2f992945c6d06e315b04225758719efec689388fe09dfb175fc4f0ac
          22297482, // https://etherscan.io/tx/0xfc96ba8f27ad3ba12d9443490e9919694fe18901308069364c501d096f531de2
          22326691, // https://etherscan.io/tx/0xe79ffe32bdf4dee2451ca7a9418c6f2c302f3284dbd3f074d90d372b1b3deb75
          22565970, // https://etherscan.io/tx/0x9d727eb11e301a7a8f822e1707f0b225944a243673c4081110c38a5530f3c70f
          22565999, // https://etherscan.io/tx/0x8a07736e3562ce0364fb75de979b6f934d41d282dcbe6eb2932a7d5cb9acc52a
          22587801, // https://etherscan.io/tx/0x57a615b3a3c5c8b68f959047a5712b42af246d2af79dfb5373e348c1baa15dca
          22594084, // https://etherscan.io/tx/0xccf1e98a25d6ea81457934289574aa7237a1cc7854f19002a7f4e812418a1fc2
          22629021, // https://etherscan.io/tx/0x783899ca86bb7ef7f33ac07bee5ce4fc6791d4697e02742d818aabdfedb95d47
          22744417, // https://etherscan.io/tx/0x11b3bd2ebebf5cde8b1b1b010618839eac537f3a3c8db6ab32f513835eb4bf81
          22751983, // https://etherscan.io/tx/0x354ec78110041014e01efde6ea8d7c406ff734313872b494f27395a18c43f916
        ],
        ['Withdraw']: [
          22791021, // https://etherscan.io/tx/0x99c0da12dc4f20529a2341565e2ebd60a2643e9f69a98c600803b90709db34c6
          22830291, // https://etherscan.io/tx/0x49f594bd53f6d0392c0eef9fd09bce56198df84f16551456947cf0fffa2bb46c
          22858282, // https://etherscan.io/tx/0x56c6b2228391a2a2097ad54c46c40033c9f2904ea11051f9ab02c1db73bbb434
          22867398, // https://etherscan.io/tx/0xa02525f33d61704cc3ba359d07e2ad7e1306603c7874c5902af960d7c11fca7e
          22867882, // https://etherscan.io/tx/0xcc5950da4f56f11bdd599deba39a23288095ea76a65786f5782878b8ac826bab
          22867887, // https://etherscan.io/tx/0x0b358586095d8e44e87da6bae035f78462665cb35149c9168dc895a23965d4dd
          22871891, // https://etherscan.io/tx/0x348acfe4b151a39876b42298d291b52bc0ee3dda98496274c8e74b44d331ab75
          22873909, // https://etherscan.io/tx/0xed3b6e7c29b74700d82db8a482b89f8c2d70fa9eb91870059757ac8535857402
        ],
        ['Swap']: [
          22344939, // https://etherscan.io/tx/0x8dd360971a5cfd0cd500a0c7c06aaf2d9f57952a542e817bd984cf525b9652a3
          22347910, // https://etherscan.io/tx/0x9c2de183b53042c5acc06b18191eb5ddd0f8011607e5dd908b30c1b6b9c72867
          22348569, // https://etherscan.io/tx/0xd9540d36c40c933908c76b3ec932263234e354a467cb71fb892ea719c9e3fd64
          22361243, // https://etherscan.io/tx/0x89bde3f705c5f8c843abfdf13937574e59895b894f4633cd101a3c3e30b28623
          22361650, // https://etherscan.io/tx/0x993f13f8d8ed7480022f7228e28a89256eb123c1de701f57f0b3226a73d27f1a
          22364339, // https://etherscan.io/tx/0xcd9607d40a2a9112209474c0ebf21db1a36d2d905966ae62ddceea2dd806124a
          22364618, // https://etherscan.io/tx/0x9668f6cdddda597debeb7cf02208e91087fb2f61139b7564a8427e42174bc91c
          22365113, // https://etherscan.io/tx/0x2c2e03e2ce8727c3b7904438bd2971c54d13c55a1ac2668351630848b9df1d81
          22371434, // https://etherscan.io/tx/0xb89cd4c6365ea64793f754c2f8a727735f2167d691123220af6bd245c8524a22
          22372487, // https://etherscan.io/tx/0x410fe3ab4257b764c373f8072cf20e2510d2221f7472e94cbfc959b57ed887a5
        ],
      };

      const stateCompare = (
        state: ProtocolState,
        expectedState: ProtocolState,
      ) => {
        const poolState = state.poolStates[poolId];
        const expectedPoolState = expectedState.poolStates[poolId];
        poolState
          ? compareState(poolState, expectedPoolState)
          : expect(poolState).toEqual(expectedPoolState);
      };

      Object.keys(eventsToTest).forEach((event: string) => {
        eventsToTest[event].forEach(blockNumber => {
          it(`${event}:${blockNumber} - should return correct state`, async function () {
            await testEventSubscriber(
              bunniV2Pool,
              bunniV2Pool.addressesSubscribed,
              (_blockNumber: number) =>
                fetchPoolState(bunniV2Pool, _blockNumber),
              blockNumber,
              `${dexKey}_${poolId}`,
              dexHelper.provider,
              stateCompare,
            );
          });
        });
      });
    });
  });

  describe('BASE', function () {
    const network = Network.BASE;
    const dexHelper = new DummyDexHelper(network);
    const logger = dexHelper.getLogger(dexKey);
    let bunniV2Pool: BunniV2EventPool;

    beforeEach(async () => {
      bunniV2Pool = new BunniV2EventPool(dexKey, network, dexHelper, logger);
    });

    describe('ETH-USDC: 0x471931205b39f65dcf1c063761c098f7b29237af4059533e246a3545929156ed', function () {
      const poolId =
        '0x471931205b39f65dcf1c063761c098f7b29237af4059533e246a3545929156ed';

      const eventsToTest: { [eventName: string]: number[] } = {
        ['Initialize']: [
          31789456, // https://basescan.org/tx/0x62d4b4e7baff6d7a4ab07963f0710fecaf493ef1cd1002784421c78871e3881b
        ],
        ['Deposit']: [
          31789761, // https://basescan.org/tx/0xe08ef3e36fb2945e5babf03b88c06af7a7be9699a4bd1d26fa4e70e6c4e37a09
          31790048, // https://basescan.org/tx/0x0a7e1b8cc99e5dacd84aaac222468b3b79cb22cddf22e4bc6903413cc0aafe48
          31790725, // https://basescan.org/tx/0x11c0f1d7a28d8473efe0940830560d3328bf52a7ddfe0399abd4929268ff517d
          31790771, // https://basescan.org/tx/0x14eee75bac614c96b5b7430d3a11c0a21d176eff516b62d98dc6ef273e3cda7e
          31819476, // https://basescan.org/tx/0x9cf521aa0c13b8f2c7a4c0b8dc2233f744b53998f97509cd62f2e378c877c3fd
          31865972, // https://basescan.org/tx/0x2f2de90c92437bbf03a91636dfa5025737d41ebc3050b47beb3c1a2849e6ab0a
          31866603, // https://basescan.org/tx/0x5cca0c5509baca5bc533ccfdf48bf92cda8b5cc9e396f23d94294b2097a2a2da
          31866618, // https://basescan.org/tx/0x69ace2a65474e636c445db0c900aff821fb6b477e46984fcce9e4107bd00032c
          31866681, // https://basescan.org/tx/0xe641f1caf37d6aa61a3cdc418a3a480d7986c8cbeac528ab7d0295843907a72c
          32976002, // https://basescan.org/tx/0xc6635a42175a00d1e601b51f02ccde0f70c0f95c5bdbc7524d654d2f961fa601
        ],
        ['Withdraw']: [
          32049014, // https://basescan.org/tx/0x45c407059a0b7cf118994d820807b6513308e07d1f5ff09197bd2e4978bafa1d
          32049117, // https://basescan.org/tx/0xc3179a75ae8f9c27e664f010bc54e1568004100359eacc308fcaf15e6f13c8f6
          32049203, // https://basescan.org/tx/0x62ed7bdee657fea3a9917e27fa3eb3acf8f6ff24c3162215218c649d828f8af7
        ],
        ['Swap']: [
          31791775, // https://basescan.org/tx/0xf941f8c6920b5f19fc271d08ad4e2d68cc327ba9023f159a54546e15e8475069
          31791864, // https://basescan.org/tx/0x7ec8a791c293d29dda7aa0e66d9d86e4fd074fcf2bcb6538508f19f4049ee0bc
          31791980, // https://basescan.org/tx/0x90e4aaa1eef2966ad122574b396798107a8fec8d6a951dad381d55a2eb5fe555
          31794557, // https://basescan.org/tx/0x2f43485c6007036c3cef897aa2ea4d21d1faaa91f205bca9abb7c4c6c9360e96
          31802749, // https://basescan.org/tx/0xd3c3a17a0acf3dcc70946e023d86e2fd4b0ea531ace0604e163dc7354507b6fa
          31807516, // https://basescan.org/tx/0x89943b6bdcf9c5fb049dc2015477f95ac660ad291d666b781bacc2356e1da096
          31807662, // https://basescan.org/tx/0x01e05a93ec916b5fbd8b1911b48daafed9dc42d5cef3d2483c38ca5622d6e45d
          31808760, // https://basescan.org/tx/0x62b4441376b4d789ed73974b8e9757a79cf2dc06a94798f58e58f35616075e18
          31808991, // https://basescan.org/tx/0x07b3ccd5cfecb4647cedf1e3347995374189d2912875c1f00e3c52d09e29e6e2
          31810783, // https://basescan.org/tx/0xf66ec138245d2b89f3e2c7c849d03ee7f4e54d9c7535c145d91a50cea719aa35
          31820124, // https://basescan.org/tx/0x70d62c9a14a2d45d11a05216013c399ceed2f5ff1a0b58d72c677579f38b7678
          31820234, // https://basescan.org/tx/0x7fe97f2c9d7a1b4cf051bbed082319b69a8b4f0670e06f0c5fcd6e73b44fe71d
          31820988, // https://basescan.org/tx/0xd6301fa59c4f4ad3124699732ab761234d32d2b6e072277a4e077242f6363ba2
          31821160, // https://basescan.org/tx/0xcc03c33d174c0ef0917e641afdba98715ab7ed652c624e5f5bad0751ebc864dd
          31822717, // https://basescan.org/tx/0x0cef931f415e085b0540b10f6ec317af1cbb2ea0e3f251118fe0ce7739e5f8aa
          31822867, // https://basescan.org/tx/0xd1fd220e92d3c9765b7156663ac14c3e70fde104aae4f4510c64daaebfed97b5
          31823199, // https://basescan.org/tx/0xb40cf9818f2c95f9fdcd15ed849b800baa16ffab182a17e0ccce32b42f28d211
          31823424, // https://basescan.org/tx/0x5365f2967883c5f93d35184675cf4b596a72090046526da479e1047f0a47d5b5
          31825508, // https://basescan.org/tx/0x57fe2b69a3d5f80d7f8c09a9330e11855fb31181c39e0e3575422c61bdb1eef0
        ],
        ['OrderEtched']: [
          31938602, // https://basescan.org/tx/0xb8b3331260f2daf402495fba34fe09eb4dd1583e763d21cd6b3cb9f69eed3cc6
          32058845, // https://basescan.org/tx/0x6a5e384b52edf1b0c54c8a695d162b6612a0e3b6713f74fe38b3c58201dcaacf
          32290240, // https://basescan.org/tx/0xf9362775489f8759ac267b78112b4e925956b01ae912ac39d41cc41859d93cf8
          32290675, // https://basescan.org/tx/0x9bead62d1acdebd2804ec4472812db200fcbbf3fec6feabbbee8e00851ba9a16
          32291066, // https://basescan.org/tx/0xb49bdae7972903e6d16da1e09f3aad8103fd0af4e08d5acdf3d516369896f594
          32295717, // https://basescan.org/tx/0x16dead5df0b6d0120a4830ab03e586db05518b4d2bead79800a3d5017f50d85b
          32303491, // https://basescan.org/tx/0xbf2b0e7ccd349b4ed14c08b14867519e51d45d5e6de23b4c703d8a509ba7e929
          32305433, // https://basescan.org/tx/0x84445050e440f87260a8d68b359a7b01c5297840b6fc2e0c64ed5e8493df5cbc
          32305757, // https://basescan.org/tx/0x965cf5724460851efa7168937423480aff24065faec12f9648b2ddcdff5c364e
          32310887, // https://basescan.org/tx/0x2cd46d39ea0630297351a9a54b943e88cd312533ef668ac8f794f8c51e1cec4e
        ],
        ['OrderFulfilled']: [
          31938604, // https://basescan.org/tx/0xf1a19486859c22acc6314671380080f3c28f658b39ab7eb063f0208db12e4a43
          32058847, // https://basescan.org/tx/0x808c9068897931fa0ac8a6d7f505e5b128a8acfc9940dff13c332303392c986c
          32458100, // https://basescan.org/tx/0x4b89ab02ada6f594ceead8f4956ba6d2279a2fd62ddaa467c12f3ae19196f6f2
          32631163, // https://basescan.org/tx/0x305952b97dd0f81f3c3b18291354b9649960fceb02ab2da0db8d23d23bede883
          32730030, // https://basescan.org/tx/0xa0c03157eee5f88c1b48c8f492c13974f19048432a837ebd21ec3943d18bdef9
          32782122, // https://basescan.org/tx/0x7f185c092176085ca0bcd6f728c0b00cd9ec3dacc15aa0c36c77a88126fc54fa
          32826333, // https://basescan.org/tx/0x0c027607794ff6873442d5e79f7ba36b9e8c5f666c154126defc386abb6f2178
          32876536, // https://basescan.org/tx/0x2cc0eb3dad666bd0c9e9ba8c1b7b43a7a73fdf0145d3dc6a0bad878fc9bf530b
          32990291, // https://basescan.org/tx/0xcf18362d81e758bfded42a4df4ce87e24b3dfab755c1f5755b87ffc674342d49
          33030127, // https://basescan.org/tx/0xcf645997f5fab006af30a0b527b1913efae668e083092f038abb6f9cdb7f9e63
        ],
      };

      const stateCompare = (
        state: ProtocolState,
        expectedState: ProtocolState,
      ) => {
        const poolState = state.poolStates[poolId];
        const expectedPoolState = expectedState.poolStates[poolId];
        poolState
          ? compareState(poolState, expectedPoolState)
          : expect(poolState).toEqual(expectedPoolState);
      };

      Object.keys(eventsToTest).forEach((event: string) => {
        eventsToTest[event].forEach(blockNumber => {
          it(`${event}:${blockNumber} - should return correct state`, async function () {
            await testEventSubscriber(
              bunniV2Pool,
              bunniV2Pool.addressesSubscribed,
              (_blockNumber: number) =>
                fetchPoolState(bunniV2Pool, _blockNumber),
              blockNumber,
              `${dexKey}_${poolId}`,
              dexHelper.provider,
              stateCompare,
            );
          });
        });
      });
    });
  });

  describe('ARBITRUM', function () {
    const network = Network.ARBITRUM;
    const dexHelper = new DummyDexHelper(network);
    const logger = dexHelper.getLogger(dexKey);
    let bunniV2Pool: BunniV2EventPool;

    beforeEach(async () => {
      bunniV2Pool = new BunniV2EventPool(dexKey, network, dexHelper, logger);
    });

    describe('USND-USDC: 0x75c55eda2c37c47eaf1db8b500171f72f23dc5b16404e904866a6ad1b3a3e537', function () {
      const poolId =
        '0x75c55eda2c37c47eaf1db8b500171f72f23dc5b16404e904866a6ad1b3a3e537';

      const eventsToTest: { [eventName: string]: number[] } = {
        ['Initialize']: [
          357624216, // https://arbiscan.io/tx/0xfd592c927277d014a78e6acef9ec7be61517415745328e85652804690367253a
        ],
        ['Deposit']: [
          357625271, // https://arbiscan.io/tx/0x3bf30833706b5dd23e050275fa01a3882d45637725479f94847e1490d8ca705e
          357658192, // https://arbiscan.io/tx/0x600afe0d5e5f7ec65aeaaba9f8de566f2ac0cf074bceba35504b1869890527c3
          357661518, // https://arbiscan.io/tx/0x3f292c9d0ca156e08325d2ae09be84b5a4d8d1b3e22c9dc9db62a9bb8d4ec069
          357692899, // https://arbiscan.io/tx/0x1af759ff3427c4efd9e9d87d8528858d096c7e1ff92e60ff03664ff77c471c77
          357737958, // https://arbiscan.io/tx/0x22f63bc6489c7e4c25cdb1092b800443ee4c8c45eeaa5182e40be9fbb0af632e
        ],
        ['Withdraw']: [
          358206356, // https://arbiscan.io/tx/0xbce42b7000079f554b0872a85598de6295ce59778e98260560f7ab7d719608da
          359031238, // https://arbiscan.io/tx/0xf988a750080574819f9dd965a2748958f51454b510bfa1461b1be201fdccb254
          359525587, // https://arbiscan.io/tx/0xc22089f276910758d30a01b47335d631a8edf47101e97558545e5d6931504133
          359636622, // https://arbiscan.io/tx/0xef9ddaf7149c1a274cddd9ce4eb12ca7050c2c8b1e7cdf2141c4810c36907c79
          359737290, // https://arbiscan.io/tx/0x37955163faee83a143bfeaf200137d78b4d903755774001b0a93b134aadce1d5
        ],
        ['Swap']: [
          357645741, // https://arbiscan.io/tx/0x1af72a1b890063db2eb44c4897742e18cd8c08b4fba137d876a5fd7e3b7e5a7d
          357649785, // https://arbiscan.io/tx/0xafe36eb48dc44fefc816a58118bea53ad51529cd7ffdace633343170d8af4e28
          357656542, // https://arbiscan.io/tx/0x260ce6cc158c2cc29b58175583f247cec7d0624558538167b8c1bfba9e4cc158
          357661308, // https://arbiscan.io/tx/0x1898b6c921c3c7fcfbde3940f7d1f4ece367e44acc209099bc3d92ea8429b5fc
          358642008, // https://arbiscan.io/tx/0x99f914496181485c98e401542a97e741a938445d3c91b7e542bd6d33d66e5f8a
          358923839, // https://arbiscan.io/tx/0xb50dce2785753b8ae23c7ba8b3552bc355fa0ad5cc691903fda0f61cec4f49fe
          359079479, // https://arbiscan.io/tx/0xfef8fa213f13d5dd6486c8c95f6d72b7ce4b4c291fecda28de9fed2d18b55ca6
          359321719, // https://arbiscan.io/tx/0xd109952b2df8912281a52b5a633ead8c6a3797b93b752944f0c1882539e41654
          359636728, // https://arbiscan.io/tx/0x210bcdd0363d23a83a2bc410e5f753f55b966deb8b143118f2681e5cd65a65b6
          360148340, // https://arbiscan.io/tx/0x2ddff66b1d312b82f1cd32904d3fa3bd1fcfbc01bbb58065fc93276cab6ddf4e
        ],
      };

      const stateCompare = (
        state: ProtocolState,
        expectedState: ProtocolState,
      ) => {
        const poolState = state.poolStates[poolId];
        const expectedPoolState = expectedState.poolStates[poolId];
        poolState
          ? compareState(poolState, expectedPoolState)
          : expect(poolState).toEqual(expectedPoolState);
      };

      Object.keys(eventsToTest).forEach((event: string) => {
        eventsToTest[event].forEach(blockNumber => {
          it(`${event}:${blockNumber} - should return correct state`, async function () {
            await testEventSubscriber(
              bunniV2Pool,
              bunniV2Pool.addressesSubscribed,
              (_blockNumber: number) =>
                fetchPoolState(bunniV2Pool, _blockNumber),
              blockNumber,
              `${dexKey}_${poolId}`,
              dexHelper.provider,
              stateCompare,
            );
          });
        });
      });
    });
  });

  describe('UNICHAIN', function () {
    const network = Network.UNICHAIN;
    const dexHelper = new DummyDexHelper(network);
    const logger = dexHelper.getLogger(dexKey);
    let bunniV2Pool: BunniV2EventPool;

    beforeEach(async () => {
      bunniV2Pool = new BunniV2EventPool(dexKey, network, dexHelper, logger);
    });

    describe('ETH-ezETH: 0x10489138471e08ab1b1be7c2130253b18f61a1bfad6ca827199296088c6e90d6', function () {
      const poolId =
        '0x10489138471e08ab1b1be7c2130253b18f61a1bfad6ca827199296088c6e90d6';

      const eventsToTest: { [eventName: string]: number[] } = {
        ['Initialize']: [
          19680593, // https://uniscan.xyz/tx/0xf3e54a02da336a6042f3d38d515d6fd3a604ffe7969c6c726c91d746d9e18a76
        ],
        ['Deposit']: [
          19680757, // https://uniscan.xyz/tx/0x140adaa351d64ba1135458b7c1e704e44d8e3741541a5c18fc9aa1496bdda564
          19757813, // https://uniscan.xyz/tx/0xee101acdef4105f068acb2a005311342d3acaa1b212ffe77f7c7eac6744a1180
          22552887, // https://uniscan.xyz/tx/0x0b9b9f515980a4f59075b8afd965b0321618febcf5eb2f30da1b13edd720e7a1
        ],
        ['Withdraw']: [
          19757851, // https://uniscan.xyz/tx/0xe1a3e29767eb2cee7ea82118f0a1f87c304e8c9d93b3917a5907432600154c0f
          20570400, // https://uniscan.xyz/tx/0xa1a23290cbc34f85ec216034e763ad2ac22cac20498a785811dbf25f861b0b8b
          22037429, // https://uniscan.xyz/tx/0x1f18efbdb44977420279fc5e1d55eb51172df106aed63f1af5899ea3c66c258b
        ],
        ['Swap']: [
          19757773, // https://uniscan.xyz/tx/0x6db89c98a49f3b093b6243ea0b03076738d60fa5cd02e88fd39e29c83297ad58
          20000322, // https://uniscan.xyz/tx/0x6c3ab2c3b863275f35738f3437ada4e61cd183efd315990606cab1ced9bc614c
          20161098, // https://uniscan.xyz/tx/0x221b7616fa8e407090b27c9d85ebe0ed8a8ee52373abf567b6c8f1c5f7311d88
          20300855, // https://uniscan.xyz/tx/0x49686d785c1faf4bcac4bbbe7089d9f53f5a9bdf29205905c40d6f2ecd6613fc
          20444731, // https://uniscan.xyz/tx/0xa34cf4b531799919c2fca3c87ed2bce9b1f90215d545078a53f4adbf6b630f59
          21436795, // https://uniscan.xyz/tx/0x93d6a32b70566cde05453af757e8f910fdef3f9e2b5aafba3141c73e934845eb
        ],
        ['OrderEtched']: [
          21008031, // https://uniscan.xyz/tx/0x438dbd32665166a52967882350b98ac4dbb5466815c5b0ae16e38bae90fb402e
        ],
        ['OrderFulfilled']: [
          21008039, // https://uniscan.xyz/tx/0xfc3322dc91b3225c2ecc4b411bb8dd9216fc58bef58dd9b5b84cd27b5194d692
        ],
      };

      const stateCompare = (
        state: ProtocolState,
        expectedState: ProtocolState,
      ) => {
        const poolState = state.poolStates[poolId];
        const expectedPoolState = expectedState.poolStates[poolId];
        poolState
          ? compareState(poolState, expectedPoolState)
          : expect(poolState).toEqual(expectedPoolState);
      };

      Object.keys(eventsToTest).forEach((event: string) => {
        eventsToTest[event].forEach(blockNumber => {
          it(`${event}:${blockNumber} - should return correct state`, async function () {
            await testEventSubscriber(
              bunniV2Pool,
              bunniV2Pool.addressesSubscribed,
              (_blockNumber: number) =>
                fetchPoolState(bunniV2Pool, _blockNumber),
              blockNumber,
              `${dexKey}_${poolId}`,
              dexHelper.provider,
              stateCompare,
            );
          });
        });
      });
    });

    describe('ETH-weETH: 0x6923777072439713c7b8ab34903e0ea96078d7148449bf54f420320d59ede857', function () {
      const poolId =
        '0x6923777072439713c7b8ab34903e0ea96078d7148449bf54f420320d59ede857';

      const eventsToTest: { [eventName: string]: number[] } = {
        ['Initialize']: [
          22037100, // https://uniscan.xyz/tx/0x604d93cf91df049aa18fdd1dccdd6616cf923b7316c4ebafb671fed0aae17dc7
        ],
        ['Deposit']: [
          22037205, // https://uniscan.xyz/tx/0xfe43b64e00ccf5b34d2809c1dbb4cc63a00d66216f978538457d40f836235df6
          22037638, // https://uniscan.xyz/tx/0xcea4a71d7045853809ca0ca9b7d6f9ec9d61c79162374c84d92f2c4c6100f20d
          22427921, // https://uniscan.xyz/tx/0x8a18dd126a19ca1d0f75198448d8c9f22b00964bd3b98b2f13cf4bdc1b961b4d
          22427991, // https://uniscan.xyz/tx/0xc835b55d97b58e13a87bb9077454e36a9bebd9fa08c02e4b7592349f57bc4f0a
          22430081, // https://uniscan.xyz/tx/0x3b1b177cb045b2eb23bb58e970ed329f0521feee9550b2bdf0d46ee205d7d1ce
          22432213, // https://uniscan.xyz/tx/0xcd399e0e1ae5c6683f6188b54d58d6930e1bd149bc54058b2ba93e3a65def143
          22432527, // https://uniscan.xyz/tx/0x96675983b81f4148fe9575fc12970f933b505a127107c8f8f919a66e1df6778f
          22432889, // https://uniscan.xyz/tx/0x286158f095aca192fe723f8bb176d698239363382034d4eb66bcc6e4f8e4b11e
          22432963, // https://uniscan.xyz/tx/0xb6afe3540216d43f280073476b12eca52fbf54088d99c0d0c2e1c837d479a9fd
        ],
        ['Withdraw']: [
          22442003, // https://uniscan.xyz/tx/0x86fc0a0fac741f2b7b5db551598f7640b75d50251f9328ac34033ec256dc9cb0
          22461768, // https://uniscan.xyz/tx/0x1c23995bd0f4029ab079bfeb8c22734ab824544a125014ca1cce85f4609ea938
          22487188, // https://uniscan.xyz/tx/0x873dba0fdbf48539449f7477e8f5294399f289cf71ee22399704ac5248c2450f
          22493590, // https://uniscan.xyz/tx/0xecd543beff82a9450dfd5ab5c073e874d421afb392fa197bd20ff071aac15576
          22516356, // https://uniscan.xyz/tx/0x19958ae85b5e20f25e7b7ceff7f3ff3bc566ee923e0ba498470d15f4ae7d17b7
          22536056, // https://uniscan.xyz/tx/0xbf08252702c7821263b8d028e24a1b1d68e8adde3a5f58359a3c79a4c8ef1760
          22552712, // https://uniscan.xyz/tx/0x799525bf479af2b794d0024f6ded031af05ec992f69b2bf114fed35564749e84
          22593928, // https://uniscan.xyz/tx/0x741484f5ee3c755648bfb7a834434e2b08d5062d012903c08d837c13a176f2fc
          22616664, // https://uniscan.xyz/tx/0xb15dd0b52f7d960ba694487e247b90ea8aaf5497e3857cb2dcb6652810cfb47a
        ],
        ['Swap']: [
          22059830, // https://uniscan.xyz/tx/0x7c0ea47df4bd890707e302a7d0d60d23285a45a0a25002f34e9b3e288343d289
          22061586, // https://uniscan.xyz/tx/0xe4e5ff88e4549409345e046421213c3396c67210733db8dcb331b35ca1399305
          22067739, // https://uniscan.xyz/tx/0x7fa5b23e4545dfda6cb028dc024bfa71d0656a7c3a634fbed4f140409b1a10f1
          22069200, // https://uniscan.xyz/tx/0xcc20d203a1c652bd6557823676249e289ec554bdf774de820fd17b6e58ddccca
          22070570, // https://uniscan.xyz/tx/0x586011d7142d136870e137f017e9de87fb0ee48f6f1184c41c654592b4d39255
          22073367, // https://uniscan.xyz/tx/0x7ccb94d0ad58f4e4286906c4382447d7c33ea16fa9a25b56f3dc8cdfca96ab89
          22076976, // https://uniscan.xyz/tx/0x7147813660ffc8f3652ded9b04aa453cd347daa15dbda49fbb9dc217f6eeef01
          22077930, // https://uniscan.xyz/tx/0x7d8ae9c4df35dc87803f97d96e5ef648879909582e0879459a6fe0a9ac873515
          22083474, // https://uniscan.xyz/tx/0x632f3ba4ebd2276f3228ccd7916345e92aa78936f140d9b362e52d8a8d8c7dcf
          22084122, // https://uniscan.xyz/tx/0xcf6ac1d7fc0d82237e1eecbafc0b2ee53c96bea36d4e478de5d9dd7c37315750
        ],
      };

      const stateCompare = (
        state: ProtocolState,
        expectedState: ProtocolState,
      ) => {
        const poolState = state.poolStates[poolId];
        const expectedPoolState = expectedState.poolStates[poolId];
        poolState
          ? compareState(poolState, expectedPoolState)
          : expect(poolState).toEqual(expectedPoolState);
      };

      Object.keys(eventsToTest).forEach((event: string) => {
        eventsToTest[event].forEach(blockNumber => {
          it(`${event}:${blockNumber} - should return correct state`, async function () {
            await testEventSubscriber(
              bunniV2Pool,
              bunniV2Pool.addressesSubscribed,
              (_blockNumber: number) =>
                fetchPoolState(bunniV2Pool, _blockNumber),
              blockNumber,
              `${dexKey}_${poolId}`,
              dexHelper.provider,
              stateCompare,
            );
          });
        });
      });
    });

    describe('ETH-USDC: 0x39bd03115d5482eefbf43b1f3f3c48188f32bcb09b43fd4722f4c86d399e282a', function () {
      const poolId =
        '0x39bd03115d5482eefbf43b1f3f3c48188f32bcb09b43fd4722f4c86d399e282a';

      const eventsToTest: { [eventName: string]: number[] } = {
        ['Initialize']: [
          22084078, // https://uniscan.xyz/tx/0x6cb01c29f3ffc912641be8f3a93e70412fec5cec903679cd6894539973001b25
        ],
        ['Deposit']: [
          22084186, // https://uniscan.xyz/tx/0xe8116486bb672e4115aba00fc0329e0f6cd7eb5ab5214fae210be4ac998dde0f
          22084235, // https://uniscan.xyz/tx/0x5c82cb428fde6f5f23fbca8e2382fefc22a27a1335d0f4532473df680e4cbf37
          22084354, // https://uniscan.xyz/tx/0x5161684b38a4faba86dc70189b3c586e856ea8a2635bfb5ac1c61dc4ea60e7f7
          22085574, // https://uniscan.xyz/tx/0x2e61a4c03e2a4f5140839027390408a2c948ae56dca9fe923de96d8c48683d59
          22085843, // https://uniscan.xyz/tx/0xb754e24cc078db4a36649ba8598bcb8d7d559dae5a30297e11dcdbb38dd49a03
          22086239, // https://uniscan.xyz/tx/0xdbbac1c686a13a7f407729893f6fc663bfcc6f9c6730771194594244c19f2ff4
          22086686, // https://uniscan.xyz/tx/0x5f137d0099c0efd46c91e3e9bfa704f4c25ded8b00d2d09e448e1d4bf64f960b
          22086765, // https://uniscan.xyz/tx/0xdaf8b627f11620aff734c22a62bcaf854c3ed79bcbdd54cc241c028e527988bc
        ],
        ['Swap']: [
          22084296, // https://uniscan.xyz/tx/0x9030d10d6ee2a6fc8140cbdb9b5516a079c8a91872c37483dae5d9babc32998a
          22085447, // https://uniscan.xyz/tx/0x9cdfa7bda112de44ddc00ebb8c2428c7310c5778edb10ab0510bd15a80f24452
          22085456, // https://uniscan.xyz/tx/0xeb0a67335632ffa0bd1cf814d6c2ef8242a89830e6fdf5b61244ffb07df1ff9f
          22086362, // https://uniscan.xyz/tx/0x2bf2dc3c8478289ccbed41edafc3d8812f584ea66fac779c0c8a76a7946f7694
          22087174, // https://uniscan.xyz/tx/0xa913fb929b068daac10ba1b48569eb6ae9515fe9cf673bc72093f3b15fc3898f
          22089284, // https://uniscan.xyz/tx/0x86827f47e09d66b028985943eae60ee5fd99e8deedb454c1c25b312dfe29edf7
          22093948, // https://uniscan.xyz/tx/0x3baa454d1075884deff5865dc4e46423052c9460dc839833d34ad279377e41af
          22098010, // https://uniscan.xyz/tx/0x4386f9209ef4e81f797040fd4c555b9bd19a2c90b6319ad2121d062af5803a25
          22103194, // https://uniscan.xyz/tx/0x12b66ce2f0d599073f083974df79f16e386818b38923554dd19ceef7161c9ef9
          22122202, // https://uniscan.xyz/tx/0xa89ba50c56e8776f296ddfac8ba04d48cbb04fdc99f8d98133d735e6e2cc0501
        ],
      };

      const stateCompare = (
        state: ProtocolState,
        expectedState: ProtocolState,
      ) => {
        const poolState = state.poolStates[poolId];
        const expectedPoolState = expectedState.poolStates[poolId];
        poolState
          ? compareState(poolState, expectedPoolState)
          : expect(poolState).toEqual(expectedPoolState);
      };

      Object.keys(eventsToTest).forEach((event: string) => {
        eventsToTest[event].forEach(blockNumber => {
          it(`${event}:${blockNumber} - should return correct state`, async function () {
            await testEventSubscriber(
              bunniV2Pool,
              bunniV2Pool.addressesSubscribed,
              (_blockNumber: number) =>
                fetchPoolState(bunniV2Pool, _blockNumber),
              blockNumber,
              `${dexKey}_${poolId}`,
              dexHelper.provider,
              stateCompare,
            );
          });
        });
      });
    });

    describe('ETH-USDC: 0xe0326777ba1df8f4b5c522b58a669910e78efb1aa5596741dc224b4ac4ac1105', function () {
      const poolId =
        '0xe0326777ba1df8f4b5c522b58a669910e78efb1aa5596741dc224b4ac4ac1105';

      const eventsToTest: { [eventName: string]: number[] } = {
        ['Initialize']: [
          20478771, // https://uniscan.xyz/tx/0xf0d46b372066ecc9ef7bfdc33464d62815130745d132c1ee19916d0e5bf1d76b
        ],
        ['Deposit']: [
          20478940, // https://uniscan.xyz/tx/0xe5cf35faa7b4b8eab567ae16e2258adf85794ef470036447d915a8d718958e99
          21853449, // https://uniscan.xyz/tx/0xe92a033849528f8183f05a586b5bb820ef9955146f5d3117ecb16936ce3306b5
          21891530, // https://uniscan.xyz/tx/0xa02d013499f7fc2af68715ad411daaa571949fdaf2ad7d1b39323dce556c98b1
          21891584, // https://uniscan.xyz/tx/0xfe4825501b0ad1b2ecd6ffb67dd600a074a31839314e036d31f05a5352e1f180
          21904940, // https://uniscan.xyz/tx/0x2005cc2548ecb7bfcc553c52a462e666e7c238562cde98c490e0608456b6fccc
          21990217, // https://uniscan.xyz/tx/0x2a68e679b96f4aae6f1337cc62c232a69d7cf43fcc57aa61a82f38d1f026832f
          21994357, // https://uniscan.xyz/tx/0x7e53a21da7e5e9a3b767e56250962214525a7e7ea9f211320d834f436294de36
        ],
        ['Withdraw']: [
          20932996, // https://uniscan.xyz/tx/0x97444b62c67c0dc3cdb9185eb8d1f704e3be7fa7396a3ee3b1a8e847dcea9333
          21131797, // https://uniscan.xyz/tx/0xfd46fef701e56b3fe148c926c49817a9c00933d36f274d7be0f7139af7151fd6
          21155700, // https://uniscan.xyz/tx/0x765c9b42781deaba2b94c04881f566f7e5316f8c4883729f7151e1f6ccc24248
          21180787, // https://uniscan.xyz/tx/0x9772d364415da1e35dd2cc4f4c20f1f6435183466c960a1a3b16544a0613daf1
          21191971, // https://uniscan.xyz/tx/0xacdb0cf186b78896c9d7a6bcde25a47c6b9de836df39840c8e820813cca87c9c
          21214012, // https://uniscan.xyz/tx/0x08c5a6ae98a5b2442fdf0a51db726934ad2f89183c4e054c73a5eff39da3d49c
          21220535, // https://uniscan.xyz/tx/0xc1a2c96ee585b2e01c110a07f88190ef7aff7a9412f2e920b271a5001411439b
          21241806, // https://uniscan.xyz/tx/0x5c7651a8e90cd6728d79bae431ee66b00739de743df36c12dd0251dd81e88efb
          21312260, // https://uniscan.xyz/tx/0x18ba3847a18f0b4aab2b0d289850fca78f8573f05c6d33b8f8e7bdaae0edad20
          21324755, // https://uniscan.xyz/tx/0xc452326d0fab3d63d745443cde5b483fe8e097cbae7d2459401f0a0b0af3346a
        ],
        ['Swap']: [
          20482709, // https://uniscan.xyz/tx/0xae27f626ad0cdad600c52e27b891d8885ed95291928abb93742302d2cc9acec3
          20482712, // https://uniscan.xyz/tx/0x45b93c5b215ac9089f2a797315ae64300d7b096283ebce4b446ac477a21b4395
          20482722, // https://uniscan.xyz/tx/0x655d7200d6af27564192e9529644652622a191477a7ee87f93be68265cf1487e
          20482723, // https://uniscan.xyz/tx/0x7e501de31ef24f5479721e46b243200c899ea5a252904dd9c2d106a91de28bae
          20482729, // https://uniscan.xyz/tx/0x472db51b3f6438c527af2f67babf1d27499e4e9398a98038743a4ad750354756
          20482732, // https://uniscan.xyz/tx/0x3cc3364f75697084fa981ef02c96eb42f10a71c574939516858e68ffc1cb38ca
          20484616, // https://uniscan.xyz/tx/0x1a0789286fbaf3594a45782fcd1c3901007fb80af4a8c2ef0458b963a6b682e5
          20485313, // https://uniscan.xyz/tx/0x1439050f2dce07e0d8ff8344b68429b60c9fae83e8df0b59344f515b652381bf
          20485522, // https://uniscan.xyz/tx/0xe528c62c2ff1c59b6bae505e60193946cc5404f2337697c7abf061ad6e275a03
          20485548, // https://uniscan.xyz/tx/0xa7c00cf88563c4adfca1f0d5cc698562d3f5272763a332b15d78d123cfb10e6e
        ],
        ['OrderEtched']: [
          20484616, // https://uniscan.xyz/tx/0x1a0789286fbaf3594a45782fcd1c3901007fb80af4a8c2ef0458b963a6b682e5
          20487203, // https://uniscan.xyz/tx/0x2ff01671ba4b413fe230333784b6412b291789803b93125733a8d53bc94c742a
          20487721, // https://uniscan.xyz/tx/0xa8514364dc789fd3f0b2aeef4c4797a2a85f49694f262a7994167767f7e94c3d
          20488287, // https://uniscan.xyz/tx/0x440fb500c02231631a62955adc39b5bb19c7e38d77defaf94bf39431386e7469
          20488932, // https://uniscan.xyz/tx/0x0f14bcee86422cc5c9ac968278149b1a25c9ee94c31bc3c89dcac116b6a90e59
          20489694, // https://uniscan.xyz/tx/0x7798e9a61c7455a98f263d080d8f44e5f8612b1695f195aa67475d7d0c8ed3ba
          20490760, // https://uniscan.xyz/tx/0x487b9444946c4dc7d3c72fc5230df4d0069c85755370b1d597ceb8a5b5e3aa8f
          20495558, // https://uniscan.xyz/tx/0x8cb04758b6e2ffdd71c55ab59834a271266f53a795d27b8dab4257811bdf953e
          20496659, // https://uniscan.xyz/tx/0x9e483cd852930aad4fe0e067cf1424de3554e8181a8fff4d429abbd9b03f6547
          20499352, // https://uniscan.xyz/tx/0xf082911b2b54f9b556e1ef7542d1b3d229ef7c9f9e94b9c9fbd544eb00c592e9
        ],
        ['OrderFulfilled']: [
          20484620, // https://uniscan.xyz/tx/0xc907d93ff0ca48a85277667543195c618ce394d5c307d0da8fd09a718e295459
          20490763, // https://uniscan.xyz/tx/0x66bd63494772d45cf400492347597f92fca6d9ce35fea93d573ac900bc9db0d7
          20503832, // https://uniscan.xyz/tx/0xccfceb8bf6bc685a94af20e0663bd2ab6114d8ce5f7d3373ce3eefe7a855c5b2
          20521236, // https://uniscan.xyz/tx/0x1b9411f99e9e2ce86122aef6cc4f426b5dbe44e14a704c896ff100ee3690a2b1
          20521873, // https://uniscan.xyz/tx/0x64dff54d30d2e4da2dc7bf1ee58b879f9f5ea934fb40d41f40c2070b2318ddec
          20528248, // https://uniscan.xyz/tx/0xe82f46560d730bdb074ceccc8f6bb31cc237a0972118efd955d58c472131f3d9
          20541337, // https://uniscan.xyz/tx/0x260855e576cef8b3c422526a89655173821ed8d1145538568f57c03bd621a764
          20543290, // https://uniscan.xyz/tx/0xe8b81b850c488f5c18a4bc86d8101e7232ff867ecc3cb869c8e0a84b3f7d3934
          20544173, // https://uniscan.xyz/tx/0x5650608e6cb2b90c454ae47a7817a5779b40c3bb95ddf4c66b8e99342044c79f
          20548992, // https://uniscan.xyz/tx/0xcb217c5084062d53726c0cbbe18817d071692788a63c218cb375c75dc7511908
        ],
      };

      const stateCompare = (
        state: ProtocolState,
        expectedState: ProtocolState,
      ) => {
        const poolState = state.poolStates[poolId];
        const expectedPoolState = expectedState.poolStates[poolId];
        poolState
          ? compareState(poolState, expectedPoolState)
          : expect(poolState).toEqual(expectedPoolState);
      };

      Object.keys(eventsToTest).forEach((event: string) => {
        eventsToTest[event].forEach(blockNumber => {
          it(`${event}:${blockNumber} - should return correct state`, async function () {
            await testEventSubscriber(
              bunniV2Pool,
              bunniV2Pool.addressesSubscribed,
              (_blockNumber: number) =>
                fetchPoolState(bunniV2Pool, _blockNumber),
              blockNumber,
              `${dexKey}_${poolId}`,
              dexHelper.provider,
              stateCompare,
            );
          });
        });
      });
    });
  });
});

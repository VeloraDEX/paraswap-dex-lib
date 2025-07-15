/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Network } from '../../constants';
import { UniswapV4Config } from '../uniswap-v4/config';
import { DummyDexHelper } from '../../dex-helper';
import { testEventSubscriber } from '../../../tests/utils-events';
import { UniswapV4PoolManager } from './uniswap-v4-pool-manager';
import { PoolManagerState, PoolState } from './types';
import { UniswapV4Pool } from './uniswap-v4-pool';
import { Contract, ethers } from 'ethers';
import UniswapV4PoolManagerABI from '../../abi/uniswap-v4/pool-manager.abi.json';
import { Log } from 'web3-core';

jest.setTimeout(500 * 1000);
const dexKey = 'UniswapV4';

async function fetchPoolStateFromContract(
  pool: UniswapV4Pool,
  blockNumber: number,
  poolAddress: string,
): Promise<PoolState> {
  const message = `UniswapV4: ${poolAddress} blockNumber ${blockNumber}`;
  console.log(`Fetching state ${message}`);
  // Be careful to not request state prior to contract deployment
  // Otherwise need to use manual state sourcing from multicall
  // We had that mechanism, but removed it with this commit
  // You can restore it, but better just to find block after state multicall
  // deployment
  const state = await pool.generateState(blockNumber);
  console.log('state: ', state);
  console.log(`Done ${message}`);
  return state;
}

// async function fetchPoolManagerStateFromContract(
//   poolManager: UniswapV4PoolManager,
//   blockNumber: number,
//   poolAddress: string,
// ): Promise<PoolManagerState> {
//   const message = `UniswapV4: ${poolAddress} blockNumber ${blockNumber}`;
//   console.log(`Fetching state ${message}`);
//   // Be careful to not request state prior to contract deployment
//   // Otherwise need to use manual state sourcing from multicall
//   // We had that mechanism, but removed it with this commit
//   // You can restore it, but better just to find block after state multicall
//   // deployment
//   const state = await poolManager.generateState(blockNumber);
//   console.log('state: ', state);
//   console.log(`Done ${message}`);
//   return state;
// }

describe('UniswapV4 events', () => {
  describe('Mainnet', () => {
    const network = Network.MAINNET;
    const config = UniswapV4Config[dexKey][network];

    describe('UniswapV4Pool ETH / TITANX (0x8f4abe8df5872097e9f70f8b7141fcf6f42a7a176a35e6f2a998308acf0abd4e)', () => {
      const blockNumbers: { [eventName: string]: number[] } = {
        // ['Donate']: // Donate event was never triggered
        // ['ProtocolFeeUpdated']: // Donate event was never triggered
        ['ModifyLiquidity']: [
          21752580, // https://etherscan.io/tx/0xe589ba9c13d857e3cb513d46d4adc47bb07bc722f1346394ff33f0b0d3239774#eventlog
          21779396, // https://etherscan.io/tx/0x74fca175197dd0dd562f6f3c9a86174122c7b0d0908ca2018b7f599c690998bd#eventlog
          21858734, // https://etherscan.io/tx/0xe242aa2c74bf87a26be0121724b2aebdb92d3e43dffd79d13390b8ea9db85ac2#eventlog
          21896080, // https://etherscan.io/tx/0x057babfb1612827bdcb9d602cbe2dc68845eab4b28aabdded1aed36da7439721#eventlog
          21936463, // https://etherscan.io/tx/0x61a4d0f824783f8488c60680a41668a1b5789f7635b6d4b690dc31330acad3ec#eventlog
          21936548, // https://etherscan.io/tx/0x12b182a4029b1922ff16f1be933c4f98b4adb8d35690a5455311c3f9984bbcbf#eventlog
          21946356, // https://etherscan.io/tx/0x2cebd437deaab46b7bfc5c2bc66e1774041eaf19e662fd722029662bb8678f2a#eventlog
          21952223, // https://etherscan.io/tx/0x1ec6671456e6b63182f8c7d39d1b106dbe9c6a1431bdfd32ce1bac97b9d76d3f#eventlog
          21971475, // https://etherscan.io/tx/0x13d9db5d359e375d0903400b3e4d1236a91bb2ab893192e6d9428073ca896561#eventlog
          21976909, // https://etherscan.io/tx/0xbd67fab1eb6b9ea262d2265ce1f74b80009cecb8e336d4e55a2f6fadf32fa6c4#eventlog
          21976916, // https://etherscan.io/tx/0x4a3466551f596ae4d1a8ae85d4b03ad0fd0aad92c2de887bf3b24fe26a439c14#eventlog
          22084065, // https://etherscan.io/tx/0x8669878222dcd5b43da1a2e53890adb66e18df4d1c70b2bbc4689e5b35c2bf50#eventlog
          22084366, // https://etherscan.io/tx/0x8791aae46a8a38a7a75aec9df7eedf5d013a26490463537f1dfdba9cb9b784dd#eventlog
        ],
        ['Swap']: [
          21768564, // https://etherscan.io/tx/0xc5a568180b54e20ba457832f53a19b1623b8abbe446969fa28890de9661429ce#eventlog
          21768635, // https://etherscan.io/tx/0x7b3aea782a6710caf5d129d7e67d402fe9b94f73d80b8bfc67948ca6a9ed2f10#eventlog
          21771588, // https://etherscan.io/tx/0x04f769d4ef0d14d70900e54917531d469310d13dfe80f587d058363f090e3a5a#eventlog
          21771626, // https://etherscan.io/tx/0x3780ba5e4c2e75f17d40604238aaaca7b778c48b2da2e07d348ae3af3d470475#eventlog
          21773323, // https://etherscan.io/tx/0x54ae99e0d81fa4c6c746fc5f432da1a6cf3ffdfef87c1a35b33d18b3520dfd14#eventlog
          21774365, // https://etherscan.io/tx/0xdc65b4367f2b9ea8a2c59fae51d2bb64dd1f3a3bdc4a8ae27118589c1ceea29d#eventlog
          21775142, // https://etherscan.io/tx/0xffe17b60cb6bf50282480d2aee0fbbd04dd3b2ec503b2abf115c486b1ada4f36#eventlog
          21775682, // https://etherscan.io/tx/0x4cac2f7040d145c0b04ba03c8fd071073189cab3dbc4ab378b18b6f772cca5d5#eventlog
          21776125, // https://etherscan.io/tx/0x93d559cb54daa2bb323f16ed07ec50e8838195ea9ed9fbe78fdaa1173f55e52e#eventlog
          21776131, // https://etherscan.io/tx/0x839b6a1ce4bc7f19dec96868ef59c1774c88fc6698e843c08c0ea09d5d00ea12#eventlog
          21776132, // https://etherscan.io/tx/0x510bc279b57093adc92b9d28230391cd0972e596e2dec25cdf6cb872612a5ce3#eventlog
          21776168, // https://etherscan.io/tx/0x2761f08cf73a377cca6c248acc85e998e3155f5f8b8ace2e4ccd651fcc760d63#eventlog
          21777204, // https://etherscan.io/tx/0x3d8f4dd2d4a9ac8f03929efb3e2c0b697190dd8c27a410922d1c37e7b7b7d76a#eventlog
          21777469, // https://etherscan.io/tx/0x01bfd1136f451361db76340b350acbfa22acaaa3c9a58f660d392ea3b16bdd71#eventlog
          21777804, // https://etherscan.io/tx/0x98b6da140a70de1386f339aa8e486dccd75b0c4e62fabd43cec892e6e871fbae#eventlog
          21779284, // https://etherscan.io/tx/0x91625b97865d817f70cc24b4ce86f9997efd319a5840223b27128cc35ca09079#eventlog
          21858738, // https://etherscan.io/tx/0x4aac0b8b38d9dfc89480e41518265405e60a78cea6962a49790249560e8bbba5#eventlog
          21858872, // https://etherscan.io/tx/0xd318d4486cfd49afe9d3fee54f2857747fe685a9e921c4aa9df794fc161fdd38#eventlog
          21859176, // https://etherscan.io/tx/0x6535f96a6dac9a7353cf7bdafd1ecc9b1abc82cdd37b988c63acfeb823f138e5#eventlog
          21859639, // https://etherscan.io/tx/0x3b2506a09a779f8e9a2330b236d843a7c979f8962751f5fbe161836422978739#eventlog
          21859691, // https://etherscan.io/tx/0x7c186ec989254079c1fd92a444745cf6378eb3a6d31d726ba89ae2ba4ef9f033#eventlog
          21860941, // https://etherscan.io/tx/0xfdbb947c1645d70927885401b0c0d5ce2823b0aeacf185c76ed3714ab7c84e9f#eventlog
          21862001, // https://etherscan.io/tx/0x464f456bc7b38c6b544aa44481560d6a5e17661615098bc96ab1dba597d7b6a9#eventlog
          21862706, // https://etherscan.io/tx/0x66d7808ca65b0eba8fd3b1c617229d728390b4aa07cd8a283fa4482ad14eaa3e#eventlog
          21862782, // https://etherscan.io/tx/0xb206c313365e9f12017750ef0a2a0f929f8fb2bec8cf13a2718e5c2dbb67d437#eventlog
          21863208, // https://etherscan.io/tx/0xa2e876a9fb4cf542bc7187742f538fe469839b5bf4bcd8e901edb2b880dc0fc0#eventlog
          21864617, // https://etherscan.io/tx/0x7333cf48923502816f288d65f12ac73b79cdd388b8b88e5e4ace502631dcad75#eventlog
        ],
      };

      Object.keys(blockNumbers).forEach((event: string) => {
        blockNumbers[event].forEach((blockNumber: number) => {
          it(`${event}:${blockNumber} - should return correct state`, async function () {
            const dexHelper = new DummyDexHelper(network);

            const logger = dexHelper.getLogger(dexKey);

            const uniswapV4Pool = new UniswapV4Pool(
              dexHelper,
              dexKey,
              network,
              config,
              logger,
              '',
              '0x8f4abe8df5872097e9f70f8b7141fcf6f42a7a176a35e6f2a998308acf0abd4e', // initial params from Initialize event
              '0x0000000000000000000000000000000000000000',
              '0xF19308F923582A6f7c465e5CE7a9Dc1BEC6665B1',
              '10000',
              '0x0000000000000000000000000000000000000000',
              7446534289545374680448599517924334n,
              '229030',
              '200',
            );

            await uniswapV4Pool.initialize(blockNumber);

            await testEventSubscriber(
              uniswapV4Pool,
              uniswapV4Pool.addressesSubscribed,
              (_blockNumber: number) =>
                fetchPoolStateFromContract(
                  uniswapV4Pool,
                  _blockNumber,
                  config.poolManager,
                ),
              blockNumber,
              `${dexKey}_${config.poolManager}`,
              dexHelper.provider,
            );
          });
        });
      });
    });

    describe('UniswapV4Pool USDC / WETH (0x4f88f7c99022eace4740c6898f59ce6a2e798a1e64ce54589720b7153eb224a7)', () => {
      const blockNumbers: { [eventName: string]: number[] } = {
        // ['Donate']: // Donate event was never triggered
        // ['ProtocolFeeUpdated']: // Donate event was never triggered
        ['ModifyLiquidity']: [
          21695956, // https://etherscan.io/tx/0x4e63fcc0dd42a2b317e77d17e236cadf77464a08ccece33a354bd8648b5f7419#eventlog
          21696049, // https://etherscan.io/tx/0x7c2414870e533cfe19fa952334d11930ce5d584a746ed852654d6c6eadcc019e#eventlog
          21696148, // https://etherscan.io/tx/0x532d7f26b9fd148d54f1096848c9a447e6f6513ab3bb9c6151267a5c87c5d175#eventlog
          21696208, // https://etherscan.io/tx/0xcaee5112fe4d2e68842ebe42c469822bfe884bac409a670a7572fe911b63560e#eventlog
          21696324, // https://etherscan.io/tx/0x09a586e81feefc5cfaf3dfc3b24bcaa1b362eb52e2dde6820fb1f8bea1504c43#eventlog
          21696326, // https://etherscan.io/tx/0xb72294c5d43e431670a7ddd865e8e708c150fcbed82e9e4bc311bed9eae8c098#eventlog
          21696327, // https://etherscan.io/tx/0x0b95ba21188a6387b8e0e67493ba0a9859da3b454a95ba1175b38502d9b13579#eventlog
          21696345, // https://etherscan.io/tx/0xa963ae09d5003968f6b9659156cbcea0d1032445ee9b0282197a5a383709c2e5#eventlog
          21696356, // https://etherscan.io/tx/0x56b9a3e8243b30bb720b0c6002d4c2421d8bd12fce090721d5ec3c96296d6c2f#eventlog
          21696369, // https://etherscan.io/tx/0x0bc80062d462d8d7d25457888bb6074c2a7c228a2ae45236e9e028796300fbb1#eventlog
          21696509, // https://etherscan.io/tx/0x6c6de87fb0a64b781a3c5cb8dbd0c7c66b978c3505831edf0cb332768de48f8e#eventlog
        ],
        ['Swap']: [
          21696375, // https://etherscan.io/tx/0xa6ec9dabbd0f80bdb2d9d5f1da8006939af385ec83874363b5a85b99dde51164#eventlog
          21696522, // https://etherscan.io/tx/0xd2ab25af0692ce646a920d325b6e53d26b2b2ac0cce788e20362f880ae44c7cc#eventlog
          21696530, // https://etherscan.io/tx/0x966a949326d0b3aba5d41c7e8fda72b585fb5f5eb4378a2ccddb82836df92711#eventlog
          21705269, // https://etherscan.io/tx/0x6f040804ba407caf2d827ed535038d543dbb77776fcf6590b584c4bdde65a9d0#eventlog
          21710994, // https://etherscan.io/tx/0xa9e870ac3228dfbf415f41e5a265200251213a477470cec71acdd45a5dd231ba#eventlog
          21719138, // https://etherscan.io/tx/0xe3d14a7b8ab08b536e449bb1f819cd108dbcc950ee7b1eac8a35941592508b72#eventlog
          21719294, // https://etherscan.io/tx/0x556f4ac648e15b5351f390a15d24877bcc669019ce002b6c4c0972cf3df74cdf#eventlog
          21720097, // https://etherscan.io/tx/0xb347305aab8233da8bd5be52e65b4d0467d94aa062055c99713fed6bdf6c4dfd#eventlog
          21720398, // https://etherscan.io/tx/0x89dc2dc60a66b0213b62b8f401f9b9e330d2dcce7e47fcf86f532a49c0867f92#eventlog
          21720451, // https://etherscan.io/tx/0x6a03f59a18763922d0bdfc05b9acdc74c3d6f5f525eda395c6e35ba845869c66#eventlog
          21727289, // https://etherscan.io/tx/0x24a6bb054064920551d36d32bb6cee9f6add4b1023600f729f032f7353e6d59f#eventlog
          21731500, // https://etherscan.io/tx/0x9576da1e7744612b05069278030a1ad522f254b3258767434ef48c8087d7b3bc#eventlog
          21731542, // https://etherscan.io/tx/0xf9edb3fb82ba6cb13dfb0dbfd12f25b88c7d0f725f39a0ffc5c755422d42a02f#eventlog
          21731547, // https://etherscan.io/tx/0x76836273f74e3e4181fd66b9a9ca3528842bc313aed6d3ec55e71891c456ff13#eventlog
          21731795, // https://etherscan.io/tx/0x9e0a0159dea55457626522e70977a001250cc2e497836386db14b0e3d5ac44cb#eventlog
          21731837, // https://etherscan.io/tx/0x7aba90f092b67a117682a38c1ea7b42d8d66b2ee4d255fc12c7ed99108e9f79a#eventlog
          21732396, // https://etherscan.io/tx/0x1d0feea3e60ac254f331e492907e73476d5d4fd5dc58e2bb39f07ea478455af5#eventlog
          21732624, // https://etherscan.io/tx/0x54039cbda8c389fa3c2f10c3d49457087331c5f1c4b1794da05ac4b0103a2f23#eventlog
          21732659, // https://etherscan.io/tx/0xe0d2ab7ebb56ed4992f7fda3d9ff478b1be5a5736f5a207439f985cd7134237a#eventlog
          21733044, // https://etherscan.io/tx/0x4f7e9f8e63e20d510d29fa7d525f1c2aad62166dc4d5801a1acb3d5c6ce41c42#eventlog
          21733064, // https://etherscan.io/tx/0x021c42c30c7aed4c9fff86936d7f609824cd3f78f2753ceec9f00ea932823ac6#eventlog
          21733215, // https://etherscan.io/tx/0x8b872bde647b7cf1ea20caf809546f59e97da6f457495c26aad3d5f014a35b19#eventlog
          21733424, // https://etherscan.io/tx/0xc2204573bff6bc3491b5ca6b045afc593ad477d21c9f5e601ab8c7b02c7e3118#eventlog
          21733612, // https://etherscan.io/tx/0x4cd00b47b56164b85ed9c477a5a3207e37c1c5fe78247252033bd6d2225dcfde#eventlog
          21733883, // https://etherscan.io/tx/0x2c7989d0276bdc48d013357a997ba92454bab70e51625aee4335ded8280c7892#eventlog
          21733948, // https://etherscan.io/tx/0x259af0ef83e91d2dbf577aa0eb4f245ee4d3de1a54a918dbe63c5f10fb07059b#eventlog
          21733948, // https://etherscan.io/tx/0x259af0ef83e91d2dbf577aa0eb4f245ee4d3de1a54a918dbe63c5f10fb07059b#eventlog
          21734191, // https://etherscan.io/tx/0x50be3c119c6b71b05559b4a64c51dcf1f10428a8dbf71657662a7fd10b6511eb#eventlog
          21734200, // https://etherscan.io/tx/0xbe45ca7bcb29735d6cdb8b912a1177f523b3f94d682a6b28ca4aa24c22ae1fe9#eventlog
          21734369, // https://etherscan.io/tx/0x94a0415714dc4f9c95761ef0a45187eb39e11f93513c268e53432d2285c3d311#eventlog
          21734520, // https://etherscan.io/tx/0x0b1bf03f94eadb3e7861053ebd7459527cb65996520c21708e31d8dee07514ec#eventlog
        ],
      };

      Object.keys(blockNumbers).forEach((event: string) => {
        blockNumbers[event].forEach((blockNumber: number) => {
          it(`${event}:${blockNumber} - should return correct state`, async function () {
            const dexHelper = new DummyDexHelper(network);

            const logger = dexHelper.getLogger(dexKey);

            const uniswapV4Pool = new UniswapV4Pool(
              dexHelper,
              dexKey,
              network,
              config,
              logger,
              '',
              '0x4f88f7c99022eace4740c6898f59ce6a2e798a1e64ce54589720b7153eb224a7', // initial params from Initialize event https://etherscan.io/tx/0x4e63fcc0dd42a2b317e77d17e236cadf77464a08ccece33a354bd8648b5f7419#eventlog
              '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
              '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
              '500',
              '0x0000000000000000000000000000000000000000',
              1379171615076210458510263019585807n,
              '195303',
              '10',
            );

            await uniswapV4Pool.initialize(blockNumber);

            await testEventSubscriber(
              uniswapV4Pool,
              uniswapV4Pool.addressesSubscribed,
              (_blockNumber: number) =>
                fetchPoolStateFromContract(
                  uniswapV4Pool,
                  _blockNumber,
                  config.poolManager,
                ),
              blockNumber,
              `${dexKey}_${config.poolManager}`,
              dexHelper.provider,
            );
          });
        });
      });
    });

    describe('UniSwapV4Pool ETH / USDC (0x21c67e77068de97969ba93d4aab21826d33ca12bb9f565d8496e8fda8a82ca27)', () => {
      const blockNumbers: { [eventName: string]: number[] } = {
        // ['Donate']: // Donate event was never triggered
        // ['ProtocolFeeUpdated']: // Donate event was never triggered
        ['ModifyLiquidity']: [
          22282972, 22284407, 22285669, 22285681, 22285686, 22285689, 22285809,
          22287032, 22287036, 22287753, 22287781, 22288375, 22288419, 22288832,
          22288943, 22289221, 22289488, 22289673,
        ],
        ['Swap']: [
          22287036, 22287042, 22287047, 22287048, 22287056, 22287059, 22287060,
          22287063, 22287065, 22287066, 22287068, 22287074, 22287077, 22287081,
          22287090, 22287092,
        ],
      };

      Object.keys(blockNumbers).forEach((event: string) => {
        blockNumbers[event].forEach((blockNumber: number) => {
          it(`${event}:${blockNumber} - should return correct state`, async function () {
            const dexHelper = new DummyDexHelper(network);

            const logger = dexHelper.getLogger(dexKey);

            const uniswapV4Pool = new UniswapV4Pool(
              dexHelper,
              dexKey,
              network,
              config,
              logger,
              '',
              '0x21c67e77068de97969ba93d4aab21826d33ca12bb9f565d8496e8fda8a82ca27', // initial params from Initialize event
              '0x0000000000000000000000000000000000000000',
              '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
              '500',
              '0x0000000000000000000000000000000000000000',
              1385053131113435054849380000069420n,
              '195388',
              '10',
            );

            await uniswapV4Pool.initialize(blockNumber);

            await testEventSubscriber(
              uniswapV4Pool,
              uniswapV4Pool.addressesSubscribed,
              (_blockNumber: number) =>
                fetchPoolStateFromContract(
                  uniswapV4Pool,
                  _blockNumber,
                  config.poolManager,
                ),
              blockNumber,
              `${dexKey}_${config.poolManager}`,
              dexHelper.provider,
            );
          });
        });
      });
    });

    describe('UniSwapV4Pool WBTC / USDC (0xb98437c7ba28c6590dd4e1cc46aa89eed181f97108e5b6221730d41347bc817f)', () => {
      const blockNumbers: { [eventName: string]: number[] } = {
        // ['Donate']: // Donate event was never triggered
        // ['ProtocolFeeUpdated']: // Donate event was never triggered
        ['ModifyLiquidity']: [
          22293543, 22294142, 22294377, 22294382, 22295286, 22295550,
        ],
        ['Swap']: [
          22293568, 22293710, 22293715, 22293723, 22293727, 22293774, 22293780,
          22294357, 22294358, 22294359, 22295286, 22295391,
        ],
      };

      Object.keys(blockNumbers).forEach((event: string) => {
        blockNumbers[event].forEach((blockNumber: number) => {
          it(`${event}:${blockNumber} - should return correct state`, async function () {
            const dexHelper = new DummyDexHelper(network);

            const logger = dexHelper.getLogger(dexKey);

            const uniswapV4Pool = new UniswapV4Pool(
              dexHelper,
              dexKey,
              network,
              config,
              logger,
              '',
              '0xb98437c7ba28c6590dd4e1cc46aa89eed181f97108e5b6221730d41347bc817f', // initial params from Initialize event
              '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
              '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
              '3000',
              '0x0000000000000000000000000000000000000000',
              0n,
              '68878',
              '60',
            );

            await uniswapV4Pool.initialize(blockNumber);

            await testEventSubscriber(
              uniswapV4Pool,
              uniswapV4Pool.addressesSubscribed,
              (_blockNumber: number) =>
                fetchPoolStateFromContract(
                  uniswapV4Pool,
                  _blockNumber,
                  config.poolManager,
                ),
              blockNumber,
              `${dexKey}_${config.poolManager}`,
              dexHelper.provider,
            );
          });
        });
      });
    });
  });

  describe('Base', () => {
    const network = Network.BASE;
    const config = UniswapV4Config[dexKey][network];

    describe('UniswapV4Pool USDC / cbBTC (0x179492f1f9c7b2e2518a01eda215baab8adf0b02dd3a90fe68059c0cac5686f5)', () => {
      const blockNumbers: { [eventName: string]: number[] } = {
        // ['Donate']: // Donate event was never triggered
        // ['ProtocolFeeUpdated']: // Donate event was never triggered
        ['ModifyLiquidity']: [
          28769672, // https://basescan.org/tx/0xcf89ac69b362322e72e66f367deb7fd70e443c75a670ee6d776dbd66d31ce02b#eventlog
          28772018, // https://basescan.org/tx/0xb6074302a632141f286540d6fac95d102f6641ae5c2ef4b18535e8a1d6fcc37c#eventlog
          28772093, // https://basescan.org/tx/0x6a2ab3f6a2e45c7ea65082a81bd5cd35472b8727a3e5e0693ea5a24988bc94e0#eventlog
          28773278, // https://basescan.org/tx/0x834d5d629f8bd0ac537c58e65d9c6afed6553eeddd8478df379d6aa6a8c6c791#eventlog
          28773287, // https://basescan.org/tx/0x989b76384cbc08e84b9de87a2889faafecbfff6c0953c32c19ea9f0fc07c0479#eventlog
          28775737, // https://basescan.org/tx/0x6e32b9edda897793b055c7a84205250e273dfe5f87e8ad181f0cf2ab8beb2aeb#eventlog
          28775760, // https://basescan.org/tx/0xa620ba1f49bf25aaa80af2a5582d377ae9a573984412d9044b4bcfeb9aca9d64#eventlog
          28775904, // https://basescan.org/tx/0x2c275d8e192739a6f3f91469a9f80eb4a22b088883a950d2268f9488916c65c8#eventlog
          28776340, // https://basescan.org/tx/0xc495ceca6a1eedacbb4aa602bd15880e40aa2995c7a7efea7118c56a046410fb#eventlog
          28776956, // https://basescan.org/tx/0xb6666033fe1233f04d399e46ef63f624c1c1dbb64a7dc08f0f6ee178efee6437#eventlog
          28778021, // https://basescan.org/tx/0xf60e94d78edf257ca64b8a9312fa4eb84fd1b4c92dace44f5e7c90dfda4bb0fe#eventlog
          28778140, // https://basescan.org/tx/0x45ff50ec811c46f3c83eae58c9b46d8f32d919dca3b9752fe8352771455cf9c7#eventlog
          28780771, // https://basescan.org/tx/0xe0c071db23f24801813a09d19efdaffcff85c513dde58644accef23ed0cab5af#eventlog
          28782584, // https://basescan.org/tx/0x367b4f01d4858219517cfbf4879f6b883c44be2ebc03c3d31ba6751ac6c0d397#eventlog
          28783799, // https://basescan.org/tx/0x989606fa8a559bdc9a3c95e9d0398945f41bcc1dbe562ce5d17f98a2dabe922d#eventlog
          28784941, // https://basescan.org/tx/0xb114ea24e8cfe42f12c037c8a8abdbc0a9685f471dfcf31104be604b6cad69d0#eventlog
          28786299, // https://basescan.org/tx/0x9ce4aba15f4f5c7814c8724440bf2c39013dea6882a766f2f9a65a556072875a#eventlog
        ],
        ['Swap']: [
          25716446, //  https://basescan.org/tx/0x32c16727adfc86f207d0a0774d81c2d919b00dd74de1d9a8bf942445fa6859c7#eventlog
          25720511, //  https://basescan.org/tx/0xc015fdefa5c802f77c7e35cd90916ebfb119bd2597045434d0ce9d139171a70b#eventlog
          25720820, //  https://basescan.org/tx/0xe4348c4ed28dccfbb5d40444d028fa5a8e3a67baa2c2fb71f205575a2ec2ab74#eventlog
          25728236, //  https://basescan.org/tx/0x77cd1ff402ad10befb399725def83a4fcc2f1c93140f83d51c2f92891ddeb154#eventlog
          25728287, //  https://basescan.org/tx/0xf8d4fea3c2933c3659676c5f37bd6a653fd8ffe096b5192b2adece7909b45ac3#eventlog
          25729604, //  https://basescan.org/tx/0x3e98af5239b1d2247fa6df78e0e88da2ef948784bcb54057f9c6aed9d1d8ae8a#eventlog
          25729612, //  https://basescan.org/tx/0xcf85535217af11546f656f5797d6659fb93c880d88ef973c9870f1b63eb3a927#eventlog
          25729620, //  https://basescan.org/tx/0xaf5bb4e2116be190f967ea8d48abf12669ee9e71a57039708f983c568454bfbb#eventlog
          25729632, //  https://basescan.org/tx/0x2e26515807402af3e09b5fa0e01d4f9f66489037d2e094a4103ae12c76d01313#eventlog
          25729633, //  https://basescan.org/tx/0xad69f7f8d658137809945567d9fba3e44fa008c1ad7e96d38872e310b652dba3#eventlog
          25729719, //  https://basescan.org/tx/0x0785300a97d04d9c375857ab1634625bb43f154fef64585c282706e5b808d1e2#eventlog
          25729804, //  https://basescan.org/tx/0xb2c25484d77ec98bff335a7b758f9686fa55d2b1bf99e5f3229f69646c6ff379#eventlog
          25730288, //  https://basescan.org/tx/0x00a0d93c307a0791e442ca42e8da5c44eda50a4fa583c5d21ea23e2df910a620#eventlog
          25730754, //  https://basescan.org/tx/0x542e6e91a7cc42866c9b818be16b444016e9eb5edb10b5a7495df1ca73c2a983#eventlog
          25733731, //  https://basescan.org/tx/0x173cebf3554356b54b836adfcd19213dfdd74908cad01cf02d094380bd98e738#eventlog
          25734052, //  https://basescan.org/tx/0x0529bf1638ce64fdd51be0e3e043aa3bb3500c6618b1ad4933d021341681f4ad#eventlog
          25734569, //  https://basescan.org/tx/0x8c83ae7aee1ba1023c6ba15edebdbb59321a90bb9d78e7caa53a1e58331343bc#eventlog
          25734691, //  https://basescan.org/tx/0x3df94650247a9468a1e9d0bdc69c41adbd68662bb5f736341a4248679598ac2a#eventlog
          25737094, //  https://basescan.org/tx/0x55c77ecf02f75913f4bcb063eb5ed0c30cae3c88a0e53d7ecda09258d0f71f8f#eventlog
          25738812, //  https://basescan.org/tx/0x54a41e34f39ef4875238668542a49b87406d0e5f40af6d1439bc493519c16127#eventlog
          25739241, //  https://basescan.org/tx/0x9e98932ed1dc91abcdbc726f33a1e0eb8ec05f94ab2e86771fdac90e8839a24d#eventlog
          25740277, //  https://basescan.org/tx/0xbc84f503a38c5d5c1cb5a65d6f8346a582922736d8149151949de97d3762e0cf#eventlog
          25740717, //  https://basescan.org/tx/0x8f009da04b7134a7a91ceb81af8d7071a22264277c13f6d61ce1f45a8ba114f5#eventlog
          25745943, //  https://basescan.org/tx/0xf45669294c214058587fad550c3e4270276c810e98ecd29a3abf55bd007b2cc0#eventlog
          25746062, //  https://basescan.org/tx/0x7a3362293c904f31e785a02cf50ca09dc51aa3d9cc56604aecdac35399f2819f#eventlog
          25746427, //  https://basescan.org/tx/0x1f894e46030bdd221330830281d1098f37cfb82969fe6685fa2ed3718696f6ab#eventlog
          25746545, //  https://basescan.org/tx/0x2670df4dabaf66a294d6c3e885615a8363b33b224e9c31b4cfd10cd734425151#eventlog
          25746591, //  https://basescan.org/tx/0x20fc01f810ef0f27c3c85f7debc634ef8c8e189b964401734c48be42b714a694#eventlog
          25746602, //  https://basescan.org/tx/0x5e3cd2fa8e36e70a764b15db905d2777fab3aa1ff3b6ee691a1b0af9399fb2f4#eventlog
          25751541, //  https://basescan.org/tx/0x5f09495ee389f8506db913597338c1ed73adaa317eb3d4766013c2cc1329984b#eventlog
          25751593, //  https://basescan.org/tx/0xa838dd44e7be33133abefa66069a688d6f4d349a9f63351b6f42543d0d2e6f92#eventlog
        ],
      };

      Object.keys(blockNumbers).forEach((event: string) => {
        blockNumbers[event].forEach((blockNumber: number) => {
          it(`${event}:${blockNumber} - should return correct state`, async function () {
            const dexHelper = new DummyDexHelper(network);

            const logger = dexHelper.getLogger(dexKey);

            const uniswapV4Pool = new UniswapV4Pool(
              dexHelper,
              dexKey,
              network,
              config,
              logger,
              '',
              '0x179492f1f9c7b2e2518a01eda215baab8adf0b02dd3a90fe68059c0cac5686f5', // initial params from Initialize event https://basescan.org/tx/0x22851562a729cf18348d1633c263221aa11795ac5e5871f3eff28a2fa24da104#eventlog
              '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
              '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf',
              '3000',
              '0x0000000000000000000000000000000000000000',
              2462569646102515538650341413n,
              '-69426',
              '60',
            );

            await uniswapV4Pool.initialize(blockNumber);

            await testEventSubscriber(
              uniswapV4Pool,
              uniswapV4Pool.addressesSubscribed,
              (_blockNumber: number) =>
                fetchPoolStateFromContract(
                  uniswapV4Pool,
                  _blockNumber,
                  config.poolManager,
                ),
              blockNumber,
              `${dexKey}_${config.poolManager}`,
              dexHelper.provider,
            );
          });
        });
      });
    });
  });

  describe('Arbitrum', () => {
    const network = Network.ARBITRUM;
    const config = UniswapV4Config[dexKey][network];

    describe('UniswapV4Pool WBTC / USDC (0x70bf44c3a9b6b047bf60e5a05968225dbf3d6a5b9e8a95a73727e48921e889c1)', () => {
      const blockNumbers: { [eventName: string]: number[] } = {
        // ['Donate']: // Donate event was never triggered
        // ['ProtocolFeeUpdated']: // Donate event was never triggered
        ['ModifyLiquidity']: [
          300609996, // https://arbiscan.io/tx/0x6326a3e2c882b8d89d38fcf26f701a0e0ac29dc2f5f1dbe67fee4c42d69ff310#eventlog
          300616500, // https://arbiscan.io/tx/0x3ade08513cfd69d7b5257ce4f71105c3a74654af2dc324b4ba54b5809f4aa9e9#eventlog
          300619476, // https://arbiscan.io/tx/0xbc14ea27b956b884db106f9a5b491c26a9b46a03f29de937a50dd185083795e8#eventlog
          300712544, // https://arbiscan.io/tx/0xf4601e5d49fa092a341621bfe7eb3a8ccf6b51508973b595c449b1faa27d8587#eventlog
          300713444, // https://arbiscan.io/tx/0xd9fb66f7e85b20bae81c602a65e4e5c578d285106f115aa143ce113c20fccbf3#eventlog
          300735876, // https://arbiscan.io/tx/0xf4956aa5791dd07215f16155566abde6457059e9a03b2751e1be284ee4bb24b3#eventlog
          300737264, // https://arbiscan.io/tx/0x73ac8b5985505d21f0f92cb24a0077221185763aa34dc47a9a94e646b37da2e6#eventlog
          300787648, // https://arbiscan.io/tx/0x3ba260c678d7b90124cb1e964558242685e256c95dbf9a0bef44efdaa9c3e476#eventlog
          300812706, // https://arbiscan.io/tx/0x2b49800cc4dfe49ebf38ca34aa44db9304b3083ef3d68baa588091011bcebce0#eventlog
          300817983, // https://arbiscan.io/tx/0xd976d0cad07fbe99e4c84e3d93e524be4412eb9a25264959e3f2f99e83b9481e#eventlog
          300819341, // https://arbiscan.io/tx/0xa1ce2bad0828160fa30d27a194bb14aa3af10a049dd3620f23ad6024232c77e1#eventlog
          300836138, // https://arbiscan.io/tx/0xe9737bce03765af328f37b35e1d2fff074f50c460a70cabc88d77228321f11c9#eventlog
          300836829, // https://arbiscan.io/tx/0x3b3d64de90aa10759da37957c4ffbb25c04c048e229533f3b2a23b61ee67cab2#eventlog
          300855772, // https://arbiscan.io/tx/0xf257ac911c28e2dee415cce729d668de4033b4fb4b4c84dd1cf35bd7522c8ef7#eventlog
          300858777, // https://arbiscan.io/tx/0x0cd0e99335f0f1a325365c4224b47ff93e280cd1130f9ee46f800eb600b3160c#eventlog
          300886621, // https://arbiscan.io/tx/0xd28c71d3d7b8594a58650111c68a4f3580c03bf56164838033a35d958a24a622#eventlog
          301222058, // https://arbiscan.io/tx/0x1e5ee36045dccc99a511066ab17832f0c1ce31972abd0a349bdb8266dee7697e#eventlog
          301226704, // https://arbiscan.io/tx/0xf689f97753b477502eb1147da34224a2af72289b9904c52d483a58f798648605#eventlog
          301250492, // https://arbiscan.io/tx/0xb7d854407f1522f1135823dfdd5926ae68c6a974b0e28b48649fc19b551b4dcf#eventlog
          301267089, // https://arbiscan.io/tx/0x5c0a942ddf1dec7e9133e48593c9209c259d077ed2ff95d80317a970c7475553#eventlog
          301589740, // https://arbiscan.io/tx/0x54b39cb704c25c31015c7dc9751ed4cecfcf832d1699ccefa7b6f388363d9c59#eventlog
          301594939, // https://arbiscan.io/tx/0x88b8e550b677211d804bfbbda7a8f8be0542d819c31ee614f7c8ca4c6abba010#eventlog
          302651250, // https://arbiscan.io/tx/0xbcb1d64d47af7810357f3180c0346aa5c408a711dc8315ef7a035bb54b9d4c95#eventlog
        ],
        ['Swap']: [
          300609999, // https://arbiscan.io/tx/0x701993a23b31e2e3046aca11ad747bc4dac06cdf34aa35b2d7bc0cfcd2bef176#eventlog
          300610971, // https://arbiscan.io/tx/0xdd517a376b9673b1e6d6490bac035d612c1967de5cab997bda4d7e4814568854#eventlog
          300618540, // https://arbiscan.io/tx/0x10fc57046270127d0733f2c13dc46cfa3defd0b1ad620c3d4b946319dd6fcea9#eventlog
          300632123, // https://arbiscan.io/tx/0xb1e652edc424b8c303795c09b7129e8d0ed6d4f59bf1c341a609751fda16969f#eventlog
          300634236, // https://arbiscan.io/tx/0x10b4b1d71835bc1ac978b3bd3b86d51dbc7354a3db78d1b39f550888e82b097a#eventlog
          300667526, // https://arbiscan.io/tx/0x886463a7bc7106167c04fed05ea805611a443cc05e6ba0b65a67ad63b1bc9cd5#eventlog
          300673728, // https://arbiscan.io/tx/0x31fcc0187c2dd7dd4cf46c7fe2c9e169327c6ffe53d38251ebb5c4b6f5e0ca70#eventlog
          300677834, // https://arbiscan.io/tx/0xde7f0b56b645e5cf2d15c3e48e533d60aa28d8404f3052bb2d41d0c76c91cf3f#eventlog
          300680162, // https://arbiscan.io/tx/0xab4a601f99ad2cfd7affe499d522ca684a4942c15bee77882de0d26a8bbc3eb2#eventlog
          300681178, // https://arbiscan.io/tx/0x1af0919fce568864cae86b705b535953c6b255c5a94bdfe24663b109f51838f7#eventlog
          300702430, // https://arbiscan.io/tx/0x75f6699a664397ce4a75caa3b80443e0dc700a808bd50f6e9acbbc1309f102dd#eventlog
          300705314, // https://arbiscan.io/tx/0x93b379e61edf3dc50eeb259a3f30c86886dc21ecc19a42d0ba0ccd291f8806b5#eventlog
          300711580, // https://arbiscan.io/tx/0x6bce12aec59b5ea140c3e7fc0bf36472fe3b22bb08adeea7a773f4ea7ebc4d8f#eventlog
          300713661, // https://arbiscan.io/tx/0x7af2d79085a8ab2a204d26205a97903bae87942d27ad43c98a9f9036fc64c270#eventlog
          300714009, // https://arbiscan.io/tx/0x188b7503cbac73b67cb9792734e2c4fbead17038c83e33dd9f58e6b1fad69249#eventlog
          300715125, // https://arbiscan.io/tx/0x34a0c599993bfd8fd9d2705dbdabb65b926b9d170919fcb846d10ea5f78f8292#eventlog
          300715498, // https://arbiscan.io/tx/0x96ba44b5a1f96d0922620943434ea50cae01977f06c0c580594818ac60f24223#eventlog
          300715572, // https://arbiscan.io/tx/0xcc4d1a2d07e0a654abc7a2dae2a5803ec400671cec9747ae8a1634d129f8efc7#eventlog
          300717181, // https://arbiscan.io/tx/0x9883a66bed9c822ebf89a10206ddb680cee418442c35cc8f746cbaba0e63f221#eventlog
          300730496, // https://arbiscan.io/tx/0x881cd80b118f209af835ed129c16d012fd582fb09e4b7b2e0fa3779378685b14#eventlog
          300747830, // https://arbiscan.io/tx/0xc1c7a7e7e49e341f1a4e2c9af73f0aad5505a410972460c308896f9ab02ae672#eventlog
          300871839, // https://arbiscan.io/tx/0xab21d071c3220f53479446cec04b8a7ebeb28080f9b813b5aaed3d884762a5b5#eventlog
          300872353, // https://arbiscan.io/tx/0x1ef6f42e1be0dd07616d37685fce154a9c54513842d36347ceda133eb70fc10f#eventlog
          300873412, // https://arbiscan.io/tx/0xba6583c72b1c5eab6c9d41be65bf81146414b36850a6355da0740ca0de1b9fbd#eventlog
          300877260, // https://arbiscan.io/tx/0x954c00273e5715ffa7d90103195625d764f0a5cc9da7f6a77078c265039f2d5b#eventlog
          300907163, // https://arbiscan.io/tx/0x488d3dcc6acf1dbba713cc6392f27bbd2e1bd0ce7c02a0f6c596be396f229596#eventlog
          300923819, // https://arbiscan.io/tx/0xafca8b83b29a86df9ef50a437645ee9631666c93ee52e156ea1255fb71fa0e9f#eventlog
          301004076, // https://arbiscan.io/tx/0x5eaf2e5747a9a585075fbb731149580e3d36f42de74643d19e3f50f17dce984c#eventlog
          301037642, // https://arbiscan.io/tx/0x4e6a7ca5e38dd5789e2839c1f071876eb1e5425c43f083b5591a6845af745000#eventlog
          301045881, // https://arbiscan.io/tx/0xd7d73a7d473773c2584cf1a0d3f3c4f3cb8c5ed030d8acb2ae18837d5f6f451d#eventlog
          301164164, // https://arbiscan.io/tx/0xcf4d6e61dc6ec9fb0d94e1d11b174a2113f94cb76281175296564280457c1447#eventlog
          301221780, // https://arbiscan.io/tx/0x5f295631c9b1fdd38563eda6b923fe718a648a5d1c506b43cd415088d9306ded#eventlog
          301223061, // https://arbiscan.io/tx/0x0434ef95a4c1bdfe35851d1e753184a2732610a90aca93b8dd701a3606375a00#eventlog
          301226368, // https://arbiscan.io/tx/0x7e17229dfa87d43853969ad26eb0cb7e4376caea115a4f02d24f6f04b92a8ffe#eventlog
        ],
      };

      Object.keys(blockNumbers).forEach((event: string) => {
        blockNumbers[event].forEach((blockNumber: number) => {
          it(`${event}:${blockNumber} - should return correct state`, async function () {
            const dexHelper = new DummyDexHelper(network);

            const logger = dexHelper.getLogger(dexKey);

            const uniswapV4Pool = new UniswapV4Pool(
              dexHelper,
              dexKey,
              network,
              config,
              logger,
              '',
              '0x70bf44c3a9b6b047bf60e5a05968225dbf3d6a5b9e8a95a73727e48921e889c1', // initial params from Initialize event https://arbiscan.io/tx/0x6326a3e2c882b8d89d38fcf26f701a0e0ac29dc2f5f1dbe67fee4c42d69ff310#eventlog
              '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f',
              '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
              '3000',
              '0x0000000000000000000000000000000000000000',
              2530339182490235575176398027343n,
              '69279',
              '60',
            );

            await uniswapV4Pool.initialize(blockNumber);

            await testEventSubscriber(
              uniswapV4Pool,
              uniswapV4Pool.addressesSubscribed,
              (_blockNumber: number) =>
                fetchPoolStateFromContract(
                  uniswapV4Pool,
                  _blockNumber,
                  config.poolManager,
                ),
              blockNumber,
              `${dexKey}_${config.poolManager}`,
              dexHelper.provider,
            );
          });
        });
      });
    });
  });

  describe('Polygon', () => {
    const network = Network.POLYGON;
    const config = UniswapV4Config[dexKey][network];

    describe('UniswapV4Pool USDCe / USDCn (0x357c3b5c70c1ed81cb269796710ba24ab80cbf63ee0f8a21895410918bcc922b)', () => {
      const blockNumbers: { [eventName: string]: number[] } = {
        // ['Donate']: // Donate event was never triggered
        // ['ProtocolFeeUpdated']: // Donate event was never triggered
        ['ModifyLiquidity']: [
          71507938, // https://polygonscan.com/tx/0xb1603c3a3517c88c50cd8fd4a5ab96d24d4fc40898e661d4d9e4397d7f5313da
          71508006, // https://polygonscan.com/tx/0x2fbff86aceddfa578961d702461e564e88c619407f88a0dbf3c32e34a8514240
          71508016, // https://polygonscan.com/tx/0x8110df1620a4a989d7389c1f689c9fb7c411eb622ac8d4e111c660cf7746b5f8
          71512473, // https://polygonscan.com/tx/0x80da9118671533f8a1120cd534d99b452501dc760dcd097a82ea087cf6a28986
        ],
        ['Swap']: [
          71507940, // https://polygonscan.com/tx/0xb2e98c2fd8c6e553d9a1de6b486e0b5bfa0b7bec7105ed8ca03d2b3dea77fa3c
          71507947, // https://polygonscan.com/tx/0x95d3878c5af2bbe4384747e4b572fdb8ebce1c738014c63e1483adcefbbd9a6a
          71507956, // https://polygonscan.com/tx/0xe9d7d7cbf0ec2879ba589de03341c1061decdcf39ceb9e6ba819cc28ab23c41a
          71507956, // https://polygonscan.com/tx/0xe9d7d7cbf0ec2879ba589de03341c1061decdcf39ceb9e6ba819cc28ab23c41a
          71507962, // https://polygonscan.com/tx/0x6898f1116d5738a2d69ca271cd7966813485c9d5c03e18490ec2a78629ec94b0
          71508034, // https://polygonscan.com/tx/0xd1feefa4d3ebf8dee3f9c64c582aec83f5ef2278fc0baa72d6ab959fa47551e4
          71508056, // https://polygonscan.com/tx/0x7d631f12ed3d9f98b0eefe4efe358f2a5bb3b9e997b7c0097286e93712976c37
          71508064, // https://polygonscan.com/tx/0x38989dd4270c1ef8f6c2fcd264f21260269d029a73afa365b4bcc8e4e87eb13b
          71508153, // https://polygonscan.com/tx/0x305d20f9cfcda129194835daef4041d08997226ec9ef53d258e68623feba9f34
          71508209, // https://polygonscan.com/tx/0x8b97afa85e7aa19a900bb839d4e39b18138db71534ef4725c06a701d7f4744d9
          71508237, // https://polygonscan.com/tx/0xbbf03c928f9ce3bfb81bbde6c662c988cd34043adea17429bbd6d3d712375a0f
          71508303, // https://polygonscan.com/tx/0x1897bacebe3b4a8e04c09a8ecc8ffb7e0c76eb8f728f3a8f9025f7422bacb98c
          71508350, // https://polygonscan.com/tx/0x0fe898b669e1f4ff6524a82392bb476f6f1877ac2d6e46080cd799ad3f303f49
          71508351, // https://polygonscan.com/tx/0x1c7d94d72539527318c7a3c6899904b62030a867701ea2f589414acd814d1665
          71508374, // https://polygonscan.com/tx/0xbf7c73a3fd8b1a64f026b04057bb636bec914f3918ee051769a0c0f2ce229a2a
          71508384, // https://polygonscan.com/tx/0xdb12b2b6a32a56d5b9117d857b42da2583822292688f5cfcdbbb680b560c830c
          71508494, // https://polygonscan.com/tx/0xcea6cd10a9d2457fe83f6a0fba7e3595c2e4c791bdedd22b0f5f1fcd12ab4044
          71508521, // https://polygonscan.com/tx/0x3c8c3cfd7ce760a26cc074178312a1e836f0a2caf21991b623942bc5c276e402
          71508526, // https://polygonscan.com/tx/0x3734b906f3c2ff0d183c070744d1f6e5278f0467f5d032aabf9e24a29c93181c
          71508583, // https://polygonscan.com/tx/0x8a146af6d2e3592e14d4c50f03af82d4d407cadad8279d765fba8b786e0f418e
          71508611, // https://polygonscan.com/tx/0x53575b977e3f40c8e654d055070e0b0646a9542769e01683520c6af00a7b6669
          71508619, // https://polygonscan.com/tx/0x5ce137e57fa9c48555a61d20d6213bf07219c1ad068cc7554b3ec1af72ed5c96
          71508703, // https://polygonscan.com/tx/0x86343df3bc58ac1ce3b9d8a3ffd1b7a0d6f6fe88bdfc564371dee8512c31173b
          71508730, // https://polygonscan.com/tx/0x763cd97ebabca6a4f616071e25c6b30eff3a0d15dc9238062799cc1fbfc9b92f
          71508753, // https://polygonscan.com/tx/0x51872bd373dd2ab30e66667354495df6e9998a581bea501917d7961a626deba2
          71508760, // https://polygonscan.com/tx/0x193ee5aefa3e0621aa18ed63a8bfeacb9eb9df4e222b33d62eeb01653b8d65e8
          71508776, // https://polygonscan.com/tx/0x5181d5f6d62d41a36537e5c2b58bae75780df8b65ada824b5194724daa745c92
          71508861, // https://polygonscan.com/tx/0xa7ff01fcd1923ff2e333563fef9963a4cc17507f3074a563e5dd5faf501a22c9
          71508874, // https://polygonscan.com/tx/0x39582a5fba4b166f6471fcbae5a29b74b35ac1bf6c5af2912e5c15f93d761e69
          71508938, // https://polygonscan.com/tx/0x8f56ad7568e15ce3baee81dd5508dcc77efa0d49dc703076ee6e72cf26320f08
          71509046, // https://polygonscan.com/tx/0x6950b448b6afaabae553275eaf5c8b67fc1a0477af7c4c7e4c03019cd6015484
        ],
      };

      Object.keys(blockNumbers).forEach((event: string) => {
        blockNumbers[event].forEach((blockNumber: number) => {
          it(`${event}:${blockNumber} - should return correct state`, async function () {
            const dexHelper = new DummyDexHelper(network);

            const logger = dexHelper.getLogger(dexKey);

            const uniswapV4Pool = new UniswapV4Pool(
              dexHelper,
              dexKey,
              network,
              config,
              logger,
              '',
              '0x357c3b5c70c1ed81cb269796710ba24ab80cbf63ee0f8a21895410918bcc922b', // initial params from Initialize event https://arbiscan.io/tx/0x6326a3e2c882b8d89d38fcf26f701a0e0ac29dc2f5f1dbe67fee4c42d69ff310#eventlog
              '0x2791bca1f2de4661ed88a30c99a7a9449aa84174',
              '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
              '55',
              '0x0000000000000000000000000000000000000000',
              79228162514264337593543950336n,
              '0',
              '1',
            );

            await uniswapV4Pool.initialize(blockNumber);

            await testEventSubscriber(
              uniswapV4Pool,
              uniswapV4Pool.addressesSubscribed,
              (_blockNumber: number) =>
                fetchPoolStateFromContract(
                  uniswapV4Pool,
                  _blockNumber,
                  config.poolManager,
                ),
              blockNumber,
              `${dexKey}_${config.poolManager}`,
              dexHelper.provider,
            );
          });
        });
      });
    });
  });

  describe('Unichain', () => {
    const network = Network.UNICHAIN;
    const config = UniswapV4Config[dexKey][network];

    describe('UniswapV4Pool USDC / ETH (0x3258F413C7A88CDA2FA8709A589D221A80F6574F63DF5A5B6774485D8ACC39D9)', () => {
      const blockNumbers: { [eventName: string]: number[] } = {
        // ['Donate']: // Donate event was never triggered
        // ['ProtocolFeeUpdated']: // Donate event was never triggered
        ['ModifyLiquidity']: [
          19679409, // https://uniscan.xyz/tx/0x3c3509ef0ea75ecdfe86ef9cf4880b6dc117ca0f56fe18f394632226343ccb2a#eventlog
          19679408, // https://uniscan.xyz/tx/0xf84747d8b67f10b83f51785baabfb1c00f7265de74a7223fbaa97ba55d12f6ef#eventlog
          19679407, // https://uniscan.xyz/tx/0x813213dfa30b693b0c6123f538d7d5ca8b586a30b29bb8eb09f0eb460f920fcc#eventlog
          19679406, // https://uniscan.xyz/tx/0x81a4e72ae33dee231d4bf046b51256a190536d817af3e697bc5d4d2b1ac9f7d6#eventlog
          19679401, // https://uniscan.xyz/tx/0x8b36aa3433067e536b4d5752f0f9b1c52bb9d3cd1a95e94a7a9896735d0119a2#eventlog
          19679495, // https://uniscan.xyz/tx/0xc367905a57ba99f29824e16e017d11321c2994d75ba82ded8d7cbcbfc21d1a21#eventlog
          19679493, // https://uniscan.xyz/tx/0x6cc863f285f0d4024371aed29ce13b3df67ace157219b3cfc4321b20d3669be8#eventlog
          19679474, // https://uniscan.xyz/tx/0x06586bc5e7b50bc434a44d0b39210d20aa600040b1364c3a78134696a55afa62#eventlog
          19679469, // https://uniscan.xyz/tx/0x13a93b61b5b0fae402194ab9fccaec1fdf4efd911779128a41ac112c7b39fbcb#eventlog
          19679462, // https://uniscan.xyz/tx/0x5eb065d3774481ac2c992faa52b714946eca32af047c00d796fb3ffb99f6a323#eventlog
        ],
        ['Swap']: [
          19679406, // https://uniscan.xyz/tx/0x2b21ee54d38259940972fd8b538bf3ab3f89e8a7aa81c7f53d2f6b929fdd65e7#eventlog
          19679403, // https://uniscan.xyz/tx/0x8ae69730f1e3eb284c8cd2a216a649987d8adf64229c9cb5d6a432a1b86a4842#eventlog
          19679402, // https://uniscan.xyz/tx/0xfd3d1234261758e82077fdb2b3562acf323e28730c93191815c43aa05db6b1dd#eventlog
          19679401, // https://uniscan.xyz/tx/0x0550387cc82035b703fcb796e4282871a7ec8ccc212c974b233d1e31516a9061#eventlog
          19679400, // https://uniscan.xyz/tx/0x3537325fe6613eed52fb4364d6cca5e960850779604b74bfe56523db3c6684d2#eventlog
          19679494, // https://uniscan.xyz/tx/0x533290b32858ccaee585bec2b6fade47279d2bff7837a3c91219ac74362a7c81#eventlog
          19679481, // https://uniscan.xyz/tx/0x72d345d69edd7d75eee0bc7e8a6316b7a4e9b00e8ccb24f3f047634b42f519b3#eventlog
          19679466, // https://uniscan.xyz/tx/0xdd7f5477772853d5e83916856cfa2383fbccfab1fa97f8e683d87237be240e16#eventlog
          19679464, // https://uniscan.xyz/tx/0x90cc965830976628c2bb34aea5827e3005ca0f249ffc1ea59d0af98c2f038b58#eventlog
          19679463, // https://uniscan.xyz/tx/0xedc8371a89bd9896412e62e856efd2da62e9f4e6d48dd22d1069fb6f30c29aa3#eventlog
        ],
      };

      Object.keys(blockNumbers).forEach((event: string) => {
        blockNumbers[event].forEach((blockNumber: number) => {
          it(`${event}:${blockNumber} - should return correct state`, async function () {
            const dexHelper = new DummyDexHelper(network);

            const logger = dexHelper.getLogger(dexKey);

            const uniswapV4Pool = new UniswapV4Pool(
              dexHelper,
              dexKey,
              network,
              config,
              logger,
              '',
              '0x3258f413c7a88cda2fa8709a589d221a80f6574f63df5a5b6774485d8acc39d9', // initial params from Initialize event https://uniscan.xyz/tx/0xe3a62e7bce32734b1ee15051862e4d379c6f3c9d82c17241d07cfd55e1b7f99a#eventlog
              '0x0000000000000000000000000000000000000000',
              '0x078d782b760474a361dda0af3839290b0ef57ad6',
              '500',
              '0x0000000000000000000000000000000000000000',
              4083811512172838615060060n,
              '-197471',
              '10',
            );

            await uniswapV4Pool.initialize(blockNumber);

            await testEventSubscriber(
              uniswapV4Pool,
              uniswapV4Pool.addressesSubscribed,
              (_blockNumber: number) =>
                fetchPoolStateFromContract(
                  uniswapV4Pool,
                  _blockNumber,
                  config.poolManager,
                ),
              blockNumber,
              `${dexKey}_${config.poolManager}`,
              dexHelper.provider,
            );
          });
        });
      });
    });
  });
});

// describe('UniswapV4PoolManager', () => {
//   Object.keys(blockNumbers).forEach((event: string) => {
//     blockNumbers[event].forEach((blockNumber: number) => {
//       it(`${event}:${blockNumber} - should return correct state`, async function () {
//         const dexHelper = new DummyDexHelper(network);
//
//         const logger = dexHelper.getLogger(dexKey);
//         const uniswapV4PoolManager = new UniswapV4PoolManager(
//           dexHelper,
//           dexKey,
//           network,
//           config,
//           logger,
//         );
//
//         await testEventSubscriber(
//           uniswapV4PoolManager,
//           uniswapV4PoolManager.addressesSubscribed,
//           (_blockNumber: number) =>
//             fetchPoolManagerStateFromContract(
//               uniswapV4PoolManager,
//               _blockNumber,
//               config.poolManager,
//             ),
//           blockNumber,
//           `${dexKey}_${config.poolManager}`,
//           dexHelper.provider,
//         );
//       });
//     });
//   });
// });

/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import _ from 'lodash';
import { DfynV2EventPool } from './dfyn-v2-pool';
import { DfynV2Config } from './config';
import { Network } from '../../constants';
import { DummyDexHelper } from '../../dex-helper/index';
import { testEventSubscriber } from '../../../tests/utils-events';
import { PoolState } from './types';
import { Interface } from '@ethersproject/abi';
import ERC20ABI from '../../abi/erc20.json';
import { AbiItem } from 'web3-utils';
import DfynV2PoolHelper from '../../abi/dfyn-v2/DfynV2PoolHelper.abi.json'

jest.setTimeout(300 * 1000);
const dexKey = 'DfynV2';
const network = Network.POLYGON;
const config = DfynV2Config[dexKey][network];

async function fetchPoolStateFromContract(
  dfynV2Pool: DfynV2EventPool,
  blockNumber: number,
  poolAddress: string,
): Promise<PoolState> {
  const message = `DfynV2Pool: ${poolAddress} blockNumber ${blockNumber}`;
  console.log(`Fetching state ${message}`);
  // Be careful to not request state prior to contract deployment
  // Otherwise need to use manual state sourcing from multicall
  // We had that mechanism, but removed it with this commit
  // You can restore it, but better just to find block after state multicall
  // deployment
  const state = await dfynV2Pool.generateState(blockNumber);
  console.log(`Done ${message}`);
  return state;
}

describe('DfynV2 Event', function () {
  const poolAddress = '0x1a7c22A039dFbD3950F3B5B22aeA098DD25f8e94';
  const poolFeeCode = 1500n;
  const token0 = '0x2791bca1f2de4661ed88a30c99a7a9449aa84174';
  const token1 = '0xC168E40227E4ebD8C1caE80F7a55a4F0e6D66C97';

  const blockNumbers: { [eventName: string]: number[] } = {
    // topic0 - 0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67
    ['Swap']: [
      42615235, 42621603, 42628855,
      42634673, 42658999, 42677402,
      42682290, 42685048, 42728578,
      42743257, 
      42769537, 42771993,
      42775946, 42777439, 42777489,
      42777707, 42778173, 42785077,
      42785567, 42806858, 42808258
    ],
    // // topic0 - 0x0c396cd989a39f4459b5fa1aed6a9a8dcdbc45908acfd67e028cd568da98982c
    // ['Burn']: [
    //   15845483, 15845493, 15845539, 15845573, 15845650, 15845679, 15845680,
    //   15845758, 15845850, 15845865, 15845874, 15845980, 15846159, 15846217,
    //   15846263, 15846279, 15846297, 15846309, 15846351, 15846394, 15846398,
    // ],
    // // topic0 - 0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde
    // ['Mint']: [
    //   15845479, 15845540, 15845624, 15845650, 15845655, 15845679, 15845680,
    //   15845758, 15845814, 15845867, 15845939, 15845946, 15845964, 15845980,
    //   15846000, 15846020, 15846044, 15846138, 15846159, 15846181, 15846217,
    //   15846229, 15846263, 15846279, 15846336, 15846351, 15846405,
    // ],
    // // topic0 - 0x973d8d92bb299f4af6ce49b52a8adb85ae46b9f214c4c4fc06ac77401237b133
    // ['SetFeeProtocol']: [],
    // // topic0 - 0xac49e518f90a358f652e4400164f05a5d8f7e35e7747279bc3a93dbf584e125a
    // // There are some events on blockNumbers: 13125816, 12733621, 12591465
    // // But stateMulticall is not deployed at that time. So I just remove that check
    // // I think it is not important actually
    // ['IncreaseObservationCardinalityNext']: [],
    // ['Collect']: [
    //   16440688, 16440718, 16440799, 16440818, 16440824, 16440834, 16440840,
    //   16440931, 16440955, 16441031, 16441106, 16441124, 16441186, 16441187,
    //   16441202, 16441249,
    // ],
    // ['Flash']: [
    //   16417763, 16419900, 16422564, 16432928, 16434338, 16434528, 16434610,
    //   16437224, 16437229,
    // ],
  };

  describe('DfynV2EventPool', function () {
    Object.keys(blockNumbers).forEach((event: string) => {
      blockNumbers[event].forEach((blockNumber: number) => {
        it(`${event}:${blockNumber} - should return correct state`, async function () {
          
          const dexHelper = new DummyDexHelper(network);
          // await dexHelper.init();

          const logger = dexHelper.getLogger(dexKey);

          const dfynV2Pool = new DfynV2EventPool(
            dexHelper,
            dexKey,
            new dexHelper.web3Provider.eth.Contract(
              DfynV2PoolHelper as AbiItem[],
              config.poolHelper,
            ),
            new Interface(ERC20ABI),
            config.factory,
            token0,
            token1,
            logger,
          );

          // It is done in generateState. But here have to make it manually
          dfynV2Pool.poolAddress = poolAddress.toLowerCase();
          dfynV2Pool.addressesSubscribed[0] = poolAddress;
          await testEventSubscriber(
            dfynV2Pool,
            dfynV2Pool.addressesSubscribed,
            (_blockNumber: number) =>
              fetchPoolStateFromContract(
                dfynV2Pool,
                _blockNumber,
                poolAddress,
              ),
            blockNumber,
            `${dexKey}_${poolAddress}`,
            dexHelper.provider,
          );
        });
      });
    });
  });

  // We had issue with this event. Test to tackle that special case
  // it('Special event case for Mint', async () => {
  //   const _poolAddress =
  //     '0x64750f4098A7F98352f7CD5797f421cEb8D94f64'.toLowerCase();
  //   const _feeCode = 100n;
  //   const _token0 = '0x4200000000000000000000000000000000000006';
  //   const _token1 = '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58';
  //   const blockNumber = 32203881;

  //   const dexHelper = new DummyDexHelper(Network.OPTIMISM);
  //   // await dexHelper.init();

  //   const logger = dexHelper.getLogger(dexKey);

  //   const _config = DfynV2Config[dexKey][Network.OPTIMISM];

  //   const dfynV2Pool = new DfynV2EventPool(
  //     dexHelper,
  //     dexKey,
  //     new dexHelper.web3Provider.eth.Contract(
  //       DfynV2PoolHelper as AbiItem[],
  //       config.poolHelper,
  //     ),
  //     new Interface(ERC20ABI),
  //     _config.factory,
  //     _token0,
  //     _token1,
  //     logger,
  //   );

  //   // It is done in generateState. But here have to make it manually
  //   dfynV2Pool.poolAddress = _poolAddress.toLowerCase();
  //   dfynV2Pool.addressesSubscribed[0] = _poolAddress;

  //   await testEventSubscriber(
  //     dfynV2Pool,
  //     dfynV2Pool.addressesSubscribed,
  //     (_blockNumber: number) =>
  //       fetchPoolStateFromContract(dfynV2Pool, _blockNumber, _poolAddress),
  //     blockNumber,
  //     `${dexKey}_${_poolAddress}`,
  //     dexHelper.provider,
  //   );
  // });
});

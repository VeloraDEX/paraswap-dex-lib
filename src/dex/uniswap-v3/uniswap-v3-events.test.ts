/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import VelodromeSlipstreamMulticallABi from '../../abi/velodrome-slipstream/VelodromeSlipstreamStateMulticall.abi.json';
import _ from 'lodash';
import { UniswapV3EventPool } from './uniswap-v3-pool';
import { UniswapV3Config } from './config';
import { Network } from '../../constants';
import { DummyDexHelper } from '../../dex-helper/index';
import { testEventSubscriber } from '../../../tests/utils-events';
import { PoolState } from './types';
import { Interface } from '@ethersproject/abi';
import ERC20ABI from '../../abi/erc20.json';
import StateMulticallABI from '../../abi/uniswap-v3/UniswapV3StateMulticall.abi.json';
import { AbiItem } from 'web3-utils';
import { decodeStateMultiCallResultWithRelativeBitmaps } from './utils';
import { VelodromeSlipstreamEventPool } from './forks/velodrome-slipstream/velodrome-slipstream-pool';
import { decodeStateMultiCallResultWithRelativeBitmaps as decodeStateMultiCallResultWithRelativeBitmapsForVelodromeSlipstream } from './forks/velodrome-slipstream/utils';

jest.setTimeout(300 * 1000);
// const dexKey = 'UniswapV3';
const dexKey = 'VelodromeSlipstreamNewFactory';

const network = Network.OPTIMISM;
const config = UniswapV3Config[dexKey][network];

async function fetchPoolStateFromContract(
  uniswapV3Pool: UniswapV3EventPool,
  blockNumber: number,
  poolAddress: string,
): Promise<PoolState> {
  const message = `UniswapV3: ${poolAddress} blockNumber ${blockNumber}`;
  console.log(`Fetching state ${message}`);
  // Be careful to not request state prior to contract deployment
  // Otherwise need to use manual state sourcing from multicall
  // We had that mechanism, but removed it with this commit
  // You can restore it, but better just to find block after state multicall
  // deployment
  const state = uniswapV3Pool.generateState(blockNumber);
  console.log(`Done ${message}`);
  return state;
}

describe('UniswapV3 Event', function () {
  const poolAddress = '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640';
  const poolFeeCode = 500n;
  const token0 = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
  const token1 = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';

  const blockNumbers: { [eventName: string]: number[] } = {
    // topic0 - 0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67
    ['Swap']: [
      15846349, 15846351, 15846352, 15846353, 15846355, 15846357, 15846358,
      15846360, 15846360, 15846361, 15846362, 15846364, 15846365, 15846366,
      15846367, 15846368, 15846369, 15846370, 15846372, 15846373, 15846374,
      15846375, 15846376, 15846381, 15846382, 15846383, 15846386, 15846387,
      15846388, 15846390, 15846391, 15846392, 15846393, 15846398, 15846400,
      15846403, 15846405, 15846407, 15846408, 15846411, 15846412, 15846413,
      15846415,
    ],
    // topic0 - 0x0c396cd989a39f4459b5fa1aed6a9a8dcdbc45908acfd67e028cd568da98982c
    ['Burn']: [
      15845483, 15845493, 15845539, 15845573, 15845650, 15845679, 15845680,
      15845758, 15845850, 15845865, 15845874, 15845980, 15846159, 15846217,
      15846263, 15846279, 15846297, 15846309, 15846351, 15846394, 15846398,
    ],
    // topic0 - 0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde
    ['Mint']: [
      15845479, 15845540, 15845624, 15845650, 15845655, 15845679, 15845680,
      15845758, 15845814, 15845867, 15845939, 15845946, 15845964, 15845980,
      15846000, 15846020, 15846044, 15846138, 15846159, 15846181, 15846217,
      15846229, 15846263, 15846279, 15846336, 15846351, 15846405,
    ],
    // topic0 - 0x973d8d92bb299f4af6ce49b52a8adb85ae46b9f214c4c4fc06ac77401237b133
    ['SetFeeProtocol']: [],
    // topic0 - 0xac49e518f90a358f652e4400164f05a5d8f7e35e7747279bc3a93dbf584e125a
    // There are some events on blockNumbers: 13125816, 12733621, 12591465
    // But stateMulticall is not deployed at that time. So I just remove that check
    // I think it is not important actually
    ['IncreaseObservationCardinalityNext']: [],
    ['Collect']: [
      16440688, 16440718, 16440799, 16440818, 16440824, 16440834, 16440840,
      16440931, 16440955, 16441031, 16441106, 16441124, 16441186, 16441187,
      16441202, 16441249,
    ],
    ['Flash']: [
      16417763, 16419900, 16422564, 16432928, 16434338, 16434528, 16434610,
      16437224, 16437229,
    ],
  };

  describe('UniswapV3EventPool', function () {
    Object.keys(blockNumbers).forEach((event: string) => {
      blockNumbers[event].forEach((blockNumber: number) => {
        it(`${event}:${blockNumber} - should return correct state`, async function () {
          const dexHelper = new DummyDexHelper(network);
          // await dexHelper.init();

          const logger = dexHelper.getLogger(dexKey);

          const uniswapV3Pool = new UniswapV3EventPool(
            dexHelper,
            dexKey,
            new dexHelper.web3Provider.eth.Contract(
              StateMulticallABI as AbiItem[],
              config.stateMulticall,
            ),
            decodeStateMultiCallResultWithRelativeBitmaps,
            new Interface(ERC20ABI),
            config.factory,
            poolFeeCode,
            token0,
            token1,
            logger,
            undefined,
            config.initHash,
          );

          // It is done in generateState. But here have to make it manually
          uniswapV3Pool.poolAddress = poolAddress.toLowerCase();
          uniswapV3Pool.addressesSubscribed[0] = poolAddress;

          await testEventSubscriber(
            uniswapV3Pool,
            uniswapV3Pool.addressesSubscribed,
            (_blockNumber: number) =>
              fetchPoolStateFromContract(
                uniswapV3Pool,
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
  it('Special event case for Mint', async () => {
    const _poolAddress =
      '0x64750f4098A7F98352f7CD5797f421cEb8D94f64'.toLowerCase();
    const _feeCode = 100n;
    const _token0 = '0x4200000000000000000000000000000000000006';
    const _token1 = '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58';
    const blockNumber = 32203881;

    const dexHelper = new DummyDexHelper(Network.OPTIMISM);
    // await dexHelper.init();

    const logger = dexHelper.getLogger(dexKey);

    const _config = UniswapV3Config[dexKey][Network.OPTIMISM];

    const uniswapV3Pool = new UniswapV3EventPool(
      dexHelper,
      dexKey,
      new dexHelper.web3Provider.eth.Contract(
        StateMulticallABI as AbiItem[],
        config.stateMulticall,
      ),
      decodeStateMultiCallResultWithRelativeBitmaps,
      new Interface(ERC20ABI),
      _config.factory,
      _feeCode,
      _token0,
      _token1,
      logger,
      undefined,
      config.initHash,
    );

    // It is done in generateState. But here have to make it manually
    uniswapV3Pool.poolAddress = _poolAddress.toLowerCase();
    uniswapV3Pool.addressesSubscribed[0] = _poolAddress;

    await testEventSubscriber(
      uniswapV3Pool,
      uniswapV3Pool.addressesSubscribed,
      (_blockNumber: number) =>
        fetchPoolStateFromContract(uniswapV3Pool, _blockNumber, _poolAddress),
      blockNumber,
      `${dexKey}_${_poolAddress}`,
      dexHelper.provider,
    );
  });

  // We had issue with this event. Test to tackle that special case
  it('VelodromeSlipstreamEventPool', async () => {
    const _poolAddress =
      '0x478946BcD4a5a22b316470F5486fAfb928C0bA25'.toLowerCase();
    const _feeCode = 100n;
    const _token0 = '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85';
    const _token1 = '0x4200000000000000000000000000000000000006';
    const blockNumber = 142136604;
    const tickSpacing = 100n;

    const dexHelper = new DummyDexHelper(Network.OPTIMISM);

    const logger = dexHelper.getLogger(dexKey);

    const _config = UniswapV3Config[dexKey][Network.OPTIMISM];

    const uniswapV3Pool = new VelodromeSlipstreamEventPool(
      dexHelper,
      dexKey,
      new dexHelper.web3Provider.eth.Contract(
        VelodromeSlipstreamMulticallABi as AbiItem[],
        config.stateMulticall,
      ),
      decodeStateMultiCallResultWithRelativeBitmapsForVelodromeSlipstream,
      new Interface(ERC20ABI),
      _config.factory,
      _feeCode,
      _token0,
      _token1,
      logger,
      undefined,
      config.initHash,
      tickSpacing,
    );

    // It is done in generateState. But here have to make it manually
    uniswapV3Pool.poolAddress = _poolAddress.toLowerCase();
    uniswapV3Pool.addressesSubscribed[0] = _poolAddress;

    await testEventSubscriber(
      uniswapV3Pool,
      uniswapV3Pool.addressesSubscribed,
      (_blockNumber: number) =>
        fetchPoolStateFromContract(uniswapV3Pool, _blockNumber, _poolAddress),
      blockNumber,
      `${dexKey}_${_poolAddress}`,
      dexHelper.provider,
    );
  });
});

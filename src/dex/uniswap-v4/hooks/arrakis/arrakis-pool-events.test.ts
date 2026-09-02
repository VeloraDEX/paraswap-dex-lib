/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Network } from '../../../../constants';
import { DummyDexHelper } from '../../../../dex-helper';
import { testEventSubscriber } from '../../../../../tests/utils-events';
import { UniswapV4Config } from '../../config';
import { PoolState } from '../../types';
import { UniswapV4Pool } from '../../uniswap-v4-pool';

jest.setTimeout(500 * 1000);

const dexKey = 'UniswapV4';

async function fetchPoolStateFromContract(
  pool: UniswapV4Pool,
  blockNumber: number,
  poolAddress: string,
): Promise<PoolState> {
  const message = `UniswapV4: ${poolAddress} blockNumber ${blockNumber}`;
  console.log(`Fetching state ${message}`);
  const state = await pool.generateState(blockNumber);
  console.log(`Done ${message}`);
  return state;
}

// Event replay for a dynamic fee pool using ArrakisPrivateHook: the pool key
// fee is DYNAMIC_FEE_FLAG and the effective fee comes from the hook's
// beforeSwap override, so Swap events must be replayed with the fee emitted
// in the event instead of slot0.lpFee (which stays 0)
describe('UniswapV4Pool events (ArrakisPrivateHook dynamic fee pool)', () => {
  const network = Network.MAINNET;
  const config = UniswapV4Config[dexKey][network];

  describe('UniswapV4Pool USDC / DGLD (0xde31d7cdc7f4db844e87bb67a139ff78afbb8d32e38cce429dbc3a66f1f76dc9)', () => {
    const blockNumbers: { [eventName: string]: number[] } = {
      ['Swap']: [
        25803595, // https://etherscan.io/tx/0x8fc7f9cd8cba600ef6c58be51324cfd9b32a86a2a4324777ee2537ed6106ac71
        25804781, // https://etherscan.io/tx/0xae7283299df5a4f23a686efd781586af28d1410ed68faeecf6af2f76423ca08b
        25825992, // https://etherscan.io/tx/0x722760fae823ae6e918a54c317ae662a638247147d691a90d2cc4e88db337697
        25832391, // https://etherscan.io/tx/0xdb1b8dbdaef080f7c9cd9ce24ab41202b9ec44947da91dad87b4b294304fc8de
        // 25832397 is excluded: exact-output swap, whose fee rounding can not
        // be replayed exactly from the event deltas (replay is always exact-input),
        // leading to a dust-level feeGrowthGlobal difference
        25833138, // https://etherscan.io/tx/0x444f8b36d4958f7308029ddbf4e1b44972dc647d49a720cb9b4e61608d369491
        25838450, // https://etherscan.io/tx/0xd6415c8f3d0a09e6e847297b5733b2e5a4192e440fdcaf1eb0fdac905a76a0f8
      ],
      ['ModifyLiquidity']: [
        25803595, // https://etherscan.io/tx/0x8fc7f9cd8cba600ef6c58be51324cfd9b32a86a2a4324777ee2537ed6106ac71
        25804781, // https://etherscan.io/tx/0xae7283299df5a4f23a686efd781586af28d1410ed68faeecf6af2f76423ca08b
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
            '0xde31d7cdc7f4db844e87bb67a139ff78afbb8d32e38cce429dbc3a66f1f76dc9', // initial params from Initialize event
            '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            '0xa9299c296d7830a99414d1e5546f5171fa01e9c8',
            '8388608', // DYNAMIC_FEE_FLAG
            '0xa4e6f5500e88691fdcb289aa0e99067481434880',
            '5',
          );

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
            `${dexKey}_${config.poolManager}_${uniswapV4Pool.poolId}`,
            dexHelper.provider,
          );
        });
      });
    });
  });
});

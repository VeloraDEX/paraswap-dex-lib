import { SwapSide } from '../../constants';
import { IDexHelper } from '../../dex-helper';
import { FRIENDLY_LOCAL_DEADLINE } from '../simple-exchange';
import { Metric } from './metric';
import Web3 from 'web3';

const BASE_NETWORK = 8453;
const POOL = '0x1300cf8460fb60c8112febe63ada84a8dd894d8a';
const RECIPIENT = '0x0000000000000000000000000000000000000001';
const EXECUTOR = '0x0000000000000000000000000000000000000002';
const WETH = '0x4200000000000000000000000000000000000006';
const CBBTC = '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf';

describe('Metric getDexParam', () => {
  it('uses nowTimestampMs option for local deadline', () => {
    const dexHelper = {
      web3Provider: new Web3(),
      config: {
        data: {
          network: BASE_NETWORK,
          augustusAddress: '0x0000000000000000000000000000000000000000',
          augustusV6Address: '0x0000000000000000000000000000000000000000',
        },
      },
    } as unknown as IDexHelper;
    const metric = new Metric(dexHelper);
    const nowTimestampMs = 1_700_000_123_456;

    const dexParam = metric.getDexParam(
      WETH,
      CBBTC,
      '6000000000000000000',
      '1',
      RECIPIENT,
      {
        pool: POOL,
        zeroForOne: true,
      },
      SwapSide.SELL,
      EXECUTOR,
      { nowTimestampMs },
    );

    const decoded = metric.routerInterface.decodeFunctionData(
      'swapExactInput',
      dexParam.exchangeData,
    );

    expect(decoded[6].toString()).toBe(
      String(Math.floor(nowTimestampMs / 1000) + FRIENDLY_LOCAL_DEADLINE),
    );
  });
});

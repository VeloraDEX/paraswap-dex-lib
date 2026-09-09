import { Interface, JsonFragment } from '@ethersproject/abi';
import Web3 from 'web3';
import {
  ETHER_ADDRESS,
  Network,
  NULL_ADDRESS,
  SwapSide,
} from '../../constants';
import PoolABI from '../../abi/lunar-base/pool.json';
import { LunarBase } from './lunar-base';
import { BASE_USDC, LUNAR_BASE_POOL_BASE } from './config';
import { LunarBaseData } from './types';

const recipient = '0x1111111111111111111111111111111111111111';
const poolIface = new Interface(PoolABI as JsonFragment[]);

function buildDex(): LunarBase {
  const dexHelper = {
    web3Provider: new Web3(),
    config: {
      data: {
        network: Network.BASE,
        augustusAddress: '0x59C7C832e96D2568bea6db468C1aAdcbbDa08A52',
        augustusV6Address: '0x6a000f20005980200259b80c5102003040001068',
        wrappedNativeTokenAddress: '0x4200000000000000000000000000000000000006',
      },
    },
    getLogger: () => console,
  };

  return new LunarBase(Network.BASE, 'LunarBase', dexHelper as any);
}

describe('LunarBase calldata', () => {
  it('encodes native ETH -> USDC through swapExactInNative', () => {
    const dex = buildDex();
    const data: LunarBaseData = {
      pool: LUNAR_BASE_POOL_BASE,
      tokenIn: NULL_ADDRESS,
      tokenOut: BASE_USDC,
      isXToY: true,
    };

    const param = dex.getDexParam(
      ETHER_ADDRESS,
      BASE_USDC,
      '10000000000000000',
      '20000000',
      recipient,
      data,
      SwapSide.SELL,
    );

    const decoded = poolIface.decodeFunctionData(
      'swapExactInNative',
      param.exchangeData,
    );

    expect(param.targetExchange).toBe(LUNAR_BASE_POOL_BASE);
    expect(param.spender).toBeUndefined();
    expect(param.swappedAmountNotPresentInExchangeData).toBe(true);
    expect(decoded.tokenOut.toLowerCase()).toBe(BASE_USDC);
    expect(decoded.recipient.toLowerCase()).toBe(recipient);
    expect(decoded.amountOutMinimum.toString()).toBe('20000000');
  });

  it('encodes USDC -> ETH through swapExactIn with pool as spender', () => {
    const dex = buildDex();
    const data: LunarBaseData = {
      pool: LUNAR_BASE_POOL_BASE,
      tokenIn: BASE_USDC,
      tokenOut: NULL_ADDRESS,
      isXToY: false,
    };

    const param = dex.getDexParam(
      BASE_USDC,
      ETHER_ADDRESS,
      '20000000',
      '10000000000000000',
      recipient,
      data,
      SwapSide.SELL,
    );

    const decoded = poolIface.decodeFunctionData(
      'swapExactIn',
      param.exchangeData,
    );
    const exactInput = decoded.params;

    expect(param.targetExchange).toBe(LUNAR_BASE_POOL_BASE);
    expect(param.spender).toBe(LUNAR_BASE_POOL_BASE);
    expect(exactInput.tokenIn.toLowerCase()).toBe(BASE_USDC);
    expect(exactInput.tokenOut.toLowerCase()).toBe(NULL_ADDRESS);
    expect(exactInput.recipient.toLowerCase()).toBe(recipient);
    expect(exactInput.amountIn.toString()).toBe('20000000');
    expect(exactInput.amountOutMinimum.toString()).toBe('10000000000000000');
  });
});

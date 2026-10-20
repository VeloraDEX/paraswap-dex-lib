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
import { LunarBaseConfig } from './config';
import { LunarBaseData } from './types';

const recipient = '0x1111111111111111111111111111111111111111';
const executor = '0x2222222222222222222222222222222222222222';
const WETH = '0x4200000000000000000000000000000000000006';
const poolIface = new Interface(PoolABI as JsonFragment[]);

const ethPool = LunarBaseConfig.LunarBase[Network.BASE].pools[0];
const USDC = ethPool.tokenY.address;

function buildDex(): LunarBase {
  const dexHelper = {
    web3Provider: new Web3(),
    config: {
      data: {
        network: Network.BASE,
        augustusAddress: '0x59C7C832e96D2568bea6db468C1aAdcbbDa08A52',
        augustusV6Address: '0x6a000f20005980200259b80c5102003040001068',
        wrappedNativeTokenAddress: WETH,
        executorsAddresses: {
          Executor01: '0x3D546f0181b78b97c1a3C33CAb23AA443E26EAB4',
          Executor02: '0x30E7Fcd8700D023f9767745395C636142db52108',
          Executor03: '0xa000b020c290d000020aac04026b5306d60050f0',
        },
      },
      isWETH: (token: string) => token.toLowerCase() === WETH,
    },
    getLogger: () => console,
  };

  return new LunarBase(Network.BASE, 'LunarBase', dexHelper as any);
}

const ethToUsdc: LunarBaseData = {
  pool: ethPool.address,
  tokenIn: NULL_ADDRESS,
  tokenOut: USDC,
  isXToY: true,
};

const usdcToEth: LunarBaseData = {
  pool: ethPool.address,
  tokenIn: USDC,
  tokenOut: NULL_ADDRESS,
  isXToY: false,
};

describe('LunarBase calldata', () => {
  it('encodes ETH -> USDC through swapExactInNative', () => {
    const param = buildDex().getDexParam(
      ETHER_ADDRESS,
      USDC,
      '10000000000000000',
      '1',
      recipient,
      ethToUsdc,
      SwapSide.SELL,
      executor,
    );
    const decoded = poolIface.decodeFunctionData(
      'swapExactInNative',
      param.exchangeData,
    );

    expect(param.targetExchange).toBe(ethPool.address);
    expect(param.spender).toBeUndefined();
    expect(param.needWrapNative).toBe(false);
    expect(param.dexFuncHasRecipient).toBe(true);
    expect(param.swappedAmountNotPresentInExchangeData).toBe(true);
    expect(decoded.tokenOut.toLowerCase()).toBe(USDC);
    expect(decoded.recipient.toLowerCase()).toBe(recipient);
    expect(decoded.amountOutMinimum.toString()).toBe('1');
  });

  it('encodes WETH -> USDC as a native swap the executor unwraps for', () => {
    const param = buildDex().getDexParam(
      WETH,
      USDC,
      '10000000000000000',
      '1',
      recipient,
      ethToUsdc,
      SwapSide.SELL,
      executor,
    );

    expect(param.needUnwrapNative).toBe(true);
    expect(param.dexFuncHasRecipient).toBe(true);
    expect(
      poolIface.decodeFunctionData('swapExactInNative', param.exchangeData)
        .recipient,
    ).toBe(recipient);
  });

  it('encodes USDC -> ETH through swapExactIn with the pool as spender', () => {
    const param = buildDex().getDexParam(
      USDC,
      ETHER_ADDRESS,
      '20000000',
      '1',
      recipient,
      usdcToEth,
      SwapSide.SELL,
      executor,
    );
    const { params } = poolIface.decodeFunctionData(
      'swapExactIn',
      param.exchangeData,
    );

    expect(param.spender).toBe(ethPool.address);
    expect(param.dexFuncHasRecipient).toBe(true);
    expect(params.tokenIn.toLowerCase()).toBe(USDC);
    expect(params.tokenOut.toLowerCase()).toBe(NULL_ADDRESS);
    expect(params.recipient.toLowerCase()).toBe(recipient);
    expect(params.amountIn.toString()).toBe('20000000');
  });

  it('sends the ETH of a USDC -> WETH swap to the executor to wrap', () => {
    const param = buildDex().getDexParam(
      USDC,
      WETH,
      '20000000',
      '1',
      recipient,
      usdcToEth,
      SwapSide.SELL,
      executor,
    );
    const { params } = poolIface.decodeFunctionData(
      'swapExactIn',
      param.exchangeData,
    );

    expect(param.needUnwrapNative).toBe(true);
    expect(param.dexFuncHasRecipient).toBe(false);
    expect(params.recipient.toLowerCase()).toBe(executor);
  });

  it('rejects BUY', () => {
    expect(() =>
      buildDex().getDexParam(
        USDC,
        ETHER_ADDRESS,
        '20000000',
        '1',
        recipient,
        usdcToEth,
        SwapSide.BUY,
        executor,
      ),
    ).toThrow();
  });
});

import { Interface, defaultAbiCoder } from '@ethersproject/abi';
import RouterAbi from '../../abi/uniswap-v4/router.abi.json';
import { NULL_ADDRESS, Network } from '../../constants';
import { BuffetHookConfig, BASE_USDC } from './hooks/buffet/config';
import { swapExactInputCalldata, swapExactOutputCalldata } from './encoder';
import { UniswapV4Data } from './types';

const routerIface = new Interface(RouterAbi);

const WETH = '0x4200000000000000000000000000000000000006';
const DAI = '0x50c5725949a6f0c72e6c4a641f24049a917db0cb';
const RECIPIENT = '0x0000000000000000000000000000000000000001';

const decodeV4SwapActionInput = (calldata: string) => {
  const [, inputs] = routerIface.decodeFunctionData(
    'execute(bytes,bytes[])',
    calldata,
  );
  const [, actionInputs] = defaultAbiCoder.decode(
    ['bytes', 'bytes[]'],
    inputs[0],
  );

  return actionInputs[0];
};

const dataWithHookPath: UniswapV4Data = {
  path: [
    {
      tokenIn: BASE_USDC,
      tokenOut: WETH,
      zeroForOne: true,
      pool: {
        id: BuffetHookConfig[Network.BASE].poolId,
        key: {
          currency0: BASE_USDC,
          currency1: WETH,
          fee: '100',
          tickSpacing: 1,
          hooks: BuffetHookConfig[Network.BASE].hookAddress,
        },
      },
    },
    {
      tokenIn: WETH,
      tokenOut: DAI,
      zeroForOne: true,
      pool: {
        id: '0x0000000000000000000000000000000000000000000000000000000000000002',
        key: {
          currency0: WETH,
          currency1: DAI,
          fee: '500',
          tickSpacing: 10,
          hooks: NULL_ADDRESS,
        },
      },
    },
  ],
};

describe('UniswapV4 encoder', () => {
  it('preserves hook addresses in exact-input multi-hop path keys', () => {
    const actionInput = decodeV4SwapActionInput(
      swapExactInputCalldata(
        BASE_USDC,
        DAI,
        dataWithHookPath,
        100n,
        90n,
        RECIPIENT,
        WETH,
      ),
    );

    const [params] = defaultAbiCoder.decode(
      [
        'tuple(address currencyIn, (address,uint24,int24,address,bytes)[] path, uint128 amountIn, uint128 amountOutMinimum)',
      ],
      actionInput,
    );

    expect(params.path[0][3].toLowerCase()).toBe(
      BuffetHookConfig[Network.BASE].hookAddress,
    );
    expect(params.path[1][3].toLowerCase()).toBe(NULL_ADDRESS);
  });

  it('preserves hook addresses in exact-output multi-hop path keys', () => {
    const actionInput = decodeV4SwapActionInput(
      swapExactOutputCalldata(
        BASE_USDC,
        DAI,
        dataWithHookPath,
        100n,
        90n,
        RECIPIENT,
        WETH,
      ),
    );

    const [params] = defaultAbiCoder.decode(
      [
        'tuple(address currencyOut, (address,uint24,int24,address,bytes)[] path, uint128 amountOut, uint128 amountInMaximum)',
      ],
      actionInput,
    );

    expect(params.path[0][3].toLowerCase()).toBe(
      BuffetHookConfig[Network.BASE].hookAddress,
    );
    expect(params.path[1][3].toLowerCase()).toBe(NULL_ADDRESS);
  });
});

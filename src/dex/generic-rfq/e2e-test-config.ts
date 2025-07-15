import { Network, SwapSide } from '../../constants';

export const testConfig: {
  [network: number]: Array<{
    srcToken: string;
    destToken: string;
    swapSide: SwapSide;
    amount: string;
  }>;
} = {
  [Network.MAINNET]: [
    {
      srcToken: 'USDT',
      destToken: 'USDC',
      amount: '10000',
      swapSide: SwapSide.BUY,
    },
    {
      srcToken: 'USDC',
      destToken: 'USDT',
      amount: '10000',
      swapSide: SwapSide.SELL,
    },
  ],
};

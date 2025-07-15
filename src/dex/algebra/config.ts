import { DexParams } from './types';
import { DexConfigMap, AdapterMappings } from '../../types';
import { Network, SwapSide } from '../../constants';

export const AlgebraConfig: DexConfigMap<DexParams> = {
  QuickSwapV3: {
    [Network.POLYGON]: {
      factory: '0x411b0fAcC3489691f28ad58c47006AF5E3Ab3A28',
      router: '0xf5b509bb0909a69b1c207e495f687a596c168e12',
      quoter: '0xa15f0d7377b2a0c0c10db057f641bed21028fc89',
      initHash:
        '0x6ec6c9c8091d160c0aa74b2b14ba9c1717e95093bd3ac085cee99a49aab294a4',
      chunksCount: 10,
      initRetryFrequency: 10,
      algebraStateMulticall: '0xfb948e6e23eb58ec7320ddb60df9115de07141ec',
      subgraphURL: '5AK9Y4tk27ZWrPKvSAUQmffXWyQvjWqyJ2GNEZUWTirU',
      uniswapMulticall: '0x1F98415757620B543A52E61c46B32eB19261F984',
      deployer: '0x2d98e2fa9da15aa6dc9581ab097ced7af697cb92',
      version: 'v1.1',
    },
    [Network.ZKEVM]: {
      factory: '0x4B9f4d2435Ef65559567e5DbFC1BbB37abC43B57',
      router: '0xF6Ad3CcF71Abb3E12beCf6b3D2a74C963859ADCd',
      quoter: '0x55BeE1bD3Eb9986f6d2d963278de09eE92a3eF1D',
      initHash:
        '0x6ec6c9c8091d160c0aa74b2b14ba9c1717e95093bd3ac085cee99a49aab294a4',
      chunksCount: 3,
      initRetryFrequency: 30,
      algebraStateMulticall: '0xa6bc273A238867dD74F2bBbD5fBbA3c941C939B9',
      subgraphURL: '3L5Y5brtgvzDoAFGaPs63xz27KdviCdzRuY12spLSBGU',
      uniswapMulticall: '0x61530d6E1c7A47BBB3e48e8b8EdF7569DcFeE121',
      deployer: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270',
      version: 'v1.1',
      forceManualStateGenerate: true,
    },
  },
  ZyberSwapV3: {
    [Network.ARBITRUM]: {
      factory: '0x9C2ABD632771b433E5E7507BcaA41cA3b25D8544',
      router: '0xFa58b8024B49836772180f2Df902f231ba712F72',
      quoter: '0xAeD211346Fa2E6A5063b4f273BCf7DDbD0368d62',
      initHash:
        '0x6ec6c9c8091d160c0aa74b2b14ba9c1717e95093bd3ac085cee99a49aab294a4',
      chunksCount: 10,
      initRetryFrequency: 10,
      algebraStateMulticall: '0xcd7C50ba57136b6B461168D1f634E2CffA4c298D',
      subgraphURL: '7ZP9MeeuXno2y9pWR5LzA96UtYuZYWTA4WYZDZR7ghbN',
      uniswapMulticall: '0x1F98415757620B543A52E61c46B32eB19261F984',
      deployer: '0x24e85f5f94c6017d2d87b434394e87df4e4d56e3',
      version: 'v1.1',
    },
    [Network.OPTIMISM]: {
      factory: '0x0C8f7b0cb986b31c67D994fb5c224592A03A4AfD',
      router: '0xEDB4E3E3bB11255fF14C2762C6A6A28F1D3A36f2',
      quoter: '0xf4211E7709D2294Cd10799E41623006dFB0D66aF',
      initHash:
        '0xbce37a54eab2fcd71913a0d40723e04238970e7fc1159bfd58ad5b79531697e7',
      chunksCount: 10,
      initRetryFrequency: 10,
      algebraStateMulticall: '0x30F6B9b6485ff0B67E881f5ac80D3F1c70A4B23d',
      subgraphURL: '3CA9ffebLkS3N2otXaSj8XaDDdspty75upBjKTUS79qY',
      uniswapMulticall: '0x1F98415757620B543A52E61c46B32eB19261F984',
      deployer: '0xc0d4323426c709e8d04b5b130e7f059523464a91',
      // optimism fork uses v1.9-bidirectional-fee (with TickSpacing event and simple `fee` in globalState),
      // not sure why v1.1 is used here
      version: 'v1.1',
    },
  },
  CamelotV3: {
    [Network.ARBITRUM]: {
      factory: '0x1a3c9B1d2F0529D97f2afC5136Cc23e58f1FD35B',
      router: '0x1F721E2E82F6676FCE4eA07A5958cF098D339e18',
      quoter: '0x0Fc73040b26E9bC8514fA028D998E73A254Fa76E',
      initHash:
        '0x6c1bebd370ba84753516bc1393c0d0a6c645856da55f5393ac8ab3d6dbc861d3',
      chunksCount: 10,
      initRetryFrequency: 10,
      algebraStateMulticall: '0x2cB568442a102dF518b3D37CBD0d2884523C940B',
      subgraphURL: '7mPnp1UqmefcCycB8umy4uUkTkFxMoHn1Y7ncBUscePp',
      uniswapMulticall: '0x1F98415757620B543A52E61c46B32eB19261F984',
      deployer: '0x6dd3fb9653b10e806650f107c3b5a0a6ff974f65',
      version: 'v1.9',
      // looks like it isn't used as we override it with dexHelper.config.data.forceRpcFallbackDexs in constructor
      forceRPC: true,
    },
  },
  SwaprV3: {
    [Network.GNOSIS]: {
      factory: '0xA0864cCA6E114013AB0e27cbd5B6f4c8947da766',
      router: '0xfFB643E73f280B97809A8b41f7232AB401a04ee1',
      quoter: '0xcBaD9FDf0D2814659Eb26f600EFDeAF005Eda0F7',
      initHash:
        '0xbce37a54eab2fcd71913a0d40723e04238970e7fc1159bfd58ad5b79531697e7',
      chunksCount: 10,
      initRetryFrequency: 10,
      // AlgebraStateMulticall
      algebraStateMulticall: '0x49C46f7f88110ccA234ef27Cd664510f7bbF5998',
      subgraphURL: 'YwkNWffc8UTH77wDqGWgMShMq1uXdiQsD5wrD5MzKwJ',
      uniswapMulticall: '0x4dfa9a980efE4802E969AC33968E3d6E59B8a19e',
      deployer: '0xC1b576AC6Ec749d5Ace1787bF9Ec6340908ddB47',
      version: 'v1.9-bidirectional-fee',
      forceRPC: true,
    },
  },
};

export const Adapters: Record<number, AdapterMappings> = {
  [Network.POLYGON]: {
    [SwapSide.SELL]: [{ name: 'PolygonAdapter01', index: 13 }],
    [SwapSide.BUY]: [{ name: 'PolygonBuyAdapter', index: 2 }],
  },
  [Network.ZKEVM]: {
    [SwapSide.SELL]: [{ name: 'PolygonZkEvmAdapter01', index: 1 }],
    [SwapSide.BUY]: [{ name: 'PolygonZkEvmBuyAdapter', index: 1 }],
  },
  [Network.ARBITRUM]: {
    [SwapSide.SELL]: [{ name: 'ArbitrumAdapter02', index: 7 }],
    [SwapSide.BUY]: [{ name: 'ArbitrumBuyAdapter', index: 2 }],
  },
  [Network.OPTIMISM]: {
    [SwapSide.SELL]: [{ name: 'OptimismAdapter01', index: 3 }],
    [SwapSide.BUY]: [{ name: 'OptimismBuyAdapter', index: 2 }],
  },
  [Network.BASE]: {
    [SwapSide.SELL]: [{ name: 'BaseAdapter01', index: 10 }],
    [SwapSide.BUY]: [{ name: 'BaseBuyAdapter', index: 6 }],
  },
};

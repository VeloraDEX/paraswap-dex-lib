// Minimal ABIs for the Machima aggregator integration.
// Machima is a Uniswap V3 fork with a tax/anti-sniper layer; pool discovery
// and tick math are inherited from the UniswapV3 base class, so only the
// Machima-specific surfaces are declared here.

// MachimaAggregatorRouter.swap — standard-interface execution entrypoint.
export const AGGREGATOR_ROUTER_ABI: any[] = [
  {
    type: 'function',
    name: 'swap',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMinimum', type: 'uint256' },
      { name: 'recipient', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
];

// MachimaAggregatorQuoter.quote — exact post-tax quote (also applies the XMA
// sell price floor on-chain). Non-view but eth_call-safe (QuoterV2 pattern).
export const AGGREGATOR_QUOTER_ABI: any[] = [
  {
    type: 'function',
    name: 'quote',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'amountIn', type: 'uint256' },
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'taxAmount', type: 'uint256' },
      { name: 'taxBps', type: 'uint16' },
    ],
  },
];

// ClankNow.getTokenTax — per-token tax configuration.
export const CLANK_NOW_ABI: any[] = [
  {
    type: 'function',
    name: 'getTokenTax',
    stateMutability: 'view',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'buyTaxBps', type: 'uint16' },
          { name: 'sellTaxBps', type: 'uint16' },
          { name: 'tradingTaxHandler', type: 'address' },
          { name: 'protocolTaxHandler', type: 'address' },
          { name: 'protocolTaxBpsWeth', type: 'uint16' },
          { name: 'protocolTaxBpsUsdc', type: 'uint16' },
          { name: 'protocolTaxBpsXma', type: 'uint16' },
          { name: 'hasTax', type: 'bool' },
        ],
      },
    ],
  },
];

// MachimaToken.poolDeploymentTime — drives the anti-sniper window.
export const MACHIMA_TOKEN_ABI: any[] = [
  {
    type: 'function',
    name: 'poolDeploymentTime',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
];

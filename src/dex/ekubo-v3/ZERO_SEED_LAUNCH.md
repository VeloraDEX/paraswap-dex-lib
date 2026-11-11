# Zero-seed launch adapter (Robinhood activation pending)

The final deployment is Robinhood chain 4663,
`0x517621Ea1bf51F31826819b118fa4dfEb4D198D2`, from block 106030313, on Core
`0x00000000000014aA86C5d3c41765bb24e11bd701`. The source and local vectors are
[evm-contracts at 1d74ed414a5a91100440b128ef07fbe15acf37a5](https://github.com/EkuboProtocol/evm-contracts/tree/1d74ed414a5a91100440b128ef07fbe15acf37a5),
tree-equivalent to merged main `fac9631e8fad77271f241733177060fc98be3545`.

The pool manager discovers the extension through Core initializations. Before
pricing it reads `getLaunch(poolId)`, Core state/ticks, and the block header at
the requested block, then verifies the hash again. Quotes never use wall-clock
time. Exact input charges a rounded-up fee on actual output; exact output
grosses up actual input. Fees use the calculated asset. Price movement is bounded
by the installed position; skip-ahead is 1. Partial fills are modeled by the pool
and excluded from full-fill pricing through the existing adapter check.

Core's compact-price rounding is enabled for launch quotes without changing the
existing adapters' quote mode. Tests replay all twelve sequential trade vectors
and five independently generated fee-curve digests, both token orders, 18/18 and
18/6 decimals, native-address math, high fees, overflow and exhaustion.
RPC fixtures exercise the real tuple decoder, bytes32 pool ID, block pinning,
reorg and absent-launch failures; discovery tests cover enabled/disabled forwarding
configuration, and transaction-building tests cover SELL/BUY parameter encoding.

## Activation requirements

The repository currently configures Ekubo V3 on Ethereum and Arbitrum, and has no
Robinhood network setup. This change does not claim Robinhood support is live.
Launch discovery stays disabled until `zeroSeedLaunchRouter` is configured for
4663. The router must implement the existing `swapAllowPartialFill` ABI and route
this extension through `Core.forward(extension, abi.encode(poolKey, params))`.
The existing MEVCapture router and the launch-management periphery are not
substitutes. No forwarding-router deployment is supplied by this change.

Provider rollout requires Robinhood network/RPC/Augustus configuration, a verified
forwarding router and allowance/amount-insertion tests through Augustus (SELL and
BUY, native and ERC-20), an indexed Core subgraph, calibrated gas and a pinned
fork comparison of amounts/events/creator-fee ledgers. The current 1,900,000 gas
bound is conservative local-source evidence, not provider-specific calibration.
Until those steps pass, this is source delivery with an explicit network and
execution gap, not a routable integration.

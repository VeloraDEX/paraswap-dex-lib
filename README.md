# ParaSwap DexLib [![CI](https://github.com/paraswap/paraswap-dex-lib/actions/workflows/ci.yaml/badge.svg?branch=master)](https://github.com/paraswap/paraswap-dex-lib/actions/workflows/ci.yaml)

**DexLib** is a library used by ParaSwap backend to integrate with decentralized exchanges. This library enables external DEX developers to integrate their DEX with ParaSwap by creating pull requests to this repository.

## How to add your DEX to ParaSwap

1. Fork [paraswap-dex-lib](https://github.com/paraswap/paraswap-dex-lib) to your organization or personal account.
2. Clone the repository locally and create a branch with appropriate name (eg: `feature/super-dex`)
3. Install the repository dependencies using:

```bash
yarn install
```

4. Initialize the DEX integration. The DEX name should be in `param-case`:

```bash
yarn init-integration <your-dex-name>
```

You can find template code for newly integrated DEX in `src/dex/<your-dex-name>`

5. Complete the template code by filling the functions implementations. Template code is highly documented which should help you build the implementation. You should look into existing DEX implementation in `src/dex/` to understand the interfaces. Please refer below for detailed explanations and good practices.

6. Add `<your-dex-name>` to `Dexes` list in `src/dex/index.ts`

7. Complete the test templates (All files with `src/dex/<your-dex-name>/*.test.ts`). Each DEX implementation should have thorough testing. We have multiple kinds of tests each dex must have. You can refer to [Writing Tests](#writing-testing) for detailed explanation. You can run all the tests using

```bash
yarn test-integration <your-dex-name>
```

8. Create a PR(pull-request) from your feature branch to DexLib master. The PR must contain brief explanation about the DEX background, pricing logic, links to existing documentation, important contract addresses, and anything you think could help us review your code faster.

## DEX Integration Walkthrough (5 Steps)

ParaSwap optimizes price serving through an innovative event-based approach, bypassing the need for frequent fullnode RPC calls by utilizing smart contract events and in-memory state for pricing.
This method, abstracted for ease of implementation, requires DEXs to initially fetch on-chain state, subscribe to updates via events, and use the updated in-memory state for efficient pricing.

Additionally, ParaSwap's main router, known as Augustus, is ingeniously crafted to only necessitate canonical (offchain) hints for navigating swaps across different DEXs. This design enables the seamless execution of sophisticated trading strategies that involve multiple DEXs and various layers of token swaps. This design also means that any liquidity source can be added without any contract change in most of the cases.

### Step 1/5: Initializing your DEX's pools state

Typically, the first step of an integration would be to initialize its pools' state.

This can be done either

- greedily, initialise on starting the backend services, by overriding the `initializePricing` function in your DEX
  or
- lazily, initialise on receiving a first price request involving an asset that your DEX can handle, as part of `getPricesVolume` function

The latter is the most preferred option.

```ts
async initializePricing(blockNumber: number) {
    const poolState = await getOnChainState(
      this.dexHelper.multiContract,
      this.swETHAddress,
      this.swETHInterface,
      blockNumber,
    );

    await this.eventPool.initialize(blockNumber, {
      state: poolState,
    });
}
```

The example above shows how the current state of the [`swETH`](https://etherscan.io/address/0xdda46bf18eeb3e06e2f12975a3a184e40581a72f#code) contract is, in this case the `swETHToEthRate`. The `getOnChainState` call is executing a Multicall contract call to the `swETHAddress` (using the swETH ABI).

```ts
export async function getOnChainState(
  multiContract: Contract,
  poolAddress: string,
  poolInterface: Interface,
  blockNumber: number | 'latest',
): Promise<SWETHPoolState> {
  const data: { returnData: any[] } = await multiContract.methods
    .aggregate([
      {
        target: poolAddress,
        callData: poolInterface.encodeFunctionData('swETHToETHRate', []),
      },
    ])
    .call({}, blockNumber);

  const decodedData = coder.decode(['uint256'], data.returnData[0]);

  const swETHToETHRateFixed = BigInt(decodedData[0].toString());

  return {
    swETHToETHRateFixed,
  };
}
```

When interacting with smart-contracts on any blockchain, you should try to be mindful of the cost of RPC calls, thus, the best approach is to use Multicall. the Multicall contract can be accessed via `this.dexHelper.multiContract` from your DEX.

### Step 2/5: Keeping your DEX's pools state in sync

The `initializePricing` call will take care of setting the initial state of the pool (at the time of the DEX initializing). To ensure correct pricing, you can leverage the Stateful Event Subscriber.

Following the previous example, we can now implement a listener for the `Reprice` event, which is emitted by the `swETH` pool when the `swETH -> ETH` rate changes, which is what our DEX needs to be aware of. To do this, we can override the `processLog` method in the `StatefulEventSubscriber` declared by our DEX. This method is called when an event which the subscriber is listening to is emitted. The state will be modified after the function is called, only if a state is returned. Returning `null` will be ignored and the state will not be altered. In the case where you require RPC calls, you can implement the `StatefulRpcPoller`, however using this may result in undesired charges as doing RPC calls is far more expensive.

```ts
decoder = (log: Log) => this.poolInterface.parseLog(log);

protected processLog(
    state: DeepReadonly<SWETHPoolState>,
    log: Readonly<Log>,
  ): AsyncOrSync<DeepReadonly<SWETHPoolState> | null> {
    const event = this.decoder(log);
    if (event.name === 'Reprice')
      return {
        swETHToETHRateFixed: BigInt(event.args.newSwETHToETHRate),
      };

    return null;
}
```

Some other DEX pools which could come in handy when implementing your own DEX pool listener.

1. [Uniswap V3](https://github.com/paraswap/paraswap-dex-lib/blob/master/src/dex/uniswap-v3/uniswap-v3-pool.ts#L139)
2. [Nerve](https://github.com/paraswap/paraswap-dex-lib/blob/master/src/dex/nerve/nerve-pool.ts#L109)
3. [Curve V1 (Complex)](https://github.com/paraswap/paraswap-dex-lib/blob/master/src/dex/curve-v1/pools/curve-pool.ts#L81) - has multiple pools (eg 3pool, EURSPool, etc).

### Step 3/5: Calculating your DEX's rates for a token pair and specific amount ranges

Now that we can guarantee an up-to-date state of our pool, we need to ensure that we always provide correct pricing and rates when constructing a transaction.

To do this, the best approach is to replicate the contract's behaviour and calculations, any mistake in the number manipulation (mathematical operations, bit shifting, etc) can lead to wrong prices and result in various scenarios, for example:

- If the price difference is positive, it can lead to Paraswap taking the surplus and the gas fees being higher than simulated/expected.
- If the price difference is negative, it can cause transactions to fail or revert.

Given [swETH Contract](https://etherscan.io/address/0x2d3b4bb82bdf0a3593bcf098b5c5b6f7570211a7#code) we can check how it prices the out value to the `deposit` function, and implement the counterpart on our DEX to make sure pricing is correct.

```solidity
uint256 swETHAmount = wrap(msg.value).mul(_ethToSwETHRate()).unwrap();
```

This line is taking the ETH value (`msg.value`) of the `deposit` function and multiplying it to the current `ethToSwETHRate`, since the pool keeps track of the opposite rate (`swETH -> ETH`), we need to reverse this logic.

```ts
getPrice(blockNumber: number, ethAmount: bigint): bigint {
    const state = this.getState(blockNumber);
    if (!state) throw new Error('Cannot compute price');
    const { swETHToETHRateFixed } = state;

    return (ethAmount * BI_POWS[18]) / swETHToETHRateFixed;
  }
```

### Step 4/5: Allow Augustus to swap through your DEX

When a user wants to swap, we need to compute Augustus's calldata, this involves computing the necessary data to swap through your DEX.
Concretely, you need to abi-encode a swap through your DEX for a given placeholder amount and extra metadata about your DEX in order to allow to perform complex swaps.

For instance, let's take the `swell` DEX integration and the `getDexParam` implementation to see how this encoding is achieved. Keep in mind that the following example was stripped down for simplicity.

```ts
getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: SwellData,
    side: SwapSide,
  ): DexExchangeParam {
    const swapData = this.swETHInterface.encodeFunctionData(
      swETHFunctions.deposit,
      [],
    );

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: false,
      exchangeData: swapData,
      targetExchange: this.swETHAddress,
      returnAmountPos: undefined,
    };
 }
```

<details>
<summary>A more advanced getDexParam example.</summary>

```ts
    getDexParam(
        srcToken: Address,
        destToken: Address,
        srcAmount: NumberAsString,
        destAmount: NumberAsString,
        recipient: Address,
        data: WooFiV2Data,
        side: SwapSide,
      ): DexExchangeParam {
        if (side === SwapSide.BUY) throw new Error(`Buy not supported`);

        const _srcToken = srcToken.toLowerCase();
        const _destToken = destToken.toLowerCase();

        const swapData = ifaces.PPV2.encodeFunctionData('swap', [
          _srcToken,
          _destToken,
          srcAmount,
          MIN_CONVERSION_RATE,
          recipient,
          rebateTo,
        ]);

        return {
          needWrapNative: this.needWrapNative,
          dexFuncHasRecipient: true,
          exchangeData: swapData,
          targetExchange: this.config.wooPPV2Address,
          transferSrcTokenBeforeSwap: this.config.wooPPV2Address,
          returnAmountPos:
            side === SwapSide.SELL
              ? extractReturnAmountPosition(ifaces.PPV2, 'swap', 'realToAmount')
              : undefined,
        };
    }

```

</details>

A considerable amount of abstraction is incorporated into the DEX library's upper encoding logic and Augustus to precisely set the swap amount (especially if your DEX follows another swap affected by slippage in any direction). Moreover, it ensures the successful execution of the swap by managing all necessary prerequisites, including token approvals, wrapping/unwrapping of WETH, transfers, and more.

In order to ensure correctness of encoding please make use of these parameters:

- `needWrapNative`: if true, tells if the DEX only deals with wrapped native tokens (eg. on Ethereum it only executes trades with wETH, not native ETH).
- `dexFuncHasRecipient`: if true, tells if the DEX can swap and transfer to an arbitrary address (`recipient`) else we would append a transfer call
- `exchangeData`: the call data required by the DEX, and typically requires targeting the contract's interface to encode data.
- `transferSrcTokenBeforeSwap`: if your DEX requires a transfer before the swap happens, rather than encoding it within the `exchangeData`
- `targetExchange`: the contract against which we swap
- `spender`: a contract that we need to approve in order to swap against `targetExchange`. If not set, then the spender will be `targetExchange`
- `returnAmountPos`: the offset position inside the return values from an external call to a dex where we expect our swap return value (output amount) to be.
  There is a helper function `extractReturnAmountPosition` which could be used to automatically calculate return amount position.
  If the DEX swap function doesn't support outputs then `undefined` should be passed.
  For example:
  1. swap(uint256,uint256) returns (uint256 returnAmount) -> return amount pos will be 0
  2. swap2(uint256,uint256) returns (uint256 timestamp, uint256 returnAmount) -> return amount pos will be 32
  3. swap3(uint256,uint256) -> return amount pos will be undefined

To verify the validity of the encoding, we recommend looking at [this link](#writing-testing) and using Tenderly to validate transactions. If the encoding is done incorrectly at the Interface level, you will see errors in your testing logs.

### Step 5/5: Signal the most liquid tokens of your DEX

When the ParaSwap aggregator is searching for the best connector between two or more tokens, it needs to be able to access this data in a fast and reliable manner.

These data aggregations can be very time-consuming, include undesired data, and for FIAT calculations, result in invalid prices and such mistakes. To do this, certain DEXes implement the `getTopPoolsForToken` method, which calls specific Subgraphs (on The Graph), [eg. Uniswap V2](https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v2) subgraph.

This method will return an array of the following type:

```ts
export type PoolLiquidity = {
  exchange: string;
  address: Address;
  connectorTokens: Token[];
  liquidityUSD: number;
};
```

We can look at the Solidly V3 implementation below, to see how the DEX interacts with a subgraph to compute the `PoolLiquidity[]`.

<details>
<summary>Solidly V3 getTopPoolsForToken</summary>

```ts
    async getTopPoolsForToken(
        tokenAddress: Address,
        limit: number,
      ): Promise<PoolLiquidity[]> {
        const _tokenAddress = tokenAddress.toLowerCase();

        const res = await this._querySubgraph(
          `query ($token: Bytes!, $count: Int) {
                    pools0: pools(first: $count, orderBy: totalValueLockedUSD, orderDirection: desc, where: {token0: $token, liquidity_gt: "0"}) {
                    id
                    token0 {
                      id
                      decimals
                    }
                    token1 {
                      id
                      decimals
                    }
                    totalValueLockedUSD
                  }
                  pools1: pools(first: $count, orderBy: totalValueLockedUSD, orderDirection: desc, where: {token1: $token, liquidity_gt: "0"}) {
                    id
                    token0 {
                      id
                      decimals
                    }
                    token1 {
                      id
                      decimals
                    }
                    totalValueLockedUSD
                  }
                }`,
          {
            token: _tokenAddress,
            count: limit,
          },
        );

        if (!(res && res.pools0 && res.pools1)) {
          this.logger.error(
            `Error_${this.dexKey}_Subgraph: couldn't fetch the pools from the subgraph`,
          );
          return [];
        }

        const pools0 = _.map(res.pools0, pool => ({
          exchange: this.dexKey,
          address: pool.id.toLowerCase(),
          connectorTokens: [
            {
              address: pool.token1.id.toLowerCase(),
              decimals: parseInt(pool.token1.decimals),
            },
          ],
          liquidityUSD:
            parseFloat(pool.totalValueLockedUSD) * UNISWAPV3_EFFICIENCY_FACTOR,
        }));

        const pools1 = _.map(res.pools1, pool => ({
          exchange: this.dexKey,
          address: pool.id.toLowerCase(),
          connectorTokens: [
            {
              address: pool.token0.id.toLowerCase(),
              decimals: parseInt(pool.token0.decimals),
            },
          ],
          liquidityUSD:
            parseFloat(pool.totalValueLockedUSD) * UNISWAPV3_EFFICIENCY_FACTOR,
        }));

        const pools = _.slice(
          _.sortBy(_.concat(pools0, pools1), [pool => -1 * pool.liquidityUSD]),
          0,
          limit,
        );
        return pools;
      }

```

</details>

#### Good Practices for DEX integration

- Fullnode calls are expensive. An integration should minimize the number of fullnode rpc calls by following [Event based Pricing](#Understanding-the-event-based-pricing-approach)
- Use Multicall. Instead of performing each RPC calls individually they should be batched together into multicalls.
- Contract & Interface instances should be reused. There will be cases when you would be lured to create Contract/Interface objects for every dex pool to perform on-chain calls. This can lead to memory leaks in DEXes like UniswapV2 where there can be arbitrarily many pools. In such cases all the pools with the same abi should reuse the same Contract/Interface object.

## Writing Testing

- Integration Tests (`<you-dex-name>-integration.test.ts`): Tests the basic validity of the integration like if prices are valid, obeys the limit pools, etc.
- Events Unit Tests (`<you-dex-name>-events.test.ts`): Unit tests the event based system. This is done by fetching the state on-chain before the event, manually pushing the block logs to the event subscriber, comparing the local state with on-chain state.
- E2E Tests (`<you-dex-name>-e2e.test.ts`): End to end test the integration which involves pricing, transaction building and simulating the transaction on chain using tenderly fork simulations. E2E tests use the Tenderly fork api. Please add the following to your .env file:

In order to run tests, you will need to use Tenderly and so have .env file with this environment variables

```bash
TENDERLY_TOKEN=Find this under Account>Settings>Authorization.
TENDERLY_ACCOUNT_ID=Your Tenderly account name.
TENDERLY_PROJECT=Name of a Tenderly project you have created in your
dashboard.
```

import { Interface } from '@ethersproject/abi';
import {
  Token,
  Address,
  ExchangePrices,
  PoolPrices,
  AdapterExchangeParam,
  PoolLiquidity,
  DexExchangeParam,
  Logger,
  NumberAsString,
  TransferFeeParams,
} from '../../types';
import { SwapSide, Network, ETHER_ADDRESS } from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { IDex } from '../idex';
import { IDexHelper } from '../../dex-helper';
import { SimpleExchange } from '../simple-exchange';
import { getDexKeysWithNetwork, getBigIntPow, isETHAddress } from '../../utils';
import { uint256ToBigInt } from '../../lib/decoders';
import { MultiCallParams } from '../../lib/multi-wrapper';
import { FlowStateData, DexParams } from './types';
import { FlowStateConfig, FLOWSTATE_GAS_COST } from './config';

// Minimal interfaces (human-readable ABIs) — self-contained, no ABI json files.
const ORACLE_IFACE = new Interface([
  'function getRateToEth(address srcToken, bool useWrappers) view returns (uint256)',
]);
const FLOWSTATE_IFACE = new Interface([
  'function buyFromPool(address pool, uint256 amount, string resellerCode, address buyer) payable',
]);

type DiscoveredPool = {
  poolAddress: Address;
  tokenAddress: Address;
  tokenDecimals: number;
  publicAmountAvailable: string;
  tokenSymbol: string;
};

const POOL_CACHE_TTL_S = 60;

/**
 * FlowState C1 pools as a Velora liquidity source.
 *
 * Shape: buyers spend NATIVE ETH to buy an ERC20 out of a C1 pool via
 * `buyFromPool(pool, amount, resellerCode, buyer)` (payable). Pricing is the
 * on-chain 1inch spot rate (the exact rate the contract's `checkAmounts` uses),
 * flat/zero-slippage up to the pool's live inventory. Discovery is our Hasura.
 *
 * Direction: ETH -> TOKEN, exact-input SELL only. Everything else returns
 * []/null, so this module can only ever ADD a route, never affect others.
 */
export class FlowState extends SimpleExchange implements IDex<FlowStateData> {
  readonly hasConstantPriceLargeAmounts = false; // capped by pool inventory
  readonly needWrapNative = false; // payable buyFromPool consumes native ETH directly
  readonly isFeeOnTransferSupported = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(FlowStateConfig);

  logger: Logger;
  private cfg: DexParams;
  private poolCache: Record<
    string,
    { pools: DiscoveredPool[]; expiry: number }
  > = {};

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey);
    this.cfg = FlowStateConfig[dexKey][network];
  }

  // V6-only integration: no legacy V5 adapters.
  getAdapters(_side: SwapSide): { name: string; index: number }[] | null {
    return null;
  }

  private poolIdentifier(poolAddress: Address): string {
    return `${this.dexKey}_${poolAddress.toLowerCase()}`;
  }

  // Active C1 pools that sell `tokenAddress` for ETH, from our Hasura. Cached
  // briefly; on error we serve the last good snapshot rather than dropping out.
  private async discoverPools(
    tokenAddress: Address,
  ): Promise<DiscoveredPool[]> {
    const key = tokenAddress.toLowerCase();
    const now = Math.floor(Date.now() / 1000);
    const cached = this.poolCache[key];
    if (cached && cached.expiry > now) return cached.pools;

    const query = `{ Pool(where: { tokenAddress: {_ilike: "${key}"}, chainID: {_eq: ${this.network}}, poolStatus: {_eq: "ACTIVE"}, poolType: {_in: ["2","3"]} }, limit: 100) { poolAddress tokenAddress tokenDecimals publicAmountAvailable tokenSymbol } }`;

    try {
      const resp = await this.dexHelper.httpRequest.post<{
        data?: { Pool?: DiscoveredPool[] };
      }>(this.cfg.graphqlURL, { query });
      const pools = (resp?.data?.Pool ?? []).filter(p => !!p.poolAddress);
      this.poolCache[key] = { pools, expiry: now + POOL_CACHE_TTL_S };
      return pools;
    } catch (e) {
      this.logger.error(`FlowState discoverPools failed for ${key}`, e);
      return cached?.pools ?? [];
    }
  }

  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    _blockNumber: number,
  ): Promise<string[]> {
    if (side !== SwapSide.SELL) return []; // exact-input only
    if (!isETHAddress(srcToken.address)) return []; // ETH -> TOKEN only
    if (isETHAddress(destToken.address)) return [];
    const pools = await this.discoverPools(destToken.address);
    return pools.map(p => this.poolIdentifier(p.poolAddress));
  }

  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
    transferFees?: TransferFeeParams,
    isFirstSwap?: boolean,
  ): Promise<ExchangePrices<FlowStateData> | null> {
    if (side !== SwapSide.SELL) return null;
    if (!isETHAddress(srcToken.address)) return null;
    if (isETHAddress(destToken.address)) return null;
    // We can only be the ROUTE INPUT. Our calldata bakes a static token amount
    // sized to the quoted ETH, and the contract re-validates it against the
    // RUNTIME msg.value (±1%) at execution. As the first/only swap (incl.
    // splits) msg.value is the user's fixed input and matches; as a non-first
    // hop it is the prior hop's live output, which can drift >1% and revert
    // (fail-closed). So decline when the pricing engine says we're not first.
    // (isFirstSwap === swapIndex 0. When the flag is absent — undefined — we
    // fall through and the non-first-hop case fails closed on-chain; see
    // getDexParam. This guard can only ever ADD a decline, never break a swap.)
    if (isFirstSwap === false) return null;

    let pools = await this.discoverPools(destToken.address);
    if (limitPools) {
      const allow = new Set(limitPools);
      pools = pools.filter(p => allow.has(this.poolIdentifier(p.poolAddress)));
    }
    if (!pools.length) return null;

    // Read the exact fill inputs on-chain @ blockNumber: the 1inch rate the
    // contract prices against, plus each pool's live token inventory.
    const calls: MultiCallParams<bigint>[] = [
      {
        target: this.cfg.oracle,
        callData: ORACLE_IFACE.encodeFunctionData('getRateToEth', [
          destToken.address,
          false,
        ]),
        decodeFunction: uint256ToBigInt,
      },
      ...pools.map(p => ({
        target: destToken.address,
        callData: this.erc20Interface.encodeFunctionData('balanceOf', [
          p.poolAddress,
        ]),
        decodeFunction: uint256ToBigInt,
      })),
    ];

    // tryAggregate (not aggregate): a token 1inch can't route reverts
    // getRateToEth, and a broken token can revert balanceOf. All-or-nothing
    // aggregate would throw the whole batch and disrupt the rest of the
    // pricing run; per-call success flags let us degrade to "no quote".
    const results = await this.dexHelper.multiWrapper.tryAggregate<bigint>(
      false,
      calls,
      blockNumber,
    );

    // No oracle price => the contract's checkAmounts can never be satisfied.
    const rateResult = results[0];
    if (!rateResult.success || !rateResult.returnData) return null;
    const rate = rateResult.returnData; // weiPerToken (1inch getRateToEth)
    if (rate === 0n) return null;

    const E18 = getBigIntPow(18);
    const unit = (E18 * E18) / rate; // tokens out for exactly 1 ETH

    const poolPrices: ExchangePrices<FlowStateData> = [];
    pools.forEach((p, i) => {
      const balResult = results[i + 1];
      // balanceOf reverted (broken token) => treat as no inventory.
      const balance =
        balResult.success && balResult.returnData ? balResult.returnData : 0n;
      if (balance === 0n) return; // nothing fillable — don't offer this pool

      const prices = amounts.map(a => {
        if (a === 0n) return 0n;
        const out = (a * E18) / rate; // == publicPool.checkAmounts formula
        return out > balance ? 0n : out; // cannot fill beyond live inventory
      });
      poolPrices.push({
        prices,
        unit,
        data: {
          pool: p.poolAddress,
          resellerCode: this.cfg.resellerCode,
          rate: rate.toString(),
        },
        exchange: this.dexKey,
        gasCost: FLOWSTATE_GAS_COST,
        poolAddresses: [p.poolAddress],
        poolIdentifiers: [this.poolIdentifier(p.poolAddress)],
      });
    });

    return poolPrices.length ? poolPrices : null;
  }

  getCalldataGasCost(
    poolPrices: PoolPrices<FlowStateData>,
  ): number | number[] {
    // buyFromPool(address pool, uint256 amount, string resellerCode, address
    // buyer): 4 head words (pool, amount, string offset, buyer) + string tail
    // (1 length word + ceil(len/32) data words). resellerCode is '' by default
    // (0 data words); size it from the actual code so a set code isn't
    // under-counted.
    const codeBytes = (poolPrices.data?.resellerCode ?? '').length;
    const stringTailWords = 1 + Math.ceil(codeBytes / 32);
    return (
      CALLDATA_GAS_COST.DEX_OVERHEAD +
      CALLDATA_GAS_COST.FULL_WORD * (4 + stringTailWords)
    );
  }

  // V5 adapter path is unused (V6-only); return an inert stub (matches the
  // repo convention for V6-only dexes — no adapter is ever registered because
  // getAdapters returns null).
  getAdapterParam(): AdapterExchangeParam {
    return { targetExchange: '0x', payload: '0x', networkFee: '0' };
  }

  getDexParam(
    _srcToken: Address,
    _destToken: Address,
    srcAmount: NumberAsString,
    _destAmount: NumberAsString,
    recipient: Address,
    data: FlowStateData,
    _side: SwapSide,
  ): DexExchangeParam {
    // Exact token OUT = ETH IN priced at the quote's 1inch rate — the value
    // `checkAmounts` expects against msg.value (= srcAmount). We recompute here
    // (not `_destAmount`, which is the slippage-reduced min and could break the
    // contract's ±1% band).
    //
    // NON-FIRST-HOP LIMITATION: the V6 executor sends msg.value = the RUNTIME
    // fromAmount. For the route input (single swap / first hop / splits) that is
    // the user's fixed ETH and equals `srcAmount`, so this static token amount
    // matches. As a *non-first* hop, msg.value is the prior hop's live output
    // and can drift >1% from the quote, tripping checkAmounts — a fail-closed
    // revert of that route only (no fund loss, no effect on other dexes).
    // getPricesVolume declines when isFirstSwap === false; where the engine does
    // not pass that flag this stays a documented fail-closed edge. The clean fix
    // is contract-side: a buyFromPool variant that derives the token amount from
    // msg.value on-chain, making any msg.value safe.
    const amount = (BigInt(srcAmount) * getBigIntPow(18)) / BigInt(data.rate);

    const exchangeData = FLOWSTATE_IFACE.encodeFunctionData('buyFromPool', [
      data.pool,
      amount.toString(),
      data.resellerCode,
      recipient, // buyer == recipient → tokens delivered straight to the user
    ]);

    return {
      // Native ETH consumed directly by payable buyFromPool. The V6 executor
      // sends msg.value = srcAmount via Flag 9 (SEND_ETH_EQUAL_TO_FROM_AMOUNT).
      needWrapNative: false,
      dexFuncHasRecipient: true,
      exchangeData,
      targetExchange: this.cfg.router,
      // buyFromPool returns nothing → executor reads the recipient balance
      // delta. And we intentionally DO NOT set
      // sendEthButSupportsInsertFromAmount: our calldata has no ETH-amount arg
      // to patch (that would be Flag 18, wrong for this ABI).
      returnAmountPos: undefined,
    };
  }

  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    if (isETHAddress(tokenAddress)) return [];
    const pools = await this.discoverPools(tokenAddress);

    const liquidity = await Promise.all(
      pools.map(async (p): Promise<PoolLiquidity> => {
        let liquidityUSD = 0;
        try {
          liquidityUSD = await this.dexHelper.getTokenUSDPrice(
            { address: p.tokenAddress, decimals: p.tokenDecimals },
            BigInt(p.publicAmountAvailable || '0'),
          );
        } catch (e) {
          this.logger.error(
            `FlowState getTokenUSDPrice failed for ${p.tokenAddress}`,
            e,
          );
        }
        return {
          exchange: this.dexKey,
          address: p.poolAddress,
          connectorTokens: [{ address: ETHER_ADDRESS, decimals: 18 }],
          liquidityUSD,
        };
      }),
    );

    return liquidity
      .sort((a, b) => b.liquidityUSD - a.liquidityUSD)
      .slice(0, limit);
  }
}

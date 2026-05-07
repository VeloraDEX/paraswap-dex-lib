import { NumberAsString } from '@paraswap/core';

import {
  Logger,
  Token,
  Address,
  PoolPrices,
  AdapterExchangeParam,
  PoolLiquidity,
  ConnectorToken,
  ExchangePrices,
  DexExchangeParam,
} from '../../types';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { IDex } from '../idex';
import { SimpleExchange } from '../simple-exchange';
import { Network, NULL_ADDRESS, SwapSide } from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import {
  currentBigIntTimestampInS,
  getBigIntPow,
  getDexKeysWithNetwork,
} from '../../utils';
import { uint8ToNumber } from '../../lib/decoders';
import { extractReturnAmountPosition } from '../../executor/utils';

import { ClearConfig } from './config';
import { ClearData, DexParams, ClearVault } from './types';
import { swapIface, vaultIface } from './clear-ifaces';
import { ClearFactory } from './clear-factory';
import { ClearProtocolStateSubscriber } from './clear-protocol-state';
import { ClearVaultStateSubscriber } from './clear-vault-state';
import { ClearCurvePoolState, ClearCurveMetapool } from './clear-curve-state';
import {
  validateDepeg,
  computeSwapOutputs,
  applyIouFees,
  availableLiquidity,
  checkExposureAfterSwap,
  makeExposureContext,
} from './math/clear-math';
import { getDyUnderlying } from './math/stable-swap';

const CLEAR_GAS_COST = 150_000;
const ORACLE_REFRESH_TTL = 30 * 1000;
const CURVE_REFRESH_TTL = 60 * 1000;
const VAULT_ADAPTER_REFRESH_TTL = 60 * 1000;
const DISCOVERY_TTL = 5 * 60 * 1000;
const ERC20_DECIMALS_SELECTOR = '0x313ce567';

export class Clear extends SimpleExchange implements IDex<ClearData> {
  logger: Logger;
  protected config: DexParams;

  protected factory: ClearFactory;
  protected protocolState: ClearProtocolStateSubscriber;
  protected vaultStates: Record<string, ClearVaultStateSubscriber> = {};
  protected metapools: Record<string, ClearCurveMetapool> = {};
  protected basePools: Record<string, ClearCurvePoolState> = {};

  protected oracleTimer?: NodeJS.Timeout;
  protected curveTimer?: NodeJS.Timeout;
  protected adapterTimer?: NodeJS.Timeout;
  protected discoveryTimer?: NodeJS.Timeout;

  // Vaults snapshot used by getTopPoolsForToken; refreshed in updatePoolState().
  private cachedVaults: ClearVault[] = [];

  readonly hasConstantPriceLargeAmounts = false;
  readonly isFeeOnTransferSupported = false;
  // Clear deals exclusively in ERC20 stablecoins, never the native token.
  readonly needWrapNative = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(ClearConfig);

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
  ) {
    super(dexHelper, dexKey);
    this.config = ClearConfig[dexKey][network];
    this.logger = dexHelper.getLogger(dexKey);

    this.factory = new ClearFactory(
      dexKey,
      this.config,
      network,
      dexHelper,
      this.logger,
    );

    this.protocolState = new ClearProtocolStateSubscriber(
      dexKey,
      this.config,
      dexHelper,
      this.logger,
    );
  }

  getAdapters(_side: SwapSide): null {
    return null;
  }

  async initializePricing(blockNumber: number): Promise<void> {
    await Promise.all([
      this.factory.initialize(blockNumber),
      this.protocolState.initialize(blockNumber),
    ]);

    const factoryState = this.factory.getState(blockNumber) || [];
    await this.bootstrapVaults(
      factoryState.map(v => ({
        address: v.address,
        tokens: [...v.tokens],
        curvePlainPool: v.curvePlainPool,
      })),
      blockNumber,
    );

    const allAssets = new Set<string>();
    for (const v of factoryState) {
      for (const t of v.tokens) allAssets.add(t.toLowerCase());
    }
    if (allAssets.size > 0) {
      await this.protocolState.hydrateAssets(
        Array.from(allAssets),
        blockNumber,
      );
    }

    this.startRefreshLoops();
  }

  // Returns the union of assets across all known vaults. Recomputed each tick so
  // newly-bootstrapped vaults' tokens are picked up automatically.
  private allAssets(): string[] {
    const acc = new Set<string>();
    const factoryState = this.factory.getState(
      this.dexHelper.blockManager.getLatestBlockNumber(),
    );
    if (factoryState) {
      for (const v of factoryState) for (const t of v.tokens) acc.add(t);
    }
    return Array.from(acc);
  }

  private startRefreshLoops(): void {
    const safeRun = async (label: string, fn: () => Promise<void>) => {
      try {
        await fn();
      } catch (e) {
        this.logger.warn(`${this.dexKey}: ${label} refresh failed: ${e}`);
      }
    };

    // Curve metapool state is held in plain class fields (not StatefulEventSubscriber),
    // so it doesn't propagate via the framework cache — every instance must refresh.
    if (!this.curveTimer) {
      this.curveTimer = setInterval(
        () =>
          safeRun('curve', async () => {
            const bn = await this.dexHelper.provider.getBlockNumber();
            await Promise.all(
              Object.values(this.metapools).map(m => m.refresh(bn)),
            );
          }),
        CURVE_REFRESH_TTL,
      );
    }

    // Master/slave guard: refreshes that go through setState propagate via the framework cache,
    // so only the master needs to do the RPC.
    if (this.dexHelper.config.isSlave) return;

    if (!this.oracleTimer) {
      this.oracleTimer = setInterval(
        () =>
          safeRun('oracle', async () => {
            const bn = await this.dexHelper.provider.getBlockNumber();
            await this.protocolState.refreshPrices(this.allAssets(), bn);
          }),
        ORACLE_REFRESH_TTL,
      );
    }
    if (!this.adapterTimer) {
      this.adapterTimer = setInterval(
        () =>
          safeRun('adapter', async () => {
            const bn = await this.dexHelper.provider.getBlockNumber();
            await Promise.all(
              Object.values(this.vaultStates).map(v => v.refreshAssets(bn)),
            );
          }),
        VAULT_ADAPTER_REFRESH_TTL,
      );
    }
    // Pick up vaults created post-init: subscribers/metapools for them aren't auto-built.
    if (!this.discoveryTimer) {
      this.discoveryTimer = setInterval(
        () =>
          safeRun('discovery', async () => {
            const bn = await this.dexHelper.provider.getBlockNumber();
            const factoryState = this.factory.getState(bn) || [];
            const assets = new Set<string>();
            for (const v of factoryState) {
              for (const t of v.tokens) assets.add(t);
            }
            await this.bootstrapVaults(
              factoryState.map(v => ({
                address: v.address,
                tokens: [...v.tokens],
                curvePlainPool: v.curvePlainPool,
              })),
              bn,
            );
            if (assets.size > 0) {
              await this.protocolState.hydrateAssets(Array.from(assets), bn);
            }
          }),
        DISCOVERY_TTL,
      );
    }
  }

  releaseResources(): void {
    for (const timer of [
      this.oracleTimer,
      this.curveTimer,
      this.adapterTimer,
      this.discoveryTimer,
    ]) {
      if (timer) clearInterval(timer);
    }
    this.oracleTimer = undefined;
    this.curveTimer = undefined;
    this.adapterTimer = undefined;
    this.discoveryTimer = undefined;
  }

  private async bootstrapVaults(
    factoryState: {
      address: string;
      tokens: string[];
      curvePlainPool: string;
    }[],
    blockNumber: number,
  ): Promise<void> {
    // Phase 1: instantiate + initialize all vault subscribers in parallel.
    const newVaults = factoryState.filter(
      v => !this.vaultStates[v.address.toLowerCase()],
    );
    await Promise.all(
      newVaults.map(async v => {
        const sub = new ClearVaultStateSubscriber(
          this.dexKey,
          v.address,
          v.curvePlainPool,
          this.dexHelper,
          this.logger,
        );
        await sub.initialize(blockNumber);
        this.vaultStates[v.address.toLowerCase()] = sub;
      }),
    );

    // Phase 2: collect base pools + metapools to instantiate, dedup, then refresh in parallel.
    const basePoolSpecs = new Map<string, number>();
    const metapoolSpecs = new Map<string, string>();
    for (const v of newVaults) {
      const baseAddr = v.curvePlainPool.toLowerCase();
      if (
        baseAddr &&
        baseAddr !== NULL_ADDRESS &&
        !this.basePools[baseAddr]
      ) {
        basePoolSpecs.set(baseAddr, v.tokens.length);
      }
      const vaultState =
        this.vaultStates[v.address.toLowerCase()].getState(blockNumber);
      if (!vaultState) continue;
      for (const t of Object.values(vaultState.tokens)) {
        const meta = t.iouCurveMetaPool;
        if (!meta || meta === NULL_ADDRESS || this.metapools[meta]) continue;
        metapoolSpecs.set(meta, baseAddr);
      }
    }

    for (const [addr, nCoins] of basePoolSpecs) {
      this.basePools[addr] = new ClearCurvePoolState(
        addr,
        nCoins,
        this.dexHelper,
        this.logger,
      );
    }
    for (const [meta, baseAddr] of metapoolSpecs) {
      // Defensive: skip metapool wiring if its base pool didn't get instantiated
      // (e.g. the vault's curvePlainPool wasn't readable). Otherwise getMetapoolState() would NPE.
      const basePool = this.basePools[baseAddr];
      if (!basePool) {
        this.logger.warn(
          `${this.dexKey}: metapool ${meta} skipped — base pool ${
            baseAddr || '(empty)'
          } unavailable`,
        );
        continue;
      }
      const metaPool = new ClearCurvePoolState(
        meta,
        2,
        this.dexHelper,
        this.logger,
      );
      this.metapools[meta] = new ClearCurveMetapool(metaPool, basePool);
    }

    await Promise.all([
      ...Array.from(basePoolSpecs.keys()).map(addr =>
        this.basePools[addr].refresh(blockNumber),
      ),
      ...Array.from(metapoolSpecs.keys())
        .filter(meta => this.metapools[meta])
        .map(meta => this.metapools[meta].metapool.refresh(blockNumber)),
    ]);
  }

  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    if (side === SwapSide.BUY) return [];

    const factoryState = this.factory.getState(blockNumber) || [];
    const src = srcToken.address.toLowerCase();
    const dest = destToken.address.toLowerCase();

    return factoryState
      .filter(v => v.tokens.includes(src) && v.tokens.includes(dest))
      .map(v =>
        `${this.dexKey}_${v.address}_${srcToken.address}_${destToken.address}`.toLowerCase(),
      );
  }

  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<ClearData>> {
    if (side === SwapSide.BUY) return null;

    const poolIdentifiers =
      limitPools ||
      (await this.getPoolIdentifiers(srcToken, destToken, side, blockNumber));
    if (poolIdentifiers.length === 0) return null;

    const protoState = this.protocolState.getState(blockNumber);
    if (!protoState || protoState.swap.paused) return null;

    const srcAddr = srcToken.address.toLowerCase();
    const destAddr = destToken.address.toLowerCase();
    const fromOracle = protoState.oracles[srcAddr];
    const toOracle = protoState.oracles[destAddr];
    if (!fromOracle || !toOracle || !fromOracle.enabled || !toOracle.enabled) {
      return null;
    }

    // Amount-invariant: skip the whole pool family if the depeg/redemption guards fail.
    const depeg = validateDepeg(
      fromOracle,
      toOracle,
      protoState.swap.depegThresholdBps,
      protoState.swap.maximalDepegThresholdBps,
    );
    if (!depeg) return null;

    const blockTimestamp = currentBigIntTimestampInS();
    const poolPrices: PoolPrices<ClearData>[] = [];

    const idPrefix = `${this.dexKey.toLowerCase()}_`;
    for (const poolIdentifier of poolIdentifiers) {
      const lower = poolIdentifier.toLowerCase();
      if (!lower.startsWith(idPrefix)) continue;
      const vaultAddress = lower.slice(idPrefix.length).split('_')[0];
      const vaultSub = this.vaultStates[vaultAddress];
      if (!vaultSub) continue;
      const vaultState = vaultSub.getState(blockNumber);
      if (!vaultState) continue;
      const fromVaultToken = vaultState.tokens[srcAddr];
      const toVaultToken = vaultState.tokens[destAddr];
      if (!fromVaultToken || !toVaultToken) continue;

      const exposureCtx = makeExposureContext(vaultState, srcAddr);
      if (!exposureCtx) continue;

      const metaState =
        this.metapools[fromVaultToken.iouCurveMetaPool]?.getMetapoolState() ??
        null;
      const liquidity = availableLiquidity(toVaultToken);
      // Metapool IOU lives at index 0; underlying lives at index 1+poolIndex of `to`.
      const j = 1 + Number(toVaultToken.tokensCurvePoolIndex);

      const prices = amounts.map(amount => {
        if (amount === 0n) return 0n;
        const swap = computeSwapOutputs(
          fromOracle,
          toOracle,
          amount,
          depeg.iouRedemption,
        );
        if (liquidity < swap.amountOut) return 0n;
        if (!checkExposureAfterSwap(exposureCtx, amount)) return 0n;

        const iousAfterFees = applyIouFees(
          swap.ious,
          vaultState.iouLpFeeBps,
          vaultState.iouTreasuryFeeBps,
        );
        if (iousAfterFees === 0n) return swap.amountOut;
        if (!metaState) return 0n;
        try {
          const iouSwapOut = getDyUnderlying(
            metaState,
            0,
            j,
            iousAfterFees,
            blockTimestamp,
          );
          return swap.amountOut + iouSwapOut;
        } catch (e) {
          this.logger.warn(`${this.dexKey}: curve dy failed: ${e}`);
          return 0n;
        }
      });

      if (prices.every(p => p === 0n)) continue;

      poolPrices.push({
        prices,
        unit: getBigIntPow(destToken.decimals),
        data: { vault: vaultAddress },
        poolIdentifiers: [poolIdentifier],
        exchange: this.dexKey,
        gasCost: this.config.poolGasCost || CLEAR_GAS_COST,
        poolAddresses: [vaultAddress],
      });
    }

    return poolPrices.length > 0 ? poolPrices : null;
  }

  getAdapterParam(): AdapterExchangeParam {
    return {
      targetExchange: '0x',
      payload: '0x',
      networkFee: '0',
    };
  }

  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: ClearData,
    _side: SwapSide,
  ): DexExchangeParam {
    const exchangeData = swapIface.encodeFunctionData('swap', [
      recipient,
      data.vault,
      srcToken,
      destToken,
      srcAmount,
      destAmount,
      false,
    ]);

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: true,
      exchangeData,
      targetExchange: this.config.swapAddress,
      returnAmountPos: extractReturnAmountPosition(
        swapIface,
        'swap',
        'amountOut',
      ),
    };
  }

  getCalldataGasCost(_poolPrices: PoolPrices<ClearData>): number | number[] {
    return (
      CALLDATA_GAS_COST.FUNCTION_SELECTOR +
      CALLDATA_GAS_COST.ADDRESS +
      CALLDATA_GAS_COST.ADDRESS +
      CALLDATA_GAS_COST.ADDRESS +
      CALLDATA_GAS_COST.ADDRESS +
      CALLDATA_GAS_COST.AMOUNT +
      CALLDATA_GAS_COST.AMOUNT +
      CALLDATA_GAS_COST.BOOL
    );
  }

  // PoolTracker calls this before getTopPoolsForToken on a service that doesn't run event subscribers,
  // so we self-contain the RPC fetch here.
  async updatePoolState(): Promise<void> {
    const blockNumber = await this.dexHelper.provider.getBlockNumber();
    const factoryState = await this.factory.getStateOrGenerate(blockNumber);
    if (factoryState.length === 0) {
      return this.logger.info(
        `${this.dexKey}: no vaults found in updatePoolState`,
      );
    }

    const allTokens = Array.from(new Set(factoryState.flatMap(v => v.tokens)));
    const decimalCalls = allTokens.map(token => ({
      target: token,
      callData: ERC20_DECIMALS_SELECTOR,
    }));
    const tokenAssetCalls: { target: string; callData: string }[] = [];
    type Pair = { vaultIdx: number; tokenAddress: string };
    const tokenAssetMap: Pair[] = [];
    for (let i = 0; i < factoryState.length; i++) {
      for (const token of factoryState[i].tokens) {
        tokenAssetCalls.push({
          target: factoryState[i].address,
          callData: vaultIface.encodeFunctionData('tokenAssets', [token]),
        });
        tokenAssetMap.push({ vaultIdx: i, tokenAddress: token });
      }
    }

    const allCalls = [
      ...decimalCalls.map(c => ({
        ...c,
        decodeFunction: (raw: any): number => Number(uint8ToNumber(raw)),
      })),
      ...tokenAssetCalls.map(c => ({
        ...c,
        decodeFunction: (raw: any): bigint =>
          BigInt(
            vaultIface.decodeFunctionResult('tokenAssets', raw)[0].toString(),
          ),
      })),
    ];
    const aggResult = await this.dexHelper.multiWrapper.tryAggregate<
      number | bigint
    >(false, allCalls, blockNumber);

    const decimals: Record<string, number> = {};
    for (let i = 0; i < allTokens.length; i++) {
      const r = aggResult[i];
      decimals[allTokens[i]] = r.success ? (r.returnData as number) : 18;
    }

    const vaultTokenAssets: Record<string, bigint>[] = factoryState.map(
      () => ({}),
    );
    for (let i = 0; i < tokenAssetMap.length; i++) {
      const r = aggResult[allTokens.length + i];
      if (!r.success) continue;
      const { vaultIdx, tokenAddress } = tokenAssetMap[i];
      vaultTokenAssets[vaultIdx][tokenAddress.toLowerCase()] =
        r.returnData as bigint;
    }

    this.cachedVaults = factoryState.map((vault, i) => ({
      address: vault.address,
      tokens: vault.tokens.map(t => ({
        address: t,
        decimals: decimals[t] ?? 18,
      })),
      tokenAssets: vaultTokenAssets[i],
    }));
  }

  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    const target = tokenAddress.toLowerCase();
    const matching = this.cachedVaults.filter(v =>
      v.tokens.some(t => t.address.toLowerCase() === target),
    );
    if (matching.length === 0) return [];

    const tokenAmountPairs: [Address, bigint | null][] = [];
    const counts: number[] = [];
    for (const vault of matching) {
      counts.push(vault.tokens.length);
      for (const t of vault.tokens) {
        tokenAmountPairs.push([
          t.address,
          vault.tokenAssets[t.address.toLowerCase()] ?? null,
        ]);
      }
    }

    const usdAmounts = await this.dexHelper.getUsdTokenAmounts(
      tokenAmountPairs,
    );

    let offset = 0;
    const liquidities: PoolLiquidity[] = matching
      .map((vault, i) => {
        const count = counts[i];
        const map: Record<string, number> = {};
        for (let j = 0; j < count; j++) {
          map[vault.tokens[j].address.toLowerCase()] = usdAmounts[offset + j];
        }
        offset += count;

        const connectorTokens: ConnectorToken[] = vault.tokens
          .filter(t => t.address.toLowerCase() !== target)
          .map(t => ({
            address: t.address,
            decimals: t.decimals ?? 18,
            liquidityUSD: map[t.address.toLowerCase()],
          }));

        if (connectorTokens.length === 0) return null;

        return {
          exchange: this.dexKey,
          address: vault.address,
          connectorTokens,
          liquidityUSD: map[target] ?? 0,
        } as PoolLiquidity;
      })
      .filter((x): x is PoolLiquidity => x !== null);

    return liquidities
      .sort((a, b) => b.liquidityUSD - a.liquidityUSD)
      .slice(0, limit);
  }
}

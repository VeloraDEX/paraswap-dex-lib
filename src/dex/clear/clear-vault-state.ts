import { DeepReadonly } from 'ts-essentials';

import { Address, Log, Logger } from '../../types';
import { NULL_ADDRESS } from '../../constants';
import { catchParseLogError } from '../../utils';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { IDexHelper } from '../../dex-helper';

import { ClearVaultState, VaultTokenState } from './types';
import { scaleToVaultDecimals } from './math/clear-math';
import { vaultIface } from './clear-ifaces';

type Handler = (
  event: any,
  state: DeepReadonly<ClearVaultState>,
  log: Readonly<Log>,
) => DeepReadonly<ClearVaultState> | null;

export class ClearVaultStateSubscriber extends StatefulEventSubscriber<ClearVaultState> {
  addressesSubscribed: Address[];
  protected handlers: Record<string, Handler> = {};

  constructor(
    parentName: string,
    public readonly vaultAddress: Address,
    public readonly curvePlainPool: Address,
    protected dexHelper: IDexHelper,
    logger: Logger,
  ) {
    super(parentName, `vault_${vaultAddress.toLowerCase()}`, dexHelper, logger);
    this.addressesSubscribed = [vaultAddress];

    this.handlers['LiquiditySwapExecuted'] =
      this.handleLiquiditySwap.bind(this);
    this.handlers['Deposit'] = this.handleDeposit.bind(this);
    this.handlers['Withdraw'] = this.handleWithdraw.bind(this);
    this.handlers['LiquidityRebalanceExecuted'] =
      this.handleRebalance.bind(this);
    this.handlers['IouFeeBpsUpdated'] = this.handleIouFee.bind(this);
    this.handlers['TokenInitialized'] = this.handleTokenInitialized.bind(this);
    this.handlers['TokenExposureConfigurationUpdated'] =
      this.handleExposureUpdated.bind(this);
    this.handlers['AdapterChanged'] = this.handleAdapterChanged.bind(this);
    this.handlers['IouCurveMetaPoolUpdated'] =
      this.handleIouCurveMetaPoolUpdated.bind(this);
  }

  protected processLog(
    state: DeepReadonly<ClearVaultState>,
    log: Readonly<Log>,
  ): DeepReadonly<ClearVaultState> | null {
    try {
      const event = vaultIface.parseLog(log);
      if (event.name in this.handlers) {
        return this.handlers[event.name](event, state, log);
      }
    } catch (e) {
      catchParseLogError(e, this.logger);
    }
    return null;
  }

  async generateState(
    blockNumber: number,
  ): Promise<DeepReadonly<ClearVaultState>> {
    // details() + index() + totalSupply() in one multicall.
    const calls = [
      {
        target: this.vaultAddress,
        callData: vaultIface.encodeFunctionData('details'),
      },
      {
        target: this.vaultAddress,
        callData: vaultIface.encodeFunctionData('index'),
      },
      {
        target: this.vaultAddress,
        callData: vaultIface.encodeFunctionData('totalSupply'),
      },
    ];
    const result = await this.dexHelper.multiContract.methods
      .aggregate(calls)
      .call({}, blockNumber);

    const decoded = vaultIface.decodeFunctionResult(
      'details',
      result.returnData[0],
    );
    const index = BigInt(
      vaultIface
        .decodeFunctionResult('index', result.returnData[1])[0]
        .toString(),
    );
    const totalSupply = BigInt(
      vaultIface
        .decodeFunctionResult('totalSupply', result.returnData[2])[0]
        .toString(),
    );

    const iouTreasuryFeeBps = BigInt(decoded[0].toString());
    const iouLpFeeBps = BigInt(decoded[1].toString());
    const tokenDetails = decoded[5] as any[];

    const tokens: { [k: string]: VaultTokenState } = {};
    for (const t of tokenDetails) {
      const addr = String(t.addr ?? t[0]).toLowerCase();
      const iou = String(t.iou ?? t[1]).toLowerCase();
      const iouCurveMetaPool = String(t.iouCurveMetaPool ?? t[2]).toLowerCase();
      const adapter = String(t.adapter ?? t[3]).toLowerCase();
      const maxExposureBps = BigInt((t.maxExposureBps ?? t[4]).toString());
      const desiredExposureBps = BigInt(
        (t.desiredExposureBps ?? t[5]).toString(),
      );
      const emitedIou = BigInt((t.emitedIou ?? t[6]).toString());
      const balance = BigInt((t.balance ?? t[7]).toString());
      const decimals = Number(t.decimals ?? t[9]);

      tokens[addr] = {
        enabled: true,
        decimals,
        iou,
        iouCurveMetaPool,
        tokensCurvePoolIndex: 0n,
        adapter,
        maxExposureBps,
        desiredExposureBps,
        emitedIou,
        cachedAssets: balance,
      };
    }

    // Curve indexes are queried separately; tolerate per-call failures (e.g. token disabled mid-deploy).
    const indexCalls = Object.keys(tokens).map(addr => ({
      target: this.vaultAddress,
      callData: vaultIface.encodeFunctionData('tokensCurvePoolIndexOf', [addr]),
      decodeFunction: (raw: any): bigint =>
        BigInt(
          vaultIface
            .decodeFunctionResult('tokensCurvePoolIndexOf', raw)[0]
            .toString(),
        ),
    }));
    if (indexCalls.length > 0) {
      const idxResult = await this.dexHelper.multiWrapper.tryAggregate<bigint>(
        false,
        indexCalls,
        blockNumber,
      );
      const addrs = Object.keys(tokens);
      for (let i = 0; i < addrs.length; i++) {
        const r = idxResult[i];
        if (r.success) tokens[addrs[i]].tokensCurvePoolIndex = r.returnData;
      }
    }

    const exposureDenominator = (totalSupply * index) / 10_000n;

    return {
      address: this.vaultAddress.toLowerCase(),
      curvePlainPool: this.curvePlainPool.toLowerCase(),
      iouLpFeeBps,
      iouTreasuryFeeBps,
      exposureDenominator,
      tokens,
    };
  }

  // After Deposit/Withdraw/Rebalance, the contract's refreshIndex modifier resets index so that
  // totalSupply * index / 10000 == totalAssets(). We mirror that by recomputing from cachedAssets.
  private withRefreshedDenominator(
    state: DeepReadonly<ClearVaultState>,
  ): DeepReadonly<ClearVaultState> {
    let total = 0n;
    for (const t of Object.values(state.tokens)) {
      total += scaleToVaultDecimals(t.cachedAssets, t.decimals);
    }
    return { ...state, exposureDenominator: total };
  }

  // Refresh on-chain tokenAssets for tokens that use a yield adapter (rates drift over time).
  async refreshAssets(blockNumber: number): Promise<void> {
    const state = this.getState(blockNumber);
    if (!state) return;
    const adapterTokens = Object.entries(state.tokens).filter(
      ([, t]) => t.adapter !== NULL_ADDRESS,
    );
    if (adapterTokens.length === 0) return;

    const calls = adapterTokens.map(([token]) => ({
      target: this.vaultAddress,
      callData: vaultIface.encodeFunctionData('tokenAssets', [token]),
      decodeFunction: (raw: any): bigint =>
        BigInt(
          vaultIface.decodeFunctionResult('tokenAssets', raw)[0].toString(),
        ),
    }));
    const result = await this.dexHelper.multiWrapper.tryAggregate<bigint>(
      false,
      calls,
      blockNumber,
    );

    const next: Record<string, VaultTokenState> = { ...state.tokens };
    let changed = false;
    for (let i = 0; i < adapterTokens.length; i++) {
      const r = result[i];
      if (!r.success) continue;
      const [token] = adapterTokens[i];
      const newAssets = r.returnData;
      if (next[token].cachedAssets === newAssets) continue;
      next[token] = { ...next[token], cachedAssets: newAssets };
      changed = true;
    }
    if (!changed) return;
    this.setState({ ...state, tokens: next }, blockNumber, 'vault_refresh');
  }

  protected handleLiquiditySwap(
    event: any,
    state: DeepReadonly<ClearVaultState>,
  ): DeepReadonly<ClearVaultState> | null {
    const from = String(event.args.from).toLowerCase();
    const to = String(event.args.to).toLowerCase();
    const amountIn = BigInt(event.args.amountIn.toString());
    const tokenAmountOut = BigInt(event.args.tokenAmountOut.toString());
    const iouAmountOut = BigInt(event.args.iouAmountOut.toString());
    const iouLpFee = BigInt(event.args.iouLpFee.toString());

    const fromToken = state.tokens[from];
    const toToken = state.tokens[to];
    if (!fromToken || !toToken) return null;

    // Vault state after swap: balance_from += amountIn, emitedIou_from += (iouAmountOut - lpFee).
    // cachedAssets = balance - emitedIou, so its delta is amountIn - (iouAmountOut - lpFee).
    const emitedIouDelta = iouAmountOut - iouLpFee;

    return {
      ...state,
      tokens: {
        ...state.tokens,
        [from]: {
          ...fromToken,
          cachedAssets: fromToken.cachedAssets + amountIn - emitedIouDelta,
          emitedIou: fromToken.emitedIou + emitedIouDelta,
        },
        [to]: {
          ...toToken,
          cachedAssets: toToken.cachedAssets - tokenAmountOut,
        },
      },
    };
  }

  protected handleDeposit(
    event: any,
    state: DeepReadonly<ClearVaultState>,
  ): DeepReadonly<ClearVaultState> | null {
    const next = applyAssetsDelta(
      state,
      String(event.args.token),
      BigInt(event.args.assets.toString()),
    );
    return next && this.withRefreshedDenominator(next);
  }

  protected handleWithdraw(
    event: any,
    state: DeepReadonly<ClearVaultState>,
  ): DeepReadonly<ClearVaultState> | null {
    const next = applyAssetsDelta(
      state,
      String(event.args.token),
      -BigInt(event.args.assets.toString()),
    );
    return next && this.withRefreshedDenominator(next);
  }

  protected handleRebalance(
    event: any,
    state: DeepReadonly<ClearVaultState>,
  ): DeepReadonly<ClearVaultState> | null {
    const from = String(event.args.from).toLowerCase();
    const to = String(event.args.to).toLowerCase();
    const amountIn = BigInt(event.args.amountIn.toString());
    const amountOut = BigInt(event.args.amountOut.toString());
    const partial = applyAssetsDelta(state, from, -amountIn);
    if (!partial) return null;
    const after = applyAssetsDelta(partial, to, amountOut);
    return after && this.withRefreshedDenominator(after);
  }

  protected handleIouFee(
    event: any,
    state: DeepReadonly<ClearVaultState>,
  ): DeepReadonly<ClearVaultState> | null {
    return {
      ...state,
      iouLpFeeBps: BigInt(event.args.lpFee.toString()),
      iouTreasuryFeeBps: BigInt(event.args.treasuryFee.toString()),
    };
  }

  protected handleTokenInitialized(
    event: any,
    state: DeepReadonly<ClearVaultState>,
  ): DeepReadonly<ClearVaultState> | null {
    const token = String(event.args.token).toLowerCase();
    const existing = state.tokens[token];
    return {
      ...state,
      tokens: {
        ...state.tokens,
        [token]: {
          enabled: true,
          decimals: existing?.decimals ?? 18,
          iou: String(event.args.iou).toLowerCase(),
          iouCurveMetaPool: String(event.args.iouCurveMetaPool).toLowerCase(),
          tokensCurvePoolIndex: existing?.tokensCurvePoolIndex ?? 0n,
          adapter: String(event.args.adapter).toLowerCase(),
          maxExposureBps: BigInt(event.args.maxExposureBps.toString()),
          desiredExposureBps: BigInt(event.args.desiredExposureBps.toString()),
          emitedIou: existing?.emitedIou ?? 0n,
          cachedAssets: existing?.cachedAssets ?? 0n,
        },
      },
    };
  }

  protected handleExposureUpdated(
    event: any,
    state: DeepReadonly<ClearVaultState>,
  ): DeepReadonly<ClearVaultState> | null {
    const token = String(event.args.token).toLowerCase();
    const t = state.tokens[token];
    if (!t) return null;
    return {
      ...state,
      tokens: {
        ...state.tokens,
        [token]: {
          ...t,
          desiredExposureBps: BigInt(
            event.args.newDesiredExposureBps.toString(),
          ),
          maxExposureBps: BigInt(event.args.newMaximalExposureBps.toString()),
        },
      },
    };
  }

  protected handleAdapterChanged(
    event: any,
    state: DeepReadonly<ClearVaultState>,
  ): DeepReadonly<ClearVaultState> | null {
    const token = String(event.args.token).toLowerCase();
    const t = state.tokens[token];
    if (!t) return null;
    return {
      ...state,
      tokens: {
        ...state.tokens,
        [token]: { ...t, adapter: String(event.args.newAdapter).toLowerCase() },
      },
    };
  }

  protected handleIouCurveMetaPoolUpdated(
    event: any,
    state: DeepReadonly<ClearVaultState>,
  ): DeepReadonly<ClearVaultState> | null {
    const token = String(event.args.token).toLowerCase();
    const t = state.tokens[token];
    if (!t) return null;
    return {
      ...state,
      tokens: {
        ...state.tokens,
        [token]: {
          ...t,
          iouCurveMetaPool: String(event.args.pool).toLowerCase(),
        },
      },
    };
  }
}

// Adjusts cachedAssets for a single token; returns null when the token is unknown.
function applyAssetsDelta(
  state: DeepReadonly<ClearVaultState>,
  tokenAddress: string,
  delta: bigint,
): DeepReadonly<ClearVaultState> | null {
  const token = tokenAddress.toLowerCase();
  const t = state.tokens[token];
  if (!t) return null;
  return {
    ...state,
    tokens: {
      ...state.tokens,
      [token]: { ...t, cachedAssets: t.cachedAssets + delta },
    },
  };
}

import { Interface } from '@ethersproject/abi';
import { DeepReadonly } from 'ts-essentials';

import { Log, Logger, Address } from '../../types';
import { catchParseLogError, currentBigIntTimestampInS } from '../../utils';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { IDexHelper } from '../../dex-helper';
import { MultiCallParams } from '../../lib/multi-wrapper';
import { uint256ToBigInt, booleanDecode } from '../../lib/decoders';

import {
  ClearProtocolState,
  AssetOracleState,
  OracleAdapterType,
  DexParams,
} from './types';
import { swapIface, oracleIface } from './clear-ifaces';

type Handler = (
  event: any,
  state: DeepReadonly<ClearProtocolState>,
  log: Readonly<Log>,
) => DeepReadonly<ClearProtocolState> | null;

export class ClearProtocolStateSubscriber extends StatefulEventSubscriber<ClearProtocolState> {
  addressesSubscribed: Address[];

  protected handlers: Record<string, Handler> = {};

  protected addressToInterface: Record<string, Interface> = {};

  protected swapAddressLower: string;
  protected oracleAddressLower: string;

  constructor(
    parentName: string,
    protected config: DexParams,
    protected dexHelper: IDexHelper,
    logger: Logger,
  ) {
    super(parentName, 'protocol', dexHelper, logger);

    this.swapAddressLower = config.swapAddress.toLowerCase();
    this.oracleAddressLower = config.oracleAddress.toLowerCase();

    this.addressesSubscribed = [config.swapAddress, config.oracleAddress];
    this.addressToInterface[this.swapAddressLower] = swapIface;
    this.addressToInterface[this.oracleAddressLower] = oracleIface;

    this.handlers['DepegTresholdUpdated'] =
      this.handleDepegTresholdUpdated.bind(this);
    this.handlers['Paused'] = this.handlePaused.bind(this);
    this.handlers['Unpaused'] = this.handleUnpaused.bind(this);
    this.handlers['ClearOracleRateChanged'] =
      this.handleClearOracleRateChanged.bind(this);
    this.handlers['OracleConfigured'] = this.handleOracleConfigured.bind(this);
  }

  protected processLog(
    state: DeepReadonly<ClearProtocolState>,
    log: Readonly<Log>,
  ): DeepReadonly<ClearProtocolState> | null {
    try {
      const iface = this.addressToInterface[log.address.toLowerCase()];
      if (!iface) return null;
      const event = iface.parseLog(log);
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
  ): Promise<DeepReadonly<ClearProtocolState>> {
    const swapCalls: MultiCallParams<bigint | boolean>[] = [
      {
        target: this.config.swapAddress,
        callData: swapIface.encodeFunctionData('depegThresholdBps'),
        decodeFunction: uint256ToBigInt,
      },
      {
        target: this.config.swapAddress,
        callData: swapIface.encodeFunctionData('maximalDepegThresholdBps'),
        decodeFunction: uint256ToBigInt,
      },
      {
        target: this.config.swapAddress,
        callData: swapIface.encodeFunctionData('paused'),
        decodeFunction: booleanDecode,
      },
    ];

    const swapResults = await this.dexHelper.multiWrapper.aggregate<
      bigint | boolean
    >(swapCalls, blockNumber);

    return {
      swap: {
        depegThresholdBps: swapResults[0] as bigint,
        maximalDepegThresholdBps: swapResults[1] as bigint,
        paused: swapResults[2] as boolean,
      },
      // Oracle entries are populated lazily by hydrateAssets().
      oracles: {},
    };
  }

  // Loads oracle config + current price for the given assets and merges into state.
  async hydrateAssets(assets: Address[], blockNumber: number): Promise<void> {
    const state = this.getState(blockNumber);
    if (!state) return;

    const unique = Array.from(new Set(assets.map(a => a.toLowerCase()))).filter(
      a => !state.oracles[a],
    );
    if (unique.length === 0) return;

    type DecodedOracleConfig = {
      enabled: boolean;
      assetDecimals: number;
      oracleDecimals: number;
      redemptionPrice: bigint;
      priceTTL: bigint;
      lastUpdateTimestamp: bigint;
      price: bigint;
      adapterType: number;
      adapter: Address;
    };

    const calls: MultiCallParams<DecodedOracleConfig | bigint>[] = [];
    for (const asset of unique) {
      calls.push({
        target: this.config.oracleAddress,
        callData: oracleIface.encodeFunctionData('oracleConfiguration', [
          asset,
        ]),
        decodeFunction: (result: any): DecodedOracleConfig => {
          const d = oracleIface.decodeFunctionResult(
            'oracleConfiguration',
            result,
          );
          return {
            enabled: Boolean(d[0]),
            assetDecimals: Number(d[1]),
            oracleDecimals: Number(d[2]),
            redemptionPrice: BigInt(d[3].toString()),
            priceTTL: BigInt(d[4].toString()),
            lastUpdateTimestamp: BigInt(d[5].toString()),
            price: BigInt(d[6].toString()),
            adapterType: Number(d[7]),
            adapter: String(d[8]).toLowerCase(),
          };
        },
      });
      calls.push({
        target: this.config.oracleAddress,
        callData: oracleIface.encodeFunctionData('getUSDPrice', [asset]),
        decodeFunction: uint256ToBigInt,
      });
    }

    const results = await this.dexHelper.multiWrapper.tryAggregate<
      DecodedOracleConfig | bigint
    >(false, calls, blockNumber);

    const newOracles: { [k: string]: AssetOracleState } = { ...state.oracles };
    for (let i = 0; i < unique.length; i++) {
      const asset = unique[i];
      const cfgRes = results[i * 2];
      const priceRes = results[i * 2 + 1];
      if (!cfgRes.success) continue;
      const cfg = cfgRes.returnData as DecodedOracleConfig;
      if (!cfg.enabled) continue;
      // getUSDPrice already returns the 8-decimal value; cfg.price is raw oracleDecimals
      // and must be normalized when used as a fallback.
      const normalizedPrice = priceRes.success
        ? (priceRes.returnData as bigint)
        : normalizeOraclePrice(cfg.price, cfg.oracleDecimals);
      newOracles[asset] = {
        enabled: cfg.enabled,
        assetDecimals: cfg.assetDecimals,
        oracleDecimals: cfg.oracleDecimals,
        redemptionPrice: cfg.redemptionPrice,
        // Stored price is normalized to 8 decimals (matches getUSDPrice).
        price: normalizedPrice,
        priceTTL: cfg.priceTTL,
        lastUpdateTimestamp: cfg.lastUpdateTimestamp,
        adapterType:
          cfg.adapterType === OracleAdapterType.CHAINLINK
            ? OracleAdapterType.CHAINLINK
            : OracleAdapterType.CUSTOM,
        adapter: cfg.adapter,
      };
    }

    this.setState(
      { ...state, oracles: newOracles },
      blockNumber,
      'protocol_hydrate',
    );
  }

  // Refresh USD prices for the given assets via multicall (used for Chainlink).
  async refreshPrices(assets: Address[], blockNumber: number): Promise<void> {
    const state = this.getState(blockNumber);
    if (!state) return;
    const lowered = assets
      .map(a => a.toLowerCase())
      .filter(a => state.oracles[a]?.enabled);
    if (lowered.length === 0) return;

    const calls: MultiCallParams<bigint>[] = lowered.map(asset => ({
      target: this.config.oracleAddress,
      callData: oracleIface.encodeFunctionData('getUSDPrice', [asset]),
      decodeFunction: uint256ToBigInt,
    }));

    const results = await this.dexHelper.multiWrapper.tryAggregate<bigint>(
      false,
      calls,
      blockNumber,
    );

    const newOracles: { [k: string]: AssetOracleState } = { ...state.oracles };
    let changed = false;
    const ts = currentBigIntTimestampInS();
    for (let i = 0; i < lowered.length; i++) {
      const r = results[i];
      if (!r.success) continue;
      const existing = newOracles[lowered[i]];
      if (existing.price === r.returnData) continue;
      newOracles[lowered[i]] = {
        ...existing,
        price: r.returnData,
        lastUpdateTimestamp: ts,
      };
      changed = true;
    }
    if (!changed) return;

    this.setState(
      { ...state, oracles: newOracles },
      blockNumber,
      'protocol_refresh',
    );
  }

  protected handleDepegTresholdUpdated(
    event: any,
    state: DeepReadonly<ClearProtocolState>,
  ): DeepReadonly<ClearProtocolState> | null {
    return {
      ...state,
      swap: {
        ...state.swap,
        depegThresholdBps: BigInt(event.args.depegThresholdBps.toString()),
        maximalDepegThresholdBps: BigInt(
          event.args.maximalDepegThresholdBps.toString(),
        ),
      },
    };
  }

  protected handlePaused(
    _event: any,
    state: DeepReadonly<ClearProtocolState>,
  ): DeepReadonly<ClearProtocolState> | null {
    if (state.swap.paused) return null;
    return { ...state, swap: { ...state.swap, paused: true } };
  }

  protected handleUnpaused(
    _event: any,
    state: DeepReadonly<ClearProtocolState>,
  ): DeepReadonly<ClearProtocolState> | null {
    if (!state.swap.paused) return null;
    return { ...state, swap: { ...state.swap, paused: false } };
  }

  protected handleClearOracleRateChanged(
    event: any,
    state: DeepReadonly<ClearProtocolState>,
    _log: Readonly<Log>,
  ): DeepReadonly<ClearProtocolState> | null {
    const asset = String(event.args.asset).toLowerCase();
    const existing = state.oracles[asset];
    if (!existing) return null;
    // Custom oracle prices are emitted in raw oracleDecimals; normalize to 8 to match getUSDPrice.
    const rawPrice = BigInt(event.args.price.toString());
    const price = normalizeOraclePrice(rawPrice, existing.oracleDecimals);
    return {
      ...state,
      oracles: {
        ...state.oracles,
        [asset]: {
          ...existing,
          price,
          lastUpdateTimestamp: currentBigIntTimestampInS(),
        },
      },
    };
  }

  protected handleOracleConfigured(
    event: any,
    state: DeepReadonly<ClearProtocolState>,
  ): DeepReadonly<ClearProtocolState> | null {
    const asset = String(event.args.asset).toLowerCase();
    const enabled = Boolean(event.args.enabled);
    if (!enabled) {
      const next = { ...state.oracles };
      delete next[asset];
      return { ...state, oracles: next };
    }
    const adapterType = Number(event.args.adapterType);
    const existing = state.oracles[asset];
    return {
      ...state,
      oracles: {
        ...state.oracles,
        [asset]: {
          enabled: true,
          assetDecimals: Number(event.args.assetDecimals),
          oracleDecimals: Number(event.args.oracleDecimals),
          redemptionPrice: BigInt(event.args.redemptionPrice.toString()),
          priceTTL: BigInt(event.args.priceTTL.toString()),
          adapterType:
            adapterType === OracleAdapterType.CHAINLINK
              ? OracleAdapterType.CHAINLINK
              : OracleAdapterType.CUSTOM,
          adapter: String(event.args.adapter).toLowerCase(),
          // Reconfigure preserves last known price; refresh resyncs.
          price: existing?.price ?? 0n,
          lastUpdateTimestamp: existing?.lastUpdateTimestamp ?? 0n,
        },
      },
    };
  }
}

// Convert a raw oracle answer to the 8-decimal convention used by ClearOracle.
function normalizeOraclePrice(price: bigint, oracleDecimals: number): bigint {
  if (oracleDecimals === 8) return price;
  if (oracleDecimals > 8) return price / 10n ** BigInt(oracleDecimals - 8);
  return price * 10n ** BigInt(8 - oracleDecimals);
}

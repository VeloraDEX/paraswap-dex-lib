import {
  Token,
  Address,
  ExchangePrices,
  PoolPrices,
  AdapterExchangeParam,
  SimpleExchangeParam,
  PoolLiquidity,
  Logger,
  NumberAsString,
  DexExchangeParam,
} from '../../types';
import { SwapSide, Network, NULL_ADDRESS } from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getBigIntPow, getDexKeysWithNetwork } from '../../utils';
import { IDex } from '../../dex/idex';
import { addressArrayDecode, uint8ToNumber } from '../../lib/decoders';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { WooFiV2Data, DexParams } from './types';
import { SimpleExchange } from '../simple-exchange';
import { WooFiV2Config, Adapters } from './config';
import { WooFiV2PollingPool } from './woo-fi-v2-pool';
import { WooFiV2Math } from './woo-fi-v2-math';
import { MIN_CONVERSION_RATE, WOO_FI_V2_GAS_COST } from './constants';
import { assert } from 'ts-essentials';
import { ethers } from 'ethers';
import { addressDecode } from '../../lib/decoders';
import { ifaces } from './utils';
import { StatePollingManager } from '../../lib/stateful-rpc-poller/state-polling-manager';
import { extractReturnAmountPosition } from '../../executor/utils';

export class WooFiV2 extends SimpleExchange implements IDex<WooFiV2Data> {
  readonly math: WooFiV2Math;

  protected pollingManager: StatePollingManager;

  protected pollingPool?: WooFiV2PollingPool;

  readonly hasConstantPriceLargeAmounts = false;
  readonly needWrapNative = true;

  readonly isFeeOnTransferSupported = false;

  readonly isStatePollingDex = true;

  readonly quoteTokenAddress: Address;

  protected _baseTokens?: Token[];

  // Since exchange anyways takes fee, we provide our fee wallet
  // to take part of that fee and move to DAO
  protected rebateTo?: Address;

  tokenByAddress?: Record<Address, Token>;

  vaultUSDBalance: number = 0;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(WooFiV2Config);

  logger: Logger;

  constructor(
    protected network: Network,
    dexKey: string,
    readonly dexHelper: IDexHelper,
    protected adapters = Adapters[network] || {},
    readonly config = WooFiV2Config[dexKey][network],
  ) {
    super(dexHelper, dexKey);
    const loggerName = `${dexKey}-${network}`;
    this.logger = dexHelper.getLogger(loggerName);

    // Normalise once all config addresses and use across all scenarios
    this.config = this._toLowerForAllConfigAddresses();

    this.quoteTokenAddress = this.config.quoteToken.address;

    // Do not do it singleton, because different networks will have different
    // states at the same time
    this.math = new WooFiV2Math(
      dexHelper.getLogger(`${loggerName}_math`),
      this.quoteTokenAddress,
    );
    this.pollingManager = StatePollingManager.getInstance(dexHelper);
  }

  private _toLowerForAllConfigAddresses() {
    // If new config property will be added, the TS will throw compile error
    const newConfig: DexParams = {
      wooPPV2Address: this.config.wooPPV2Address.toLowerCase(),
      wooOracleV2Address: this.config.wooOracleV2Address.toLowerCase(),
      integrationHelperAddress:
        this.config.integrationHelperAddress.toLowerCase(),
      quoteToken: {
        ...this.config.quoteToken,
        address: this.config.quoteToken.address.toLowerCase(),
      },
    };
    return newConfig;
  }

  get baseTokens(): Token[] {
    if (!this._baseTokens) {
      throw new Error(
        `Base tokens are not set for ${this.dexKey}-${this.network}. Not properly initialized`,
      );
    }
    return this._baseTokens;
  }

  async initializePricing(blockNumber: number) {
    await this.initializeTokensAndAddresses();
    this._initializePollingPool();
  }

  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return this.adapters[side] ? this.adapters[side] : null;
  }

  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    if (side === SwapSide.BUY) return [];

    if (this.tokenByAddress === undefined) {
      this.logger.error(`tokenByAddress is undefined in getPoolIdentifiers`);
      return [];
    }

    const _srcToken = this.dexHelper.config.wrapETH(srcToken);
    const _destToken = this.dexHelper.config.wrapETH(destToken);

    const _srcAddress = _srcToken.address.toLowerCase();
    const _destAddress = _destToken.address.toLowerCase();

    if (_srcAddress === _destAddress) return [];

    if (
      !this.tokenByAddress[_srcAddress] ||
      !this.tokenByAddress[_destAddress]
    ) {
      return [];
    }

    return [this.getIdentifier()];
  }

  getIdentifier() {
    return `${this.dexKey}_wooppv2`;
  }

  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<WooFiV2Data>> {
    if (side === SwapSide.BUY) return null;

    try {
      if (this.tokenByAddress === undefined) {
        this.logger.error(`tokenByAddress is undefined in getPricesVolume`);
        return null;
      }

      const _srcToken = this.dexHelper.config.wrapETH(srcToken);
      const _destToken = this.dexHelper.config.wrapETH(destToken);

      const _srcAddress = _srcToken.address.toLowerCase();
      const _destAddress = _destToken.address.toLowerCase();

      if (_srcAddress === _destAddress) return null;

      if (
        !this.tokenByAddress[_srcAddress] ||
        !this.tokenByAddress[_destAddress]
      )
        return null;

      const expectedIdentifier = this.getIdentifier();

      if (
        limitPools !== undefined &&
        !limitPools.some(p => p === expectedIdentifier)
      )
        return null;

      const unitVolume = getBigIntPow(_srcToken.decimals);

      const _amounts = [unitVolume, ...amounts.slice(1)];

      assert(
        this.pollingPool,
        'pollingPool is not initialized in getPricesVolume',
      );

      const state = await this.pollingPool.getState(blockNumber);

      if (state === null) {
        this.logger.error(`State is null in getPricesVolume`);
        return null;
      }

      if (state.value.isPaused) {
        this.logger.warn(
          `${this.dexKey} is paused on ${this.network} in getPricesVolume`,
        );
        return null;
      }

      this.math.state = state.value;

      const _prices = this.math.query(_srcAddress, _destAddress, _amounts);

      if (!_prices) return null;

      const unit = _prices[0];

      let gasCost = WOO_FI_V2_GAS_COST.baseToBase;
      if (_srcAddress === this.config.quoteToken.address) {
        gasCost = WOO_FI_V2_GAS_COST.sellQuote;
      } else if (_destAddress === this.config.quoteToken.address) {
        gasCost = WOO_FI_V2_GAS_COST.sellBase;
      }

      return [
        {
          unit,
          prices: [0n, ..._prices.slice(1)],
          data: {},
          poolIdentifier: expectedIdentifier,
          exchange: this.dexKey,
          gasCost,
          poolAddresses: [this.config.wooPPV2Address],
        },
      ];
    } catch (e) {
      this.logger.error(
        `Error_getPricesVolume ${srcToken.symbol || srcToken.address}, ${
          destToken.symbol || destToken.address
        }, ${side}:`,
        e,
      );
      return null;
    }
  }

  getCalldataGasCost(poolPrices: PoolPrices<WooFiV2Data>): number | number[] {
    return CALLDATA_GAS_COST.DEX_OVERHEAD + CALLDATA_GAS_COST.ADDRESS;
  }

  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: WooFiV2Data,
    side: SwapSide,
  ): AdapterExchangeParam {
    if (side === SwapSide.BUY) throw new Error(`Buy not supported`);

    let rebateTo = this.rebateTo;
    if (rebateTo === undefined) {
      this.logger.error(`rebateTo is undefined in getAdapterParam`);
      rebateTo = NULL_ADDRESS;
    }

    const payload = this.abiCoder.encodeParameter('address', rebateTo);

    return {
      targetExchange: this.config.wooPPV2Address,
      payload,
      networkFee: '0',
    };
  }

  async getSimpleParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: WooFiV2Data,
    side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    if (side === SwapSide.BUY) throw new Error(`Buy not supported`);

    const _srcToken = srcToken.toLowerCase();
    const _destToken = destToken.toLowerCase();

    let rebateTo = this.rebateTo;
    if (rebateTo === undefined) {
      this.logger.error(`rebateTo is undefined in getAdapterParam`);
      rebateTo = NULL_ADDRESS;
    }

    const swapData = ifaces.PPV2.encodeFunctionData('swap', [
      _srcToken,
      _destToken,
      srcAmount,
      MIN_CONVERSION_RATE,
      this.augustusAddress,
      rebateTo,
    ]);

    const transferParams = this.erc20Interface.encodeFunctionData('transfer', [
      this.config.wooPPV2Address,
      srcAmount,
    ]);

    return {
      callees: [srcToken, this.config.wooPPV2Address],
      calldata: [transferParams, swapData],
      values: ['0', '0'],
      networkFee: '0',
    };
  }

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

    let rebateTo = this.rebateTo;
    if (rebateTo === undefined) {
      this.logger.error(`rebateTo is undefined in getDexParam`);
      rebateTo = NULL_ADDRESS;
    }

    const swapData = ifaces.PPV2.encodeFunctionData('swap', [
      _srcToken,
      _destToken,
      srcAmount,
      MIN_CONVERSION_RATE,
      recipient,
      // this.augustusAddress,
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

  async updatePoolState(): Promise<void> {
    if (this._baseTokens === undefined || this.tokenByAddress === undefined) {
      await this.initializeTokensAndAddresses();
    }
    if (this.pollingPool === undefined) {
      this._initializePollingPool();
    }

    if (this.tokenByAddress === undefined) {
      this.logger.error(`tokenByAddress is undefined in updatePoolState`);
      return;
    }

    assert(
      this.pollingPool,
      'pollingPool is not initialized in updatePoolState',
    );
    const state = await this.pollingPool.getState();

    if (!state) {
      this.logger.error(
        `Failed to updatePoolState. State is null. VaultUSDBalance: ${this.vaultUSDBalance} was not updated`,
      );
      return;
    }

    const tokenBalancesUSD = await Promise.all(
      Object.values(this.tokenByAddress).map(t =>
        this.dexHelper.getTokenUSDPrice(
          t,
          state.value.tokenInfos[t.address].reserve,
        ),
      ),
    );
    this.vaultUSDBalance = tokenBalancesUSD.reduce(
      (sum: number, curr: number) => sum + curr,
    );
  }

  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    const wrappedTokenAddress = this.dexHelper.config
      .wrapETH({ address: tokenAddress, decimals: 0 })
      .address.toLowerCase();

    if (this.tokenByAddress === undefined) {
      this.logger.error(`tokenByAddress is undefined in getTopPoolsForToken`);
      return [];
    }

    if (!this.tokenByAddress[wrappedTokenAddress]) return [];

    assert(
      this.pollingPool,
      'pollingPool is not initialized in getTopPoolsForToken',
    );
    const latestState = await this.pollingPool.getState();
    if (!latestState) return [];

    if (latestState.value.isPaused) {
      this.logger.warn(`Paused on ${this.network} in getTopPoolsForToken`);
      return [];
    }

    const connectorTokens = Object.values(this.tokenByAddress).filter(
      t => t.address !== wrappedTokenAddress,
    );

    return [
      {
        exchange: this.dexKey,
        address: this.config.wooPPV2Address,
        connectorTokens,
        liquidityUSD: this.vaultUSDBalance,
      },
    ];
  }

  private _initializeTokenByAddress(baseTokens: Token[]) {
    this.tokenByAddress = baseTokens.reduce(
      (acc, cur) => {
        acc[cur.address] = cur;
        return acc;
      },
      { [this.quoteTokenAddress]: this.config.quoteToken },
    );
  }

  async _fetchBaseTokensAndFeeWallet(): Promise<Address[]> {
    return (
      await this.dexHelper.multiWrapper.aggregate([
        {
          target: this.augustusAddress,
          callData: this.augustusInterface.encodeFunctionData(
            'getFeeWallet',
            [],
          ),
          decodeFunction: addressDecode,
        },
        {
          target: this.config.integrationHelperAddress,
          callData:
            ifaces.integrationHelper.encodeFunctionData('allBaseTokens'),
          decodeFunction: addressArrayDecode,
        },
      ])
    ).flat();
  }

  async _fetchDecimals(baseTokenAddresses: Address[]): Promise<number[]> {
    return this.dexHelper.multiWrapper.aggregate(
      baseTokenAddresses.map(address => {
        return {
          target: address,
          callData: this.erc20Interface.encodeFunctionData('decimals'),
          decodeFunction: uint8ToNumber,
        };
      }),
    );
  }

  async initializeTokensAndAddresses() {
    const [rebateTo, ...baseTokenAddresses] =
      await this._fetchBaseTokensAndFeeWallet();

    assert(ethers.utils.isAddress(rebateTo), 'Invalid rebateTo address');

    this.rebateTo = rebateTo;
    const decimals = await this._fetchDecimals(baseTokenAddresses);

    assert(
      decimals.length === baseTokenAddresses.length,
      'Decimals length mismatch',
    );

    this._baseTokens = baseTokenAddresses.reduce<Token[]>((acc, curr, i) => {
      acc.push({
        address: curr,
        decimals: decimals[i],
      });
      return acc;
    }, []);

    this._initializeTokenByAddress(this.baseTokens);
  }

  private _initializePollingPool() {
    assert(this.tokenByAddress, 'tokenByAddress is not properly');

    this.pollingPool = new WooFiV2PollingPool(
      this.dexKey,
      this.getIdentifier(),
      this.dexHelper,
      this.config,
      this.baseTokens,
    );

    this.pollingManager.initializeAllPendingPools();
  }
}

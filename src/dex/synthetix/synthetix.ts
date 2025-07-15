import _ from 'lodash';
import { AsyncOrSync } from 'ts-essentials';
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
import { SwapSide, Network } from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getBigIntPow, getDexKeysWithNetwork, _require } from '../../utils';
import { IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { DexParams, SynthetixData } from './types';
import { SimpleExchange } from '../simple-exchange';
import { SynthetixConfig, Adapters } from './config';
import { Interface } from '@ethersproject/abi';
import {
  STATE_TTL_IN_MS,
  SYNTHETIX_GAS_COST_WITHOUT_SUSD,
  SYNTHETIX_GAS_COST_WITH_SUSD,
} from './constants';
import { synthetixMath } from './contract-math/synthetix-math';
import { SynthetixState } from './synthetix-state';
// There are so many ABIs, where I need only one or two functions
// So, I decided to unite them into one combined interface
import CombinedSynthetixABI from '../../abi/synthetix/CombinedSynthetix.abi.json';
import { extractReturnAmountPosition } from '../../executor/utils';

export class Synthetix extends SimpleExchange implements IDex<SynthetixData> {
  readonly hasConstantPriceLargeAmounts = false;
  readonly needWrapNative = true;
  readonly isFeeOnTransferSupported = false;

  readonly combinedIface: Interface;

  logger: Logger;

  synthetixState: SynthetixState;

  // It is intermediate measure before we have event base Oracles
  statePollingTimer?: NodeJS.Timeout;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(SynthetixConfig);

  constructor(
    readonly network: Network,
    dexKey: string,
    readonly dexHelper: IDexHelper,
    protected adapters = Adapters[network] || {},
    readonly config = SynthetixConfig[dexKey][network],
  ) {
    super(dexHelper, dexKey);
    this.config = this.normalizeConfig(this.config);
    this.logger = dexHelper.getLogger(dexKey);
    this.combinedIface = new Interface(CombinedSynthetixABI);
    this.synthetixState = new SynthetixState(
      this.dexKey,
      this.dexHelper,
      this.combinedIface,
      this.config,
    );
  }

  get multiWrapper() {
    return this.dexHelper.multiWrapper;
  }

  private normalizeConfig(config: DexParams): DexParams {
    return {
      readProxyAddressResolver: config.readProxyAddressResolver.toLowerCase(),
      flexibleStorage: config.flexibleStorage.toLowerCase(),
      synths: config.synths.map(s => {
        s.address = s.address.toLowerCase();
        return s;
      }),
      sUSDAddress: config.sUSDAddress.toLowerCase(),
      trackingCode: config.trackingCode.toLowerCase(),
    };
  }

  get onchainConfigValues() {
    return this.synthetixState.onchainConfigValues;
  }

  async initializePricing(blockNumber: number) {
    if (this.synthetixState.onchainConfigValuesWithUndefined === undefined) {
      await this.synthetixState.updateOnchainConfigValues(blockNumber);
    }
    if (!this.statePollingTimer) {
      await this.synthetixState.updateOnchainState();
      this.statePollingTimer = setInterval(async () => {
        try {
          await this.synthetixState.updateOnchainState();
          this.logger.info(
            `${this.dexKey}: onchain state was updated for network=${this.network}`,
          );
        } catch (e) {
          this.logger.error(
            `${this.dexKey}: Failed to update onchain state: `,
            e,
          );
        }
      }, STATE_TTL_IN_MS);
    }
  }

  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return this.adapters[side] ? this.adapters[side] : null;
  }

  getPoolIdentifier(src: Address, dest: Address) {
    return `${this.dexKey}_${src}_${dest}`.toLowerCase();
  }

  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    if (side === SwapSide.BUY) return [];

    const _srcAddress = this.dexHelper.config
      .wrapETH(srcToken)
      .address.toLowerCase();
    const _destAddress = this.dexHelper.config
      .wrapETH(destToken)
      .address.toLowerCase();

    if (_srcAddress === _destAddress) return [];

    if (
      this.onchainConfigValues.addressToKey[_srcAddress] !== undefined &&
      this.onchainConfigValues.addressToKey[_destAddress] !== undefined
    ) {
      return [this.getPoolIdentifier(_srcAddress, _destAddress)];
    }

    return [];
  }

  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<SynthetixData>> {
    try {
      const _srcToken = this.dexHelper.config.wrapETH(srcToken);
      const _destToken = this.dexHelper.config.wrapETH(destToken);

      const _srcAddress = _srcToken.address.toLowerCase();
      const _destAddress = _destToken.address.toLowerCase();

      if (_srcAddress === _destAddress) return null;

      if (
        this.onchainConfigValues.addressToKey[_srcAddress] === undefined ||
        this.onchainConfigValues.addressToKey[_destAddress] === undefined
      )
        return null;

      const currentIdentifier = this.getPoolIdentifier(
        _srcAddress,
        _destAddress,
      );

      // If we received limitPools, but there is not currentIdentifier, we should return null
      // because we don't have that pool to fulfill the request
      if (limitPools !== undefined && !limitPools.includes(currentIdentifier)) {
        return null;
      }

      const unitVolume = getBigIntPow(_srcToken.decimals);

      const _amounts = [unitVolume, ...amounts.slice(1)];

      const isOptimism = this.network === Network.OPTIMISM;

      let state = this.synthetixState.getState();

      if (!state) {
        this.logger.error(
          `${this.dexKey} couldn't receive valid state. Pricing is not working. Check logs`,
        );
        return null;
      }

      if (
        state.isSystemSuspended ||
        state.isExchangeSuspended ||
        state.areSynthsSuspended[_srcAddress] ||
        state.areSynthsSuspended[_destAddress]
      ) {
        return null;
      }

      const prices = _amounts.map(amount =>
        // For there is different pricing logic
        isOptimism
          ? synthetixMath.getAmountsForExchange(
              state!,
              amount,
              this.onchainConfigValues!.addressToKey[_srcAddress],
              this.onchainConfigValues!.addressToKey[_destAddress],
            )
          : synthetixMath.getAmountsForAtomicExchange(
              state!,
              amount,
              this.onchainConfigValues!.addressToKey[_srcAddress],
              this.onchainConfigValues!.addressToKey[_destAddress],
            ),
      );

      const isSUSDInRoute =
        _srcAddress === this.config.sUSDAddress ||
        _destAddress === this.config.sUSDAddress;

      return [
        {
          unit: prices[0],
          prices: [0n, ...prices.slice(1)],
          data: {
            exchange: this.onchainConfigValues.synthetixAddress,
            srcKey: this.onchainConfigValues.addressToKey[_srcAddress],
            destKey: this.onchainConfigValues.addressToKey[_destAddress],
            exchangeType: isOptimism ? 1 : 0,
          },
          poolIdentifier: currentIdentifier,
          exchange: this.dexKey,
          gasCost: isSUSDInRoute
            ? SYNTHETIX_GAS_COST_WITH_SUSD
            : SYNTHETIX_GAS_COST_WITHOUT_SUSD,
          poolAddresses: [this.onchainConfigValues.synthetixAddress],
        },
      ];
    } catch (e) {
      this.logger.error(
        `${this.dexKey} error: getPricesVolume ${
          srcToken.symbol || srcToken.address
        }, ${destToken.symbol || destToken.address}, ${side}: `,
        e,
      );
      return null;
    }
  }

  // Returns estimated gas cost of calldata for this DEX in multiSwap
  getCalldataGasCost(poolPrices: PoolPrices<SynthetixData>): number | number[] {
    return (
      CALLDATA_GAS_COST.DEX_OVERHEAD +
      CALLDATA_GAS_COST.LENGTH_SMALL +
      CALLDATA_GAS_COST.wordNonZeroBytes(8) +
      CALLDATA_GAS_COST.FULL_WORD +
      CALLDATA_GAS_COST.FULL_WORD +
      CALLDATA_GAS_COST.wordNonZeroBytes(1)
    );
  }

  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: SynthetixData,
    side: SwapSide,
  ): AdapterExchangeParam {
    const { exchange, srcKey, destKey, exchangeType } = data;

    const payload = this.abiCoder.encodeParameter(
      'tuple(bytes32 trackingCode, bytes32 srcCurrencyKey, bytes32 destCurrencyKey, int8 exchangeType)',
      [this.config.trackingCode, srcKey, destKey, exchangeType],
    );

    return {
      targetExchange: exchange,
      payload,
      networkFee: '0',
    };
  }

  async getSimpleParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: SynthetixData,
    side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    if (side === SwapSide.BUY) throw new Error(`Buy not supported`);

    const { exchange, srcKey, destKey } = data;

    const swapData =
      this.network === Network.OPTIMISM
        ? this.combinedIface.encodeFunctionData('exchange', [
            srcKey,
            srcAmount,
            destKey,
          ])
        : this.combinedIface.encodeFunctionData('exchangeAtomically', [
            srcKey,
            srcAmount,
            destKey,
            this.config.trackingCode,
            '1',
          ]);

    return this.buildSimpleParamWithoutWETHConversion(
      srcToken,
      srcAmount,
      destToken,
      destAmount,
      swapData,
      exchange,
    );
  }

  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: SynthetixData,
    side: SwapSide,
  ): DexExchangeParam {
    if (side === SwapSide.BUY) throw new Error(`Buy not supported`);

    const { exchange, srcKey, destKey } = data;

    const swapData =
      this.network === Network.OPTIMISM
        ? this.combinedIface.encodeFunctionData('exchange', [
            srcKey,
            srcAmount,
            destKey,
          ])
        : this.combinedIface.encodeFunctionData('exchangeAtomically', [
            srcKey,
            srcAmount,
            destKey,
            this.config.trackingCode,
            '1',
          ]);

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: false,
      exchangeData: swapData,
      targetExchange: exchange,
      returnAmountPos:
        side === SwapSide.SELL
          ? extractReturnAmountPosition(
              this.combinedIface,
              this.network === Network.OPTIMISM
                ? 'exchange'
                : 'exchangeAtomically',
              'amountReceived',
            )
          : undefined,
    };
  }

  async updatePoolState(): Promise<void> {
    try {
      await this.synthetixState.updateOnchainConfigValues();
    } catch (e) {
      this.logger.error(
        `${this.dexKey}: Failed to update onchain config values: `,
        e,
      );
      throw e;
    }
  }

  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    const _tokenAddress = tokenAddress.toLowerCase();

    if (this.onchainConfigValues.addressToKey[_tokenAddress] === undefined) {
      return [];
    }

    if (
      this.onchainConfigValues.isSystemSuspended ||
      this.onchainConfigValues.isExchangeSuspended ||
      this.onchainConfigValues.areSynthsSuspended[_tokenAddress]
    ) {
      return [];
    }

    return [
      {
        exchange: this.dexKey,
        address: this.onchainConfigValues.synthetixAddress,
        connectorTokens: this.config.synths.filter(
          s => s.address !== _tokenAddress,
        ),
        // liquidityUSD: this.onchainConfigValues.liquidityEstimationInUSD,
        // current supply is around 20-40m USD which is not how much we can trade
        // so use low hardcoded value
        liquidityUSD: 100_000,
      },
    ];
  }

  releaseResources(): AsyncOrSync<void> {
    if (this.statePollingTimer) {
      clearInterval(this.statePollingTimer);
      this.statePollingTimer = undefined;
      this.logger.info(
        `${this.dexKey}: cleared statePollingTimer timer before shutting down`,
      );
    }
  }
}

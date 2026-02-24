import {
  Address,
  NumberAsString,
  OptimalSwapExchange,
  SwapSide,
} from '@paraswap/core';
import { assert, AsyncOrSync } from 'ts-essentials';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { ETHER_ADDRESS, Network, NULL_ADDRESS } from '../../constants';
import { IDexHelper } from '../../dex-helper';
import {
  AdapterExchangeParam,
  DexExchangeParam,
  ExchangePrices,
  ExchangeTxInfo,
  Logger,
  PoolLiquidity,
  PoolPrices,
  PreprocessTransactionOptions,
  Token,
  TransferFeeParams,
} from '../../types';
import { getDexKeysWithNetwork } from '../../utils';
import { IDex } from '../idex';
import { SimpleExchangeWithRestrictions } from '../simple-exchange-with-restrictions';
import { CablesConfig } from './config';
import {
  CABLES_API_BLACKLIST_POLLING_INTERVAL_MS,
  CABLES_API_PAIRS_POLLING_INTERVAL_MS,
  CABLES_API_PRICES_POLLING_INTERVAL_MS,
  CABLES_API_TOKENS_POLLING_INTERVAL_MS,
  CABLES_API_URL,
  CABLES_BLACKLIST_CACHES_TTL_S,
  CABLES_FIRM_QUOTE_TIMEOUT_MS,
  CABLES_GAS_COST,
  CABLES_PAIRS_CACHES_TTL_S,
  CABLES_PRICES_CACHES_TTL_S,
  CABLES_TOKENS_CACHES_TTL_S,
} from './constants';
import { CablesRateFetcher } from './rate-fetcher';
import { CablesData, CablesRFQResponse } from './types';
import { BlacklistError, SlippageCheckError } from '../generic-rfq/types';
import mainnetRFQAbi from '../../abi/cables/CablesMainnetRFQ.json';
import { Interface } from 'ethers/lib/utils';
import BigNumber from 'bignumber.js';
import { ethers } from 'ethers';
import { BI_MAX_UINT256 } from '../../bigint-constants';
import { BebopData } from '../bebop/types';

export class Cables
  extends SimpleExchangeWithRestrictions
  implements IDex<any>
{
  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(CablesConfig);

  readonly isStatePollingDex = true;

  private readonly rateFetcher: CablesRateFetcher;

  logger: Logger;
  private tokensMap: { [address: string]: Token } = {};

  hasConstantPriceLargeAmounts: boolean = false;

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
    readonly mainnetRFQAddress: string = CablesConfig['Cables'][network]
      .mainnetRFQAddress,
    protected rfqInterface = new Interface(mainnetRFQAbi),
  ) {
    super(dexHelper, dexKey, {
      blacklistedTTL: CABLES_BLACKLIST_CACHES_TTL_S,
      enableDexRestriction: true,
    });
    this.logger = dexHelper.getLogger(`${dexKey}-${network}`);

    this.rateFetcher = new CablesRateFetcher(
      this.dexHelper,
      this.dexKey,
      this.network,
      this.logger,
      {
        rateConfig: {
          pairsReqParams: {
            url: CABLES_API_URL + '/pairs',
          },
          pricesReqParams: {
            url: CABLES_API_URL + '/prices',
          },
          blacklistReqParams: {
            url: CABLES_API_URL + '/blacklist',
          },
          tokensReqParams: {
            url: CABLES_API_URL + '/tokens',
          },

          pricesIntervalMs: CABLES_API_PRICES_POLLING_INTERVAL_MS,
          pricesCacheTTLSecs: CABLES_PRICES_CACHES_TTL_S,
          pricesCacheKey: 'prices',

          pairsIntervalMs: CABLES_API_PAIRS_POLLING_INTERVAL_MS,
          pairsCacheTTLSecs: CABLES_PAIRS_CACHES_TTL_S,
          pairsCacheKey: 'pairs',

          tokensIntervalMs: CABLES_API_TOKENS_POLLING_INTERVAL_MS,
          tokensCacheTTLSecs: CABLES_TOKENS_CACHES_TTL_S,
          tokensCacheKey: 'tokens',

          blacklistIntervalMs: CABLES_API_BLACKLIST_POLLING_INTERVAL_MS,
          setBlacklist: this.setBlacklist.bind(this),
        },
      },
    );
  }

  async preProcessTransaction(
    optimalSwapExchange: OptimalSwapExchange<CablesData>,
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    options: PreprocessTransactionOptions,
  ): Promise<[OptimalSwapExchange<CablesData>, ExchangeTxInfo]> {
    if (await this.isBlacklisted(options.txOrigin)) {
      this.logger.warn(
        `${this.dexKey}-${this.network}: blacklisted TX Origin address '${options.txOrigin}' trying to build a transaction. Bailing...`,
      );
      throw new BlacklistError(this.dexKey, this.network, options.txOrigin);
    }

    if (BigInt(optimalSwapExchange.srcAmount) === 0n) {
      throw new Error('getFirmRate failed with srcAmount === 0');
    }

    const normalizedSrcToken = this.normalizeToken(srcToken);
    const normalizedDestToken = this.normalizeToken(destToken);
    const swapIdentifier = `${this.dexKey}_${normalizedSrcToken.address}_${normalizedDestToken.address}_${side}`;

    try {
      let makerToken = normalizedDestToken;
      let takerToken = normalizedSrcToken;

      const isSell = side === SwapSide.SELL;
      const isBuy = side === SwapSide.BUY;

      const rfqParams = {
        makerAsset: ethers.utils.getAddress(makerToken.address),
        takerAsset: ethers.utils.getAddress(takerToken.address),
        ...(isBuy && { makerAmount: optimalSwapExchange.destAmount }),
        ...(isSell && { takerAmount: optimalSwapExchange.srcAmount }),
        userAddress: options.executionContractAddress,
        chainId: String(this.network),
      };

      const rfq: CablesRFQResponse = await this.dexHelper.httpRequest.post(
        `${CABLES_API_URL}/quote`,
        rfqParams,
        CABLES_FIRM_QUOTE_TIMEOUT_MS,
      );

      if (!rfq) {
        throw new Error(
          'Failed to fetch RFQ' +
            swapIdentifier +
            JSON.stringify(rfq + 'params' + rfqParams),
        );
      }

      const { order } = rfq;

      assert(
        order.makerAsset.toLowerCase() === makerToken.address,
        `QuoteData makerAsset=${order.makerAsset} is different from Paraswap makerAsset=${makerToken.address}`,
      );
      assert(
        order.takerAsset.toLowerCase() === takerToken.address,
        `QuoteData takerAsset=${order.takerAsset} is different from Paraswap takerAsset=${takerToken.address}`,
      );
      if (isSell) {
        assert(
          order.takerAmount === optimalSwapExchange.srcAmount,
          `QuoteData takerAmount=${order.takerAmount} is different from Paraswap srcAmount=${optimalSwapExchange.srcAmount}`,
        );
      } else {
        assert(
          order.makerAmount === optimalSwapExchange.destAmount,
          `QuoteData makerAmount=${order.makerAmount} is different from Paraswap destAmount=${optimalSwapExchange.destAmount}`,
        );
      }

      const expiryAsBigInt = BigInt(order.expiry);
      const minDeadline = expiryAsBigInt > 0 ? expiryAsBigInt : BI_MAX_UINT256;

      if (side === SwapSide.BUY) {
        const requiredAmount = optimalSwapExchange.srcAmount;
        const quoteAmount = order.takerAmount;

        const requiredAmountWithSlippage = new BigNumber(requiredAmount)
          .multipliedBy(options.slippageFactor)
          .toFixed(0);

        if (BigInt(quoteAmount) > BigInt(requiredAmountWithSlippage)) {
          throw new SlippageCheckError(
            this.dexKey,
            this.network,
            side,
            requiredAmountWithSlippage,
            quoteAmount,
            options.slippageFactor,
          );
        }
      } else {
        const requiredAmount = optimalSwapExchange.destAmount;
        const quoteAmount = order.makerAmount;

        const requiredAmountWithSlippage = new BigNumber(requiredAmount)
          .multipliedBy(options.slippageFactor)
          .toFixed(0);

        if (BigInt(quoteAmount) < BigInt(requiredAmountWithSlippage)) {
          throw new SlippageCheckError(
            this.dexKey,
            this.network,
            side,
            requiredAmountWithSlippage,
            quoteAmount,
            options.slippageFactor,
          );
        }
      }

      return [
        {
          ...optimalSwapExchange,
          data: {
            quoteData: order,
          },
        },
        { deadline: minDeadline },
      ];
    } catch (e: any) {
      const message = `${this.dexKey}-${this.network}: ${e}`;

      this.logger.error(message);
      if (!e?.isSlippageError) {
        this.restrict();
      }
      throw new Error(message);
    }
  }

  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: BebopData,
    side: SwapSide,
  ): AdapterExchangeParam {
    return {
      targetExchange: this.mainnetRFQAddress,
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
    data: CablesData,
    side: SwapSide,
  ): DexExchangeParam {
    const { quoteData } = data;

    assert(
      quoteData !== undefined,
      `${this.dexKey}-${this.network}: quoteData undefined`,
    );

    const swapFunction = 'partialSwap';
    const swapFunctionParams = [
      [
        quoteData.nonceAndMeta,
        quoteData.expiry,
        quoteData.makerAsset,
        quoteData.takerAsset,
        quoteData.maker,
        quoteData.taker,
        quoteData.makerAmount,
        quoteData.takerAmount,
      ],
      quoteData.signature,
      // might be overwritten on Executors
      quoteData.takerAmount,
    ];

    const exchangeData = this.rfqInterface.encodeFunctionData(
      swapFunction,
      swapFunctionParams,
    );

    const fromAmount = ethers.utils.defaultAbiCoder.encode(
      ['uint256'],
      [quoteData.takerAmount],
    );

    const filledAmountIndex = exchangeData
      .replace('0x', '')
      .lastIndexOf(fromAmount.replace('0x', ''));

    const filledAmountPos =
      (filledAmountIndex !== -1 ? filledAmountIndex : exchangeData.length) / 2;

    return {
      exchangeData,
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: false,
      targetExchange: this.mainnetRFQAddress,
      returnAmountPos: undefined,
      insertFromAmountPos: filledAmountPos,
      sendEthButSupportsInsertFromAmount: true,
    };
  }

  normalizeToken(token: Token): Token {
    return {
      ...token,
      address: this.normalizeTokenAddress(token.address),
    };
  }

  normalizeTokenAddress(address: Address): Address {
    return address.toLowerCase();
  }

  getTokenFromAddress(address: Address): Token {
    return this.tokensMap[this.normalizeAddress(address)];
  }

  getPoolIdentifier(srcAddress: Address, destAddress: Address) {
    return `${this.dexKey}_${srcAddress}_${destAddress}`.toLowerCase();
  }

  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    if (!srcToken || !destToken) {
      return [];
    }

    if (srcToken.address.toLowerCase() === destToken.address.toLowerCase()) {
      return [];
    }

    const normalizedSrcToken = this.normalizeToken(srcToken);
    const normalizedDestToken = this.normalizeToken(destToken);

    const pairData = await this.getPairData(
      normalizedSrcToken,
      normalizedDestToken,
    );

    if (!pairData) {
      return [];
    }

    return [
      this.getPoolIdentifier(
        normalizedSrcToken.address,
        normalizedDestToken.address,
      ),
    ];
  }

  calculateOrderPrice(
    amounts: bigint[],
    orderbook: string[][],
    baseToken: Token,
    quoteToken: Token,
    isInputQuote: boolean,
  ) {
    let result = [];

    for (let i = 0; i < amounts.length; i++) {
      let amt = amounts[i];
      if (amt === 0n) {
        result.push(amt);
        continue;
      }

      let decimals = baseToken.decimals;
      let out_decimals = quoteToken.decimals;

      let price = 0;

      try {
        price = this.calculatePriceSwap(
          orderbook,
          Number(amt) / 10 ** decimals,
          isInputQuote,
        );
      } catch {}
      result.push(BigInt(Math.round(price * 10 ** out_decimals)));
    }
    return result;
  }

  calculatePriceSwap(
    prices: string[][],
    requiredQty: number,
    qtyMode: Boolean,
  ) {
    let sumBaseQty = 0;
    let sumQuoteQty = 0;

    const selectedRows: string[][] = [];

    const isBase = qtyMode;
    const isQuote = !qtyMode;

    const totalVolume: number = prices.reduce(
      (sum, [, volume]) => sum + Number(volume),
      0,
    );

    for (const [price, volume] of prices) {
      if (isBase) {
        if (sumBaseQty >= requiredQty) {
          break;
        }
      }

      if (isQuote) {
        if (sumQuoteQty >= requiredQty) {
          break;
        }
      }

      let currentBaseQty = Number(volume);
      let currentQuoteQty = Number(volume) * Number(price);

      const overQty = isBase
        ? currentBaseQty + sumBaseQty > requiredQty
        : currentQuoteQty + sumQuoteQty > requiredQty;

      if (overQty) {
        if (isBase) {
          currentBaseQty = requiredQty - sumBaseQty;
          currentQuoteQty = currentBaseQty * Number(price);
        }

        if (isQuote) {
          currentQuoteQty = requiredQty - sumQuoteQty;
          currentBaseQty =
            currentQuoteQty *
            new BigNumber(1).dividedBy(new BigNumber(price)).toNumber();
        }
      }

      sumBaseQty += currentBaseQty;
      sumQuoteQty += currentQuoteQty;
      selectedRows.push([price, currentBaseQty.toString()]);
    }

    if (sumBaseQty == 0) {
      return 0;
    }

    const vSumBase = selectedRows.reduce((sum: number, [price, volume]) => {
      return sum + Number(price) * Number(volume);
    }, 0);

    const price = new BigNumber(vSumBase)
      .dividedBy(new BigNumber(sumBaseQty))
      .toNumber();

    let result: any;
    if (isBase) {
      result = requiredQty / price;
    } else {
      result = requiredQty * price;
    }

    if (isQuote) {
      if (requiredQty > totalVolume) {
        result = 0;
      }
    } else {
      if (result > totalVolume) {
        result = 0;
      }
    }

    return result;
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
  ): Promise<ExchangePrices<CablesData> | null> {
    try {
      const normalizedSrcToken = this.normalizeToken(srcToken);
      const normalizedDestToken = this.normalizeToken(destToken);
      // If: same token, return null
      if (
        normalizedSrcToken.address.toLowerCase() ===
        normalizedDestToken.address.toLowerCase()
      ) {
        return null;
      }

      await this.setTokensMap();

      if (
        !this.tokensMap[normalizedSrcToken.address] ||
        !this.tokensMap[normalizedDestToken.address]
      ) {
        return null;
      }

      normalizedSrcToken.symbol =
        this.tokensMap[normalizedSrcToken.address].symbol;
      normalizedDestToken.symbol =
        this.tokensMap[normalizedDestToken.address].symbol;

      // ---------- Pools ----------
      let pools =
        limitPools ||
        (await this.getPoolIdentifiers(srcToken, destToken, side, blockNumber));
      if (pools.length === 0) return null;

      // ---------- Prices ----------
      const priceMap = await this.getCachedPrices();

      if (!priceMap) return null;

      let isInputQuote = false;
      let pairKey = `${normalizedSrcToken.symbol}/${normalizedDestToken.symbol}`;
      const pairsKeys = Object.keys(priceMap);

      if (!pairsKeys.includes(pairKey)) {
        // Revert
        isInputQuote = true;
        pairKey = `${normalizedDestToken.symbol}/${normalizedSrcToken.symbol}`;
        if (!pairsKeys.includes(pairKey)) {
          return null;
        }
      }

      /**
       * Orderbook
       */
      const priceData = priceMap[pairKey];

      let orderbook: any[] = [];
      orderbook = priceData.bids;
      // reverse orderbook if isInputQuote
      if (isInputQuote) {
        orderbook = priceData.asks;
      }
      if (orderbook?.length === 0) {
        throw new Error(`Empty orderbook for ${pairKey}`);
      }

      const prices = this.calculateOrderPrice(
        amounts,
        orderbook,
        side === SwapSide.SELL ? srcToken : destToken,
        side === SwapSide.SELL ? destToken : srcToken,
        side === SwapSide.SELL ? isInputQuote : !isInputQuote,
      );

      const result = [
        {
          prices: prices,
          unit: BigInt(normalizedDestToken.decimals),
          exchange: this.dexKey,
          gasCost: CABLES_GAS_COST,
          poolAddresses: [this.mainnetRFQAddress],
          poolIdentifiers: pools,
          data: {},
        },
      ];

      return result;
    } catch (e: unknown) {
      this.logger.error(
        `Error_getPricesVolume ${srcToken.symbol ?? srcToken.address}-${
          destToken.symbol ?? destToken.address
        } side ${side}: ${e}`,
      );
      return null;
    }
  }

  getCalldataGasCost(poolPrices: PoolPrices<CablesData>): number | number[] {
    return (
      CALLDATA_GAS_COST.DEX_OVERHEAD +
      // addresses: makerAsset, takerAsset, maker, taker
      CALLDATA_GAS_COST.ADDRESS * 4 +
      // uint256: expiry
      CALLDATA_GAS_COST.wordNonZeroBytes(16) +
      // uint256: nonceAndMeta, makerAmount, takerAmount
      CALLDATA_GAS_COST.AMOUNT * 3 +
      // bytes: _signature (65 bytes)
      CALLDATA_GAS_COST.FULL_WORD * 2 +
      CALLDATA_GAS_COST.OFFSET_SMALL
    );
  }

  async initializePricing(blockNumber: number): Promise<void> {
    if (!this.dexHelper.config.isSlave) {
      this.rateFetcher.start();
    }
    return;
  }

  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return null;
  }

  releaseResources?(): AsyncOrSync<void> {
    if (!this.dexHelper.config.isSlave && this.rateFetcher) {
      this.rateFetcher.stop();
    }
  }

  normalizeAddress(address: string): string {
    return address.toLowerCase() === ETHER_ADDRESS
      ? NULL_ADDRESS
      : address.toLowerCase();
  }

  async setTokensMap() {
    const tokens = await this.getCachedTokens();

    if (tokens) {
      this.tokensMap = Object.keys(tokens).reduce((acc, key) => {
        //@ts-ignore
        acc[tokens[key].address.toLowerCase()] = tokens[key];
        return acc;
      }, {});
    }
  }

  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    return [];
  }

  /**
   * CACHED UTILS
   */
  async getCachedTokens(): Promise<any> {
    const cachedTokens = await this.dexHelper.cache.getAndCacheLocally(
      this.dexKey,
      this.network,
      this.rateFetcher.tokensCacheKey,
      // as local cache just uses passed ttl (instead of getting actual ttl from cache)
      // pass shorter interval to avoid getting stale data
      // (same logic is used in other places)
      CABLES_API_TOKENS_POLLING_INTERVAL_MS / 1000,
    );

    return cachedTokens ? JSON.parse(cachedTokens) : {};
  }

  async getCachedPairs(): Promise<any> {
    const cachedPairs = await this.dexHelper.cache.getAndCacheLocally(
      this.dexKey,
      this.network,
      this.rateFetcher.pairsCacheKey,
      CABLES_API_PAIRS_POLLING_INTERVAL_MS / 1000,
    );

    return cachedPairs ? JSON.parse(cachedPairs) : {};
  }

  async getCachedPrices(): Promise<any> {
    const cachedPrices = await this.dexHelper.cache.getAndCacheLocally(
      this.dexKey,
      this.network,
      this.rateFetcher.pricesCacheKey,
      CABLES_API_PRICES_POLLING_INTERVAL_MS / 1000,
    );

    return cachedPrices ? JSON.parse(cachedPrices) : {};
  }

  async getCachedTokensAddr(): Promise<any> {
    const tokens = await this.getCachedTokens();
    const tokensAddr: Record<string, Address> = {};
    for (const key of Object.keys(tokens)) {
      tokensAddr[tokens[key].symbol.toLowerCase()] = tokens[key].address;
    }
    return tokensAddr;
  }

  getPairString(baseToken: Token, quoteToken: Token): string {
    return `${baseToken.symbol}/${quoteToken.symbol}`.toLowerCase();
  }

  // Function to find a key by address
  private findKeyByAddress = (
    jsonData: Record<string, { address: string }>,
    targetAddress: string,
  ): string | undefined => {
    const entries = Object.entries(jsonData);
    const foundEntry = entries.find(
      ([_, value]) =>
        value.address.toLowerCase() === targetAddress.toLowerCase(),
    );
    return foundEntry ? foundEntry[0] : undefined;
  };

  async getPairData(srcToken: Token, destToken: Token): Promise<any> {
    if (srcToken.address === destToken.address) {
      return null;
    }

    const cachedTokens = await this.getCachedTokens();

    srcToken.symbol = this.findKeyByAddress(cachedTokens, srcToken.address);
    destToken.symbol = this.findKeyByAddress(cachedTokens, destToken.address);

    const cachedPairs = await this.getCachedPairs();

    const potentialPairs = [
      {
        base: srcToken.symbol,
        quote: destToken.symbol,
        identifier: this.getPairString(srcToken, destToken),
        isSrcBase: true,
      },
      {
        base: destToken.symbol,
        quote: srcToken.symbol,
        identifier: this.getPairString(destToken, srcToken),
        isSrcBase: false,
      },
    ];

    for (const pair of potentialPairs) {
      if (pair.identifier in cachedPairs) {
        const pairData = cachedPairs[pair.identifier];
        pairData.isSrcBase = pair.isSrcBase;
        return pairData;
      }
    }
    return null;
  }
}

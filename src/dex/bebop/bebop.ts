import { assert, AsyncOrSync } from 'ts-essentials';
import {
  Token,
  Address,
  ExchangePrices,
  PoolPrices,
  AdapterExchangeParam,
  PoolLiquidity,
  Logger,
  OptimalSwapExchange,
  PreprocessTransactionOptions,
  ExchangeTxInfo,
  NumberAsString,
  DexExchangeParam,
} from '../../types';
import { SwapSide, Network } from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getDexKeysWithNetwork, Utils } from '../../utils';
import { IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import {
  BebopData,
  BebopLevel,
  BebopPair,
  BebopPricingResponse,
  RestrictData,
  RoutingInstruction,
  SlippageError,
  TokenDataMap,
} from './types';
import settlementABI from '../../abi/bebop/BebopSettlement.abi.json';
import { SimpleExchange } from '../simple-exchange';
import { BebopConfig } from './config';
import { Interface } from 'ethers/lib/utils';
import { RateFetcher } from './rate-fetcher';
import {
  BEBOP_API_URL,
  BEBOP_ERRORS_CACHE_KEY,
  BEBOP_GAS_COST,
  BEBOP_INIT_TIMEOUT_MS,
  BEBOP_PRICES_CACHE_TTL,
  BEBOP_QUOTE_TIMEOUT_MS,
  BEBOP_RESTRICTED_CACHE_KEY,
  BEBOP_RESTRICT_CHECK_INTERVAL_MS,
  BEBOP_RESTRICT_COUNT_THRESHOLD,
  BEBOP_RESTRICT_TTL_S,
  BEBOP_TOKENS_CACHE_TTL,
  BEBOP_TOKENS_POLLING_INTERVAL_MS,
  BEBOP_WS_API_URL,
  SWAP_SINGLE_METHOD_SELECTOR,
  SWAP_AGGREGATE_METHOD_SELECTOR,
  SWAP_SINGLE_METHOD,
  SWAP_AGGREGATE_METHOD,
} from './constants';
import BigNumber from 'bignumber.js';
import { getBigNumberPow } from '../../bignumber-constants';
import { ethers, utils } from 'ethers';
import qs from 'qs';

export class Bebop extends SimpleExchange implements IDex<BebopData> {
  readonly hasConstantPriceLargeAmounts = false;
  readonly needWrapNative = true;

  readonly isFeeOnTransferSupported = false;
  readonly isStatePollingDex = true;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(BebopConfig);

  private rateFetcher: RateFetcher;
  private tokensMap: TokenDataMap = {};

  private pricesCacheKey: string;
  private tokensCacheKey: string;
  private tokensAddrCacheKey: string;

  private bebopAuthToken: string;
  private bebopAuthName: string;

  logger: Logger;

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
    readonly settlementAddress: string = BebopConfig['Bebop'][network]
      .settlementAddress,
    protected settlementInterface = new Interface(settlementABI),
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey);
    this.tokensCacheKey = `tokens`;
    this.pricesCacheKey = `prices`;
    this.tokensAddrCacheKey = `tokens_addr`;
    const token = this.dexHelper.config.data.bebopAuthToken;
    const name = this.dexHelper.config.data.bebopAuthName;

    assert(
      token !== undefined,
      'Bebop auth token is not specified with env variable',
    );

    assert(
      name !== undefined,
      'Bebop auth name is not specified with env variable',
    );

    this.bebopAuthName = name;
    this.bebopAuthToken = token;

    this.rateFetcher = new RateFetcher(
      this.dexHelper,
      this.dexKey,
      this.network,
      this.logger,
      {
        rateConfig: {
          tokensIntervalMs: BEBOP_TOKENS_POLLING_INTERVAL_MS,
          pricesCacheKey: this.pricesCacheKey,
          pricesCacheTTLSecs: BEBOP_PRICES_CACHE_TTL,
          tokensCacheKey: this.tokensCacheKey,
          tokensAddrCacheKey: this.tokensAddrCacheKey,
          tokensCacheTTLSecs: BEBOP_TOKENS_CACHE_TTL,
          tokensReqParams: {
            url:
              BEBOP_API_URL +
              `/pmm/${BebopConfig['Bebop'][network].chainName}/v3/token-info`,
          },
          pricesReqParams: {
            url:
              BEBOP_WS_API_URL +
              `/pmm/${BebopConfig['Bebop'][network].chainName}/v3/pricing?format=protobuf`,
            headers: {
              name: this.bebopAuthName,
              authorization: this.bebopAuthToken,
            },
          },
        },
      },
    );
  }

  async initializePricing(blockNumber: number) {
    if (!this.dexHelper.config.isSlave) {
      this.rateFetcher.start();
      await sleep(BEBOP_INIT_TIMEOUT_MS);
    }

    await this.setTokensMap();
  }

  // Returns the list of contract adapters (name and index)
  // for a buy/sell. Return null if there are no adapters.
  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return null;
  }

  getPoolIdentifier(base: string, quote: string): string {
    const identifier = `${
      this.dexKey
    }_${base.toLowerCase()}_${quote.toLowerCase()}`;
    return identifier;
  }

  invertLevels(levels: BebopLevel[]): BebopLevel[] {
    return levels.map(([price, size]) => [1 / price, size * price]);
  }

  invertBook(book: BebopPair): BebopPair {
    return {
      bids: this.invertLevels(book.asks),
      asks: this.invertLevels(book.bids),
      last_update_ts: book.last_update_ts,
    };
  }

  // considers only swapside.sell
  async calculateInstructions(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
  ): Promise<RoutingInstruction[]> {
    // Gaurd against same token and wrapping/unwrapping
    const tokensSet = new Set([
      srcToken.address.toLowerCase(),
      destToken.address.toLowerCase(),
    ]);
    if (tokensSet.size < 2) {
      return [];
    }

    const prices = await this.getCachedPrices();
    if (!prices) {
      throw new Error('No prices available');
    }
    const directBook =
      prices[
        `${srcToken.address.toLowerCase()}/${destToken.address.toLowerCase()}`
      ];
    if (directBook) {
      return [
        {
          pair: `${srcToken.address.toLowerCase()}/${destToken.address.toLowerCase()}`,
          side,
          book: directBook,
          targetQuote: side == SwapSide.BUY,
        },
      ];
    }

    const inverseBook =
      prices[
        `${destToken.address.toLowerCase()}/${srcToken.address.toLowerCase()}`
      ];
    if (inverseBook) {
      const invertedBook = this.invertBook(inverseBook);
      return [
        {
          pair: `${srcToken.address.toLowerCase()}/${destToken.address.toLowerCase()}`,
          side,
          book: invertedBook,
          targetQuote: side == SwapSide.BUY,
        },
      ];
    }

    for (const middleToken of BebopConfig['Bebop'][this.network].middleTokens) {
      const baseMiddle =
        prices[
          `${srcToken.address.toLowerCase()}/${middleToken.toLowerCase()}`
        ];
      const quoteMiddle =
        prices[
          `${destToken.address.toLowerCase()}/${middleToken.toLowerCase()}`
        ];
      if (baseMiddle && quoteMiddle) {
        if (side == SwapSide.SELL) {
          return [
            {
              pair: `${srcToken.address.toLowerCase()}/${middleToken.toLowerCase()}`,
              side: side,
              book: baseMiddle,
              targetQuote: false,
            },
            {
              pair: `${middleToken.toLowerCase()}/${destToken.address.toLowerCase()}`,
              side: side,
              book: this.invertBook(quoteMiddle),
              targetQuote: false,
            },
          ];
        } else {
          return [
            {
              pair: `${middleToken.toLowerCase()}/${destToken.address.toLowerCase()}`,
              side: side,
              book: this.invertBook(quoteMiddle),
              targetQuote: true,
            },
            {
              pair: `${srcToken.address.toLowerCase()}/${middleToken.toLowerCase()}`,
              side: side,
              book: baseMiddle,
              targetQuote: true,
            },
          ];
        }
      }
    }

    return [];
  }

  // Returns list of pool identifiers that can be used
  // for a given swap. poolIdentifiers must be unique
  // across DEXes. It is recommended to use
  // ${dexKey}_${poolAddress} as a poolIdentifier
  async getPoolIdentifiers(
    _srcToken: Token,
    _destToken: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    const srcToken = this.dexHelper.config.wrapETH(_srcToken);
    const destToken = this.dexHelper.config.wrapETH(_destToken);

    if (
      (await this.calculateInstructions(srcToken, destToken, side)).length > 0
    ) {
      const identifier = this.getPoolIdentifier(
        srcToken.address,
        destToken.address,
      );
      return [identifier];
    }

    return [];
  }

  runInstruction(
    instruction: RoutingInstruction,
    amount: BigNumber,
  ): BigNumber {
    let accumulated = BigNumber(0);
    let output = BigNumber(0);
    let filled = false;
    for (const level of instruction.book.bids) {
      const [price, size] = level;
      const amountToAccumulate = instruction.targetQuote
        ? BigNumber(size).times(price)
        : BigNumber(size);
      const afterAccumulated = accumulated.plus(amountToAccumulate);
      if (afterAccumulated.lt(amount)) {
        accumulated = accumulated.plus(amountToAccumulate);
        const amountToAddToOutput = instruction.targetQuote
          ? BigNumber(size)
          : BigNumber(size).times(price);
        output = output.plus(amountToAddToOutput);
        if (accumulated.eq(amount)) {
          filled = true;
          break;
        }
      } else {
        const remaining = amount.minus(accumulated);
        output = output.plus(
          instruction.targetQuote
            ? remaining.div(price)
            : remaining.times(price),
        );
        filled = true;
        break;
      }
    }
    if (filled) {
      return output;
    } else {
      return BigNumber(0);
    }
  }

  calculateOutput(
    instructions: RoutingInstruction[],
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
  ): bigint[] {
    const outputs = [];
    const inputDecimals =
      side == SwapSide.SELL ? srcToken.decimals : destToken.decimals;
    const outputDecimals =
      side == SwapSide.SELL ? destToken.decimals : srcToken.decimals;

    for (const amount of amounts) {
      if (amount == 0n) {
        outputs.push(0n);
        continue;
      }
      const amountDecimals = BigNumber(amount.toString()).div(
        getBigNumberPow(inputDecimals),
      );
      let output: BigNumber = BigNumber(0);
      for (const instruction of instructions) {
        output = this.runInstruction(
          instruction,
          output.gt(0) ? output : amountDecimals,
        );
        if (output.eq(0)) {
          break;
        }
      }
      if (output.gt(0)) {
        outputs.push(
          BigInt(output.times(getBigNumberPow(outputDecimals)).toFixed(0)),
        );
      } else {
        outputs.push(0n);
      }
    }
    return outputs;
  }

  // Returns pool prices for amounts.
  // If limitPools is defined only pools in limitPools
  // should be used. If limitPools is undefined then
  // any pools can be used.
  async getPricesVolume(
    _srcToken: Token,
    _destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<BebopData>> {
    const isRestricted = await this.isRestricted();
    if (isRestricted) {
      return null;
    }

    const srcToken = this.dexHelper.config.wrapETH(_srcToken);
    const destToken = this.dexHelper.config.wrapETH(_destToken);

    try {
      let pools = limitPools
        ? limitPools.filter(
            p =>
              p === this.getPoolIdentifier(srcToken.address, destToken.address),
          )
        : await this.getPoolIdentifiers(srcToken, destToken, side, blockNumber);

      if (pools.length === 0) {
        return null;
      }

      const instructions = await this.calculateInstructions(
        srcToken,
        destToken,
        side,
      );

      if (!instructions) {
        return null;
      }

      const outputs = this.calculateOutput(
        instructions,
        srcToken,
        destToken,
        amounts,
        side,
      );

      // Up to 3bps deviation is expected in the output compared to the on-chain result
      // On SwapSide.Sell, outputs compared  to quoting are coming out: -0.1 bips -> USDC, -1 bips Alt -> Alt.
      // On SwapSide.Buy, outputs compared to quoteing are coming out: 0.1 bips -> USDC, 1-3 bips Alt -> Alt.

      const outDecimals = SwapSide.SELL
        ? destToken.decimals
        : srcToken.decimals;

      return [
        {
          prices: outputs,
          unit: BigInt(outDecimals),
          data: {},
          poolIdentifier: pools[0],
          exchange: this.dexKey,
          gasCost: BEBOP_GAS_COST,
          poolAddresses: [this.settlementAddress],
        },
      ];
    } catch (e: unknown) {
      this.logger.error(
        `Error_getPricesVolume ${srcToken.address || srcToken.symbol}, ${
          destToken.address || destToken.symbol
        }, ${side}:`,
        e,
      );
      return null;
    }
  }

  // Returns estimated gas cost of calldata for this DEX in multiSwap
  getCalldataGasCost(poolPrices: PoolPrices<BebopData>): number | number[] {
    // This relies heavily on exact quote. Can we note use Bebop Data to find this? either via pools or the data itself?
    // This assumes that a single maker was used to fill this trade
    // "order":{
    return (
      CALLDATA_GAS_COST.DEX_OVERHEAD +
      // "expiry":"1725541751"
      CALLDATA_GAS_COST.TIMESTAMP +
      // "taker_address":"0x9008d19f58aabd9ed0d60971565aa8510560ab41"
      CALLDATA_GAS_COST.ADDRESS +
      // "maker_address":"0x807cf9a772d5a3f9cefbc1192e939d62f0d9bd38"
      CALLDATA_GAS_COST.ADDRESS +
      // "maker_nonce":"1725541661402362944"
      CALLDATA_GAS_COST.UUID +
      // "taker_token":"0x3429d03c6f7521aec737a0bbf2e5ddcef2c3ae31"
      CALLDATA_GAS_COST.ADDRESS +
      // "maker_token":"0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
      CALLDATA_GAS_COST.ADDRESS +
      // "taker_amount":"3789033775358849793876"
      CALLDATA_GAS_COST.AMOUNT +
      // "maker_amount":"199726023273987970"
      CALLDATA_GAS_COST.AMOUNT +
      // "receiver":"0x9008d19f58aabd9ed0d60971565aa8510560ab41"
      CALLDATA_GAS_COST.ADDRESS +
      // "packed_commands":"0"
      CALLDATA_GAS_COST.wordNonZeroBytes(4) +
      // "flags":"103712057072216206793253728668500811363805133225332165859664901734817333248000"
      CALLDATA_GAS_COST.FULL_WORD +
      // }
      // "makerSignature":{
      // "signatureBytes":"0x34e1fbda1d48296949f0a003d4194646ed750a4ccd408b52979f60c2e7332207190a91600a40396b25fd645422dde85bc0ff53f26b66202a985ac8b9da87b47e1c"
      CALLDATA_GAS_COST.FULL_WORD +
      // "flags":"1"
      CALLDATA_GAS_COST.LENGTH_SMALL +
      // }
      // "filledTakerAmount":"0"
      CALLDATA_GAS_COST.AMOUNT
    );
  }

  // Encode params required by the exchange adapter
  // V5: Used for multiSwap, buy & megaSwap
  // V6: Not used, can be left blank
  // Hint: abiCoder.encodeParameter() could be useful
  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: BebopData,
    side: SwapSide,
  ): AdapterExchangeParam {
    const { tx } = data;

    if (!tx) {
      throw new Error('No tx in data');
    }

    // Encode here the payload for adapter
    const payload = tx.data;

    return {
      targetExchange: this.settlementAddress,
      payload,
      networkFee: '0',
    };
  }

  async updatePoolState(): Promise<void> {
    await this.setTokensMap();
  }

  async setTokensMap() {
    const tokens = await this.getCachedTokens();

    if (tokens) {
      this.tokensMap = tokens;
    }
  }

  getMaxLiquidity(levels: BebopLevel[]) {
    return levels.reduce((acc, [price, size]) => {
      return acc + price * size;
    }, 0);
  }

  // Returns list of top pools based on liquidity. Max
  // limit number pools should be returned.
  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    const prices = await this.getCachedPrices();

    if (!prices) {
      return [];
    }

    const pools: PoolLiquidity[] = [];

    for (const [pair, pairData] of Object.entries(prices)) {
      let liquidityUSD = 0;
      let token;
      const [base, quote] = pair.split('/');

      const isBase = base.toLowerCase() == tokenAddress.toLowerCase();
      const isQuote = quote.toLowerCase() == tokenAddress.toLowerCase();

      // There is pricing for token is not enabled at the moment
      if (
        !(
          quote.toLowerCase() in this.tokensMap &&
          base.toLowerCase() in this.tokensMap
        )
      ) {
        continue;
      }

      if (isBase) {
        const liquidityInQuote = this.getMaxLiquidity(pairData.bids);
        token = {
          address: quote,
          decimals: this.tokensMap[quote.toLowerCase()].decimals,
        };
        const quoteTokenUsd = await this.dexHelper.getTokenUSDPrice(
          token,
          BigInt(Math.round(liquidityInQuote)),
        );
        liquidityUSD = liquidityInQuote * quoteTokenUsd;
      } else if (isQuote) {
        const liquidityInBase = this.getMaxLiquidity(pairData.asks);
        token = {
          address: base,
          decimals: this.tokensMap[base.toLowerCase()].decimals,
        };
        const baseTokenUsd = await this.dexHelper.getTokenUSDPrice(
          token,
          BigInt(Math.round(liquidityInBase)),
        );
        liquidityUSD = liquidityInBase * baseTokenUsd;
      }

      if (liquidityUSD) {
        assert(token, 'Token not found');
        const address = token.address.toLowerCase();

        if (pools.length === 0) {
          pools.push({
            exchange: this.dexKey,
            address: this.settlementAddress,
            connectorTokens: [
              {
                address: address,
                decimals: this.tokensMap[address].decimals,
                symbol: this.tokensMap[address].ticker,
              },
            ],
            liquidityUSD,
          });
        } else {
          pools[0].liquidityUSD += liquidityUSD;
          pools[0].connectorTokens.push({
            address: address,
            decimals: this.tokensMap[address].decimals,
            symbol: this.tokensMap[address].ticker,
          });
        }
      }
    }

    return pools
      .sort((a, b) => b.liquidityUSD - a.liquidityUSD)
      .slice(0, limit);
  }

  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: BebopData,
    side: SwapSide,
  ): DexExchangeParam {
    const { tx } = data;

    assert(tx !== undefined, `${this.dexKey}-${this.network}: tx undefined`);

    const isSwapSingle = tx.data.slice(0, 10) === SWAP_SINGLE_METHOD_SELECTOR;
    const isSwapAggregate =
      tx.data.slice(0, 10) === SWAP_AGGREGATE_METHOD_SELECTOR;

    if (isSwapSingle || isSwapAggregate) {
      const method = isSwapSingle ? SWAP_SINGLE_METHOD : SWAP_AGGREGATE_METHOD;

      const decodedParam = this.settlementInterface.decodeFunctionData(
        method,
        tx.data,
      );

      const exchangeData = this.settlementInterface.encodeFunctionData(method, [
        decodedParam[0],
        decodedParam[1],
        srcAmount, // modify filledTakerAmount to make insertFromAmount work
      ]);

      const fromAmount = ethers.utils.defaultAbiCoder.encode(
        ['uint256'],
        [srcAmount],
      );

      const filledTakerAmountIndex = exchangeData
        .replace('0x', '')
        .lastIndexOf(fromAmount.replace('0x', ''));

      const filledTakerAmountPos =
        (filledTakerAmountIndex !== -1
          ? filledTakerAmountIndex
          : exchangeData.length) / 2;

      return {
        exchangeData: exchangeData,
        needWrapNative: this.needWrapNative,
        dexFuncHasRecipient: true,
        targetExchange: this.settlementAddress,
        returnAmountPos: undefined,
        sendEthButSupportsInsertFromAmount: true,
        insertFromAmountPos: filledTakerAmountPos,
      };
    } else {
      throw new Error('Not supported method');
    }
  }

  async preProcessTransaction(
    optimalSwapExchange: OptimalSwapExchange<BebopData>,
    _srcToken: Token,
    _destToken: Token,
    side: SwapSide,
    options: PreprocessTransactionOptions,
  ): Promise<[OptimalSwapExchange<BebopData>, ExchangeTxInfo]> {
    const isSell = side === SwapSide.SELL;
    const isBuy = side === SwapSide.BUY;

    const srcToken = this.dexHelper.config.wrapETH(_srcToken);
    const destToken = this.dexHelper.config.wrapETH(_destToken);

    const params = {
      sell_tokens: utils.getAddress(srcToken.address),
      buy_tokens: utils.getAddress(destToken.address),
      sell_amounts: isSell ? optimalSwapExchange.srcAmount : undefined,
      buy_amounts: isBuy ? optimalSwapExchange.destAmount : undefined,
      taker_address: utils.getAddress(options.executionContractAddress),
      receiver_address: utils.getAddress(options.recipient),
      origin_address: utils.getAddress(options.txOrigin),
      gasless: false,
      skip_validation: true,
      source: this.bebopAuthName,
    };

    let quoteId: string | undefined;

    try {
      const response: BebopData = await this.dexHelper.httpRequest.get(
        `${BEBOP_API_URL}/pmm/${
          BebopConfig['Bebop'][this.network].chainName
        }/v3/quote?${qs.stringify(params)}`,
        BEBOP_QUOTE_TIMEOUT_MS,
        {
          'source-auth': this.bebopAuthToken,
        },
      );

      if (!response) {
        throw new Error('Failed to get quote');
      }

      quoteId = response.quoteId;

      if (
        !response.tx ||
        !response.buyTokens ||
        !response.sellTokens ||
        !response.expiry
      ) {
        const baseMessage = `Bebop quote failed on chain ${this.network} Sell: ${params.sell_tokens}. Buy: ${params.buy_tokens}.`;
        if (response.error) {
          const errorMessage = `${baseMessage} Code: ${response.error.errorCode}, Message: ${response.error.message}`;
          throw new Error(errorMessage);
        } else {
          const errorMessage = `${baseMessage} Response: ${JSON.stringify(
            response,
          )}`;
          throw new Error(errorMessage);
        }
      }

      if (side === SwapSide.SELL) {
        const requiredAmount = BigInt(optimalSwapExchange.destAmount);
        const quoteAmount = BigInt(
          response.buyTokens[utils.getAddress(destToken.address)].amount,
        );
        const requiredAmountWithSlippage = new BigNumber(
          requiredAmount.toString(),
        )
          .times(options.slippageFactor)
          .toFixed(0);
        if (quoteAmount < BigInt(requiredAmountWithSlippage)) {
          throw new SlippageError(
            `Slipped, factor: ${quoteAmount.toString()} < ${requiredAmountWithSlippage}`,
          );
        }
      } else {
        const requiredAmount = BigInt(optimalSwapExchange.srcAmount);
        const quoteAmount = BigInt(
          response.sellTokens[utils.getAddress(srcToken.address)].amount,
        );
        const requiredAmountWithSlippage = new BigNumber(
          requiredAmount.toString(),
        )
          .times(options.slippageFactor)
          .toFixed(0);
        if (quoteAmount > BigInt(requiredAmountWithSlippage)) {
          throw new SlippageError(
            `Slipped, factor: ${
              options.slippageFactor
            } ${quoteAmount.toString()} > ${requiredAmountWithSlippage}`,
          );
        }
      }
      return [
        {
          ...optimalSwapExchange,
          data: {
            ...response,
          },
        },
        { deadline: BigInt(response.expiry) },
      ];
    } catch (e: any) {
      const message = `${this.dexKey}-${this.network} ${
        quoteId ? `quoteId: ${quoteId}` : ''
      }: ${e}`;

      this.logger.error(message);
      if (!e?.isSlippageError) {
        this.restrict();
      }
      throw new Error(message);
    }
  }

  async restrict() {
    const errorsDataRaw = await this.dexHelper.cache.get(
      this.dexKey,
      this.network,
      BEBOP_ERRORS_CACHE_KEY,
    );

    const errorsData: RestrictData = Utils.Parse(errorsDataRaw);
    const ERRORS_TTL_S = Math.floor(BEBOP_RESTRICT_CHECK_INTERVAL_MS / 1000);

    if (
      !errorsData ||
      errorsData?.addedDatetimeMs + BEBOP_RESTRICT_CHECK_INTERVAL_MS <
        Date.now()
    ) {
      this.logger.warn(
        `${this.dexKey}-${this.network}: First encounter of error OR error ocurred outside of threshold, setting up counter`,
      );
      const data: RestrictData = {
        count: 1,
        addedDatetimeMs: Date.now(),
      };
      await this.dexHelper.cache.setex(
        this.dexKey,
        this.network,
        BEBOP_ERRORS_CACHE_KEY,
        ERRORS_TTL_S,
        Utils.Serialize(data),
      );
      return;
    } else {
      if (errorsData.count + 1 >= BEBOP_RESTRICT_COUNT_THRESHOLD) {
        this.logger.warn(
          `${this.dexKey}-${this.network}: Restricting due to error count=${
            errorsData.count + 1
          } within ${BEBOP_RESTRICT_CHECK_INTERVAL_MS / 1000 / 60} minutes`,
        );
        await this.dexHelper.cache.setex(
          this.dexKey,
          this.network,
          BEBOP_RESTRICTED_CACHE_KEY,
          BEBOP_RESTRICT_TTL_S,
          'true',
        );
      } else {
        this.logger.warn(
          `${this.dexKey}-${this.network}: Error count increased`,
        );
        const data: RestrictData = {
          count: errorsData.count + 1,
          addedDatetimeMs: errorsData.addedDatetimeMs,
        };
        await this.dexHelper.cache.setex(
          this.dexKey,
          this.network,
          BEBOP_ERRORS_CACHE_KEY,
          ERRORS_TTL_S,
          Utils.Serialize(data),
        );
      }
    }
  }

  async isRestricted(): Promise<boolean> {
    const result = await this.dexHelper.cache.get(
      this.dexKey,
      this.network,
      BEBOP_RESTRICTED_CACHE_KEY,
    );

    return result === 'true';
  }

  async getCachedPrices(): Promise<BebopPricingResponse | null> {
    const cachedPrices = await this.dexHelper.cache.getAndCacheLocally(
      this.dexKey,
      this.network,
      this.pricesCacheKey,
      2,
    );

    if (cachedPrices) {
      return JSON.parse(cachedPrices) as BebopPricingResponse;
    }

    return null;
  }

  async getCachedTokens(): Promise<TokenDataMap | null> {
    const cachedTokens = await this.dexHelper.cache.getAndCacheLocally(
      this.dexKey,
      this.network,
      this.tokensAddrCacheKey,
      BEBOP_TOKENS_POLLING_INTERVAL_MS / 1000,
    );

    if (cachedTokens) {
      return JSON.parse(cachedTokens) as TokenDataMap;
    }

    return null;
  }

  getTokenFromAddress(address: Address): Token {
    const bebopToken = this.tokensMap[address.toLowerCase()];
    return {
      address,
      decimals: bebopToken.decimals,
      symbol: bebopToken.ticker,
    };
  }

  releaseResources(): AsyncOrSync<void> {
    if (!this.dexHelper.config.isSlave) {
      this.rateFetcher.stop();
    }
  }
}

const sleep = (time: number) =>
  new Promise(resolve => {
    setTimeout(resolve, time);
  });

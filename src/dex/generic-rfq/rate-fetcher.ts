import BigNumber from 'bignumber.js';
import { isEmpty, omit } from 'lodash';
import { SwapSide } from '@paraswap/core';
import { BN_1 } from '../../bignumber-constants';
import { IDexHelper } from '../../dex-helper';
import { RequestConfig } from '../../dex-helper/irequest-wrapper';
import { Fetcher } from '../../lib/fetcher/fetcher';

import { Logger, Address, Token } from '../../types';
import { OrderInfo } from '../paraswap-limit-orders/types';
import {
  BlackListResponse,
  PairMap,
  PairsResponse,
  PriceAndAmount,
  PriceAndAmountBigNumber,
  RatesResponse,
  RFQConfig,
  RFQFirmRateResponse,
  RFQPayload,
  RFQSecret,
  TokensResponse,
  TokenWithInfo,
} from './types';
import { checkOrder } from './utils';
import {
  blacklistResponseValidator,
  firmRateWithTakerValidator,
  pairsResponseValidator,
  pricesResponse,
  tokensResponseValidator,
} from './validators';
import { genericRFQAuthHttp } from './security';
import { validateAndCast } from '../../lib/validators';
import {
  createERC1271Contract,
  ERC1271Contract,
} from '../../lib/erc1271-utils';
import { isContractAddress } from '../../utils';

const GET_FIRM_RATE_TIMEOUT_MS = 2000;
export const reversePrice = (price: PriceAndAmountBigNumber) =>
  [
    BN_1.dividedBy(price[0]),
    price[1].times(price[0]),
  ] as PriceAndAmountBigNumber;

export class RateFetcher {
  private tokensFetcher: Fetcher<TokensResponse>;
  private pairsFetcher: Fetcher<PairsResponse>;
  private rateFetcher: Fetcher<RatesResponse>;
  private blackListFetcher?: Fetcher<BlackListResponse>;

  private tokens: Record<string, TokenWithInfo> = {};
  private addressToTokenMap: Record<string, TokenWithInfo> = {};
  private pairs: PairMap = {};

  private firmRateAuth?: (options: RequestConfig) => void;

  public blackListCacheKey: string;

  private authHttp: (
    secret: RFQSecret,
  ) => (options: RequestConfig) => RequestConfig;

  private verifierContract?: ERC1271Contract;

  constructor(
    private dexHelper: IDexHelper,
    private config: RFQConfig,
    private dexKey: string,
    private logger: Logger,
  ) {
    this.authHttp = genericRFQAuthHttp(config.pathToRemove);
    this.tokensFetcher = new Fetcher<TokensResponse>(
      dexHelper.httpRequest,
      {
        info: {
          requestOptions: config.tokensConfig.reqParams,
          caster: (data: unknown) => {
            return validateAndCast<TokensResponse>(
              data,
              tokensResponseValidator,
            );
          },
          authenticate: this.authHttp(config.tokensConfig.secret),
        },
        handler: this.handleTokensResponse.bind(this),
      },
      config.tokensConfig.intervalMs,
      this.logger,
    );

    this.pairsFetcher = new Fetcher<PairsResponse>(
      dexHelper.httpRequest,
      {
        info: {
          requestOptions: config.pairsConfig.reqParams,
          caster: (data: unknown) => {
            return validateAndCast<PairsResponse>(data, pairsResponseValidator);
          },
          authenticate: this.authHttp(config.pairsConfig.secret),
        },
        handler: this.handlePairsResponse.bind(this),
      },
      config.pairsConfig.intervalMs,
      this.logger,
    );

    this.rateFetcher = new Fetcher<RatesResponse>(
      dexHelper.httpRequest,
      {
        info: {
          requestOptions: config.rateConfig.reqParams,
          caster: (data: unknown) => {
            return validateAndCast<RatesResponse>(data, pricesResponse);
          },
          authenticate: this.authHttp(config.rateConfig.secret),
        },
        handler: this.handleRatesResponse.bind(this),
      },
      config.rateConfig.intervalMs,
      logger,
    );

    if (config.blacklistConfig) {
      this.blackListFetcher = new Fetcher<BlackListResponse>(
        dexHelper.httpRequest,
        {
          info: {
            requestOptions: config.blacklistConfig.reqParams,
            caster: (data: unknown) => {
              return validateAndCast<BlackListResponse>(
                data,
                blacklistResponseValidator,
              );
            },
            authenticate: this.authHttp(config.rateConfig.secret),
          },
          handler: this.handleBlackListResponse.bind(this),
        },
        config.blacklistConfig.intervalMs,
        logger,
      );
    }

    this.blackListCacheKey = `${this.dexHelper.config.data.network}_${this.dexKey}_blacklist`;
    if (this.config.firmRateConfig.secret) {
      this.firmRateAuth = this.authHttp(this.config.firmRateConfig.secret);
    }
  }

  async initialize() {
    const isContract = await isContractAddress(
      this.dexHelper.web3Provider,
      this.config.maker,
    );
    if (isContract) {
      this.verifierContract = createERC1271Contract(
        this.dexHelper.web3Provider,
        this.config.maker,
      );
    }
  }

  start() {
    this.tokensFetcher.startPolling();
    this.rateFetcher.startPolling();
    this.pairsFetcher.startPolling();
    if (this.blackListFetcher) {
      this.blackListFetcher.startPolling();
    }
  }

  stop() {
    this.tokensFetcher.stopPolling();
    this.pairsFetcher.stopPolling();
    this.rateFetcher.stopPolling();

    if (this.blackListFetcher) {
      this.blackListFetcher.stopPolling();
    }
  }

  private handleTokensResponse(data: TokensResponse) {
    for (const tokenName of Object.keys(data.tokens)) {
      const token = data.tokens[tokenName];
      token.address = token.address.toLowerCase();
      this.tokens[tokenName] = token;
    }

    this.addressToTokenMap = Object.keys(this.tokens).reduce((acc, key) => {
      const obj = this.tokens[key];
      if (!obj) {
        return acc;
      }
      acc[obj.address.toLowerCase()] = obj;
      return acc;
    }, {} as Record<string, TokenWithInfo>);
  }

  private handlePairsResponse(resp: PairsResponse) {
    this.pairs = {};

    const pairs: PairMap = {};
    for (const pairName of Object.keys(resp.pairs)) {
      pairs[pairName] = resp.pairs[pairName];
    }

    this.pairs = pairs;
  }

  private handleBlackListResponse(resp: BlackListResponse) {
    for (const address of resp.blacklist) {
      this.dexHelper.cache.sadd(this.blackListCacheKey, address.toLowerCase());
    }
  }

  public isBlackListed(userAddress: string) {
    return this.dexHelper.cache.sismember(
      this.blackListCacheKey,
      userAddress.toLowerCase(),
    );
  }

  private handleRatesResponse(resp: RatesResponse) {
    const pairs = this.pairs;

    if (isEmpty(pairs)) return;

    const currentPricePairs = new Set();

    Object.keys(resp.prices).forEach(pairName => {
      const pair = pairs[pairName];
      if (!pair) {
        return;
      }
      const prices = resp.prices[pairName];

      if (!prices.asks || !prices.bids) {
        return;
      }

      if (isEmpty(this.tokens)) return;

      const baseToken = this.tokens[pair.base];
      const quoteToken = this.tokens[pair.quote];

      if (!baseToken || !quoteToken) {
        this.logger.warn(`missing base or quote token`);
        return;
      }

      if (prices.bids.length) {
        this.dexHelper.cache.setex(
          this.dexKey,
          this.dexHelper.config.data.network,
          `${baseToken.address}_${quoteToken.address}_bids`,
          this.config.rateConfig.dataTTLS,
          JSON.stringify(prices.bids),
        );
        currentPricePairs.add(`${baseToken.address}_${quoteToken.address}`);
      }

      if (prices.asks.length) {
        this.dexHelper.cache.setex(
          this.dexKey,
          this.dexHelper.config.data.network,
          `${baseToken.address}_${quoteToken.address}_asks`,
          this.config.rateConfig.dataTTLS,
          JSON.stringify(prices.asks),
        );
        currentPricePairs.add(`${quoteToken.address}_${baseToken.address}`);
      }
    });

    if (currentPricePairs.size > 0) {
      this.dexHelper.cache.setex(
        this.dexKey,
        this.dexHelper.config.data.network,
        `pairs`,
        this.config.rateConfig.dataTTLS,
        JSON.stringify(Array.from(currentPricePairs)),
      );
    }
  }

  checkHealth(): boolean {
    return [this.tokensFetcher, this.rateFetcher].some(
      f => f.lastFetchSucceeded,
    );
  }

  public getPairsLiquidity(tokenAddress: string) {
    const token = this.addressToTokenMap[tokenAddress];

    const pairNames = Object.keys(this.pairs);
    const pairs = Object.values(this.pairs);

    return pairs
      .filter((p, index) => pairNames[index].includes(token.symbol!))
      .map(p => {
        const baseToken = this.tokens[p.base];
        const quoteToken = this.tokens[p.quote];
        let connectorToken: Token | undefined;
        if (baseToken.address !== tokenAddress) {
          connectorToken = {
            address: baseToken.address,
            decimals: baseToken.decimals,
          };
        } else {
          connectorToken = {
            address: quoteToken.address,
            decimals: quoteToken.decimals,
          };
        }
        return {
          connectorTokens: [connectorToken],
          liquidityUSD: p.liquidityUSD,
        };
      });
  }

  public async getAvailablePairs(): Promise<string[]> {
    const pairs = await this.dexHelper.cache.getAndCacheLocally(
      this.dexKey,
      this.dexHelper.config.data.network,
      `pairs`,
      this.config.rateConfig.intervalMs / 1000,
    );

    if (!pairs) {
      return [];
    }

    return JSON.parse(pairs) as string[];
  }

  public async getOrderPrice(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
  ): Promise<PriceAndAmountBigNumber[] | null> {
    let reversed = false;

    let pricesAsString: string | null = null;
    if (side === SwapSide.SELL) {
      pricesAsString = await this.dexHelper.cache.getAndCacheLocally(
        this.dexKey,
        this.dexHelper.config.data.network,
        `${srcToken.address}_${destToken.address}_bids`,
        this.config.rateConfig.intervalMs / 1000,
      );

      if (!pricesAsString) {
        pricesAsString = await this.dexHelper.cache.getAndCacheLocally(
          this.dexKey,
          this.dexHelper.config.data.network,
          `${destToken.address}_${srcToken.address}_asks`,
          this.config.rateConfig.intervalMs / 1000,
        );
        reversed = true;
      }
    } else {
      pricesAsString = await this.dexHelper.cache.getAndCacheLocally(
        this.dexKey,
        this.dexHelper.config.data.network,
        `${destToken.address}_${srcToken.address}_asks`,
        this.config.rateConfig.intervalMs / 1000,
      );

      if (!pricesAsString) {
        pricesAsString = await this.dexHelper.cache.getAndCacheLocally(
          this.dexKey,
          this.dexHelper.config.data.network,
          `${srcToken.address}_${destToken.address}_bids`,
          this.config.rateConfig.intervalMs / 1000,
        );
        reversed = true;
      }
    }

    if (!pricesAsString) {
      return null;
    }

    const orderPricesAsString: PriceAndAmount[] = JSON.parse(pricesAsString);
    if (!orderPricesAsString) {
      return null;
    }

    let orderPrices = orderPricesAsString.map(price => [
      new BigNumber(price[0]),
      new BigNumber(price[1]),
    ]);

    if (reversed) {
      orderPrices = orderPrices.map(price =>
        reversePrice(price as PriceAndAmountBigNumber),
      );
    }

    return orderPrices as PriceAndAmountBigNumber[];
  }

  async getFirmRate(
    _srcToken: Token,
    _destToken: Token,
    srcAmount: string,
    side: SwapSide,
    takerAddress: Address,
    userAddress: Address,
    partner?: string,
    special?: boolean,
  ): Promise<OrderInfo> {
    const srcToken = this.dexHelper.config.wrapETH(_srcToken);
    const destToken = this.dexHelper.config.wrapETH(_destToken);

    if (BigInt(srcAmount) === 0n) {
      throw new Error('getFirmRate failed with srcAmount == 0');
    }

    const _payload: RFQPayload = {
      makerAsset: destToken.address,
      takerAsset: srcToken.address,
      makerAmount: side === SwapSide.BUY ? srcAmount : undefined,
      takerAmount: side === SwapSide.SELL ? srcAmount : undefined,
      userAddress,
      takerAddress,
      partner,
      special: special || false,
    };

    try {
      let payload = {
        data: _payload,
        ...this.config.firmRateConfig,
        timeout: GET_FIRM_RATE_TIMEOUT_MS,
      };

      this.logger.info(
        'FirmRate Request:',
        JSON.stringify(omit(payload, 'secret')).replace(/(?:\r\n|\r|\n)/g, ' '),
      );

      if (this.firmRateAuth) {
        this.firmRateAuth(payload);
        delete payload.secret;
      }
      const { data } = await this.dexHelper.httpRequest.request<unknown>(
        payload,
      );
      this.logger.info(
        'FirmRate Response: ',
        JSON.stringify(data).replace(/(?:\r\n|\r|\n)/g, ' '),
      );
      const firmRateResp = validateAndCast<RFQFirmRateResponse>(
        data,
        firmRateWithTakerValidator(takerAddress),
      );

      await checkOrder(
        this.dexHelper.config.data.network,
        this.dexHelper.config.data.augustusRFQAddress,
        this.dexHelper.multiWrapper,
        firmRateResp.order,
        this.verifierContract,
      );

      return {
        order: {
          maker: firmRateResp.order.maker,
          taker: firmRateResp.order.taker,
          expiry: firmRateResp.order.expiry,
          nonceAndMeta: firmRateResp.order.nonceAndMeta,
          makerAsset: firmRateResp.order.makerAsset,
          takerAsset: firmRateResp.order.takerAsset,
          makerAmount: firmRateResp.order.makerAmount,
          takerAmount: firmRateResp.order.takerAmount,
        },
        signature: firmRateResp.order.signature,
        takerTokenFillAmount: firmRateResp.order.takerAmount,
        permitMakerAsset: '0x',
        permitTakerAsset: '0x',
      };
    } catch (e) {
      this.logger.error(e);
      throw e;
    }
  }
}

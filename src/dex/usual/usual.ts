import {
  Token,
  Address,
  ExchangePrices,
  PoolPrices,
  AdapterExchangeParam,
  Logger,
  PoolLiquidity,
} from '../../types';
import {
  SwapSide,
  Network,
  UNLIMITED_USD_LIQUIDITY,
  NO_USD_LIQUIDITY,
} from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { IDex } from '../idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { UsualBondData, DexParams } from './types';
import { SimpleExchange } from '../simple-exchange';
import { BI_POWS } from '../../bigint-constants';

export class Usual extends SimpleExchange implements IDex<UsualBondData> {
  readonly hasConstantPriceLargeAmounts = true;
  readonly needWrapNative = false;
  readonly isFeeOnTransferSupported = false;

  logger: Logger;

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
    readonly config: DexParams,
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey);
  }

  async initializePricing(blockNumber: number) {
    // No initialization needed for constant price
  }

  isFromToken(token: string) {
    return token.toLowerCase() === this.config.fromToken.address.toLowerCase();
  }

  isToToken(token: string) {
    return token.toLowerCase() === this.config.toToken.address.toLowerCase();
  }

  isValidTokens(srcToken: string, destToken: string) {
    return this.isFromToken(srcToken) && this.isToToken(destToken);
  }

  getAdapters() {
    return null;
  }

  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    if (!srcToken || !destToken) {
      this.logger.error('Source or destination token is undefined');
      return [];
    }

    const srcTokenAddress = srcToken.address?.toLowerCase();
    const destTokenAddress = destToken.address?.toLowerCase();

    if (!srcTokenAddress || !destTokenAddress) {
      this.logger.error('Source or destination token address is undefined');
      return [];
    }

    if (this.isValidTokens(srcTokenAddress, destTokenAddress)) {
      return [`${this.dexKey}_${this.config.toToken.address}`];
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
  ): Promise<null | ExchangePrices<UsualBondData>> {
    const isValidSwap = this.isValidTokens(srcToken.address, destToken.address);

    if (!isValidSwap) {
      return null;
    }

    const unitOut = BI_POWS[this.config.toToken.decimals]; // 1:1 swap
    const amountsOut = amounts.map(
      amount =>
        (amount * BI_POWS[this.config.toToken.decimals]) /
        BI_POWS[this.config.fromToken.decimals],
    ); // 1:1 swap, so output amounts are the same as input

    return [
      {
        unit: unitOut,
        prices: amountsOut,
        data: {},
        poolAddresses: [this.config.toToken.address],
        exchange: this.dexKey,
        gasCost: 70000,
        poolIdentifier: this.dexKey,
      },
    ];
  }

  getCalldataGasCost(poolPrices: PoolPrices<UsualBondData>): number | number[] {
    return CALLDATA_GAS_COST.DEX_NO_PAYLOAD;
  }

  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: UsualBondData,
    side: SwapSide,
  ): AdapterExchangeParam {
    const payload = '0x';

    return {
      targetExchange: this.config.toToken.address,
      payload,
      networkFee: '0',
    };
  }

  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    const isFromToken = this.isFromToken(tokenAddress);
    const isToToken = this.isToToken(tokenAddress);

    if (!(isFromToken || isToToken)) return [];

    return [
      {
        exchange: this.dexKey,
        address: this.config.toToken.address,
        connectorTokens: [
          isFromToken
            ? {
                ...this.config.toToken,
                // specify that there's no liquidity for toToken => fromToken
                liquidityUSD: NO_USD_LIQUIDITY,
              }
            : {
                ...this.config.fromToken,
                liquidityUSD: UNLIMITED_USD_LIQUIDITY,
              },
        ],
        liquidityUSD: isFromToken ? UNLIMITED_USD_LIQUIDITY : NO_USD_LIQUIDITY,
      },
    ];
  }
}

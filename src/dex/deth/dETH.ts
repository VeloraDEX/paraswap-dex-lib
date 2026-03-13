import {
  Token,
  Address,
  ExchangePrices,
  PoolPrices,
  AdapterExchangeParam,
  PoolLiquidity,
  Logger,
  DexExchangeParam,
} from '../../types';
import {
  SwapSide,
  Network,
  UNLIMITED_USD_LIQUIDITY,
  ETHER_ADDRESS,
} from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getDexKeysWithNetwork, isETHAddress } from '../../utils';
import { IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { SimpleExchange } from '../simple-exchange';
import { dETHConfig, DexParams } from './config';
import { BI_POWS } from '../../bigint-constants';
import { NumberAsString } from '@paraswap/core';
import DELTA_ABI from '../../abi/deth/delta.abi.json';
import { ethers } from 'ethers';

const DELTA_INTERFACE = new ethers.utils.Interface(DELTA_ABI);

export class dETH extends SimpleExchange implements IDex<null, DexParams> {
  readonly hasConstantPriceLargeAmounts = true;
  readonly isFeeOnTransferSupported = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(dETHConfig);

  logger: Logger;

  constructor(
    protected network: Network,
    dexKey: string,
    protected dexHelper: IDexHelper,
    protected config = dETHConfig[dexKey][network],
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey);
  }

  isDETH(tokenAddress: Address) {
    return this.config.wrappedToken === tokenAddress.toLowerCase();
  }

  getAdapters(_side: SwapSide): null {
    return null;
  }

  private getPoolIdentifier(): string {
    return `${this.network}_${this.config.wrappedToken}`;
  }

  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
  ): Promise<string[]> {
    if (isETHAddress(srcToken.address) && this.isDETH(destToken.address)) {
      return [this.getPoolIdentifier()];
    } else if (
      this.isDETH(srcToken.address) &&
      isETHAddress(destToken.address)
    ) {
      return [this.getPoolIdentifier()];
    } else {
      return [];
    }
  }

  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<null>> {
    const canSwap =
      (isETHAddress(srcToken.address) && this.isDETH(destToken.address)) ||
      (this.isDETH(srcToken.address) && isETHAddress(destToken.address));

    if (!canSwap) return null;

    const gasCost = isETHAddress(srcToken.address) ? 6_500 : 9_000;

    return [
      {
        prices: amounts,
        unit: BI_POWS[18],
        gasCost,
        exchange: this.dexKey,
        poolAddresses: [this.config.wrappedToken],
        poolIdentifiers: [this.getPoolIdentifier()],
        data: null,
      },
    ];
  }

  // Returns estimated gas cost of calldata for this DEX in multiSwap
  getCalldataGasCost(poolPrices: PoolPrices<null>): number | number[] {
    return CALLDATA_GAS_COST.DEX_NO_PAYLOAD;
  }

  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: null,
    side: SwapSide,
  ): AdapterExchangeParam {
    return {
      targetExchange: this.config.deltaAdapter,
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
    data: null,
    side: SwapSide,
  ): DexExchangeParam {
    const swapData = isETHAddress(srcToken)
      ? DELTA_INTERFACE.encodeFunctionData('depositNative')
      : DELTA_INTERFACE.encodeFunctionData('withdrawNative', [srcAmount]);

    return {
      needWrapNative: false,
      dexFuncHasRecipient: false,
      exchangeData: swapData,
      targetExchange: this.config.deltaAdapter,
      returnAmountPos: undefined,
    };
  }

  async getTopPoolsForToken(tokenAddress: Address): Promise<PoolLiquidity[]> {
    const isETH = isETHAddress(tokenAddress);
    const isDETH = this.isDETH(tokenAddress);

    if (!isETH && !isDETH) {
      return [];
    }

    return [
      {
        exchange: this.dexKey,
        address: this.config.wrappedToken,
        connectorTokens: [
          isETH
            ? {
                address: this.config.wrappedToken,
                decimals: 18,
              }
            : {
                address: ETHER_ADDRESS,
                decimals: 18,
              },
        ],
        liquidityUSD: UNLIMITED_USD_LIQUIDITY,
      },
    ];
  }
}

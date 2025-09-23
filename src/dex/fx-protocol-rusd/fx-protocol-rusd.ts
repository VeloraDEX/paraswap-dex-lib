import {
  Token,
  Address,
  ExchangePrices,
  PoolPrices,
  AdapterExchangeParam,
  Logger,
  NumberAsString,
  DexExchangeParam,
  PoolLiquidity,
} from '../../types';
import { SwapSide, Network, UNLIMITED_USD_LIQUIDITY } from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getDexKeysWithNetwork } from '../../utils';
import { IDex } from '../idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { DexParams, FxProtocolData } from './types';
import { SimpleExchange } from '../simple-exchange';
import { FxProtocolConfig } from './config';
import { Interface, JsonFragment } from '@ethersproject/abi';
import FxUSD_ABI from '../../abi/fx-protocol/FxUSD.json';
import FxMarket_ABI from '../../abi/fx-protocol/FxMarket.json';
import EthWeETHOralce_ABI from '../../abi/fx-protocol/weETHOralce.json';

import { extractReturnAmountPosition } from '../../executor/utils';
import { FxProtocolRusdEvent } from './fx-protocol-rusd-event';
import { BI_POWS } from '../../bigint-constants';
import { getOnChainState } from './utils';

export class FxProtocolRusd
  extends SimpleExchange
  implements IDex<FxProtocolData>
{
  protected config: DexParams;

  readonly hasConstantPriceLargeAmounts = true;

  readonly needWrapNative = false;

  readonly isFeeOnTransferSupported = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(FxProtocolConfig);

  fxUSDIface: Interface;
  rUSDMarketIface: Interface;
  weETHOracleIface: Interface;
  fxProtocolRusdPool: FxProtocolRusdEvent;
  logger: Logger;

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
  ) {
    super(dexHelper, dexKey);
    const config = FxProtocolConfig[dexKey][network];
    this.fxUSDIface = new Interface(FxUSD_ABI as JsonFragment[]);
    this.rUSDMarketIface = new Interface(FxMarket_ABI as JsonFragment[]);
    this.weETHOracleIface = new Interface(EthWeETHOralce_ABI as JsonFragment[]);
    this.config = {
      rUSDAddress: config.rUSDAddress.toLowerCase(),
      weETHAddress: config.weETHAddress.toLowerCase(),
      rUSDWeETHMarketAddress: config.rUSDWeETHMarketAddress.toLowerCase(),
      weETHOracleAddress: config.weETHOracleAddress.toLowerCase(),
    };
    this.logger = dexHelper.getLogger(dexKey);
    this.fxProtocolRusdPool = new FxProtocolRusdEvent(
      this.dexKey,
      dexHelper,
      this.config.rUSDWeETHMarketAddress,
      this.rUSDMarketIface,
      this.config.weETHOracleAddress,
      this.weETHOracleIface,
      this.logger,
    );
  }

  async initializePricing(blockNumber: number) {
    const poolState = await getOnChainState(
      this.dexHelper.multiContract,
      this.config.rUSDWeETHMarketAddress,
      this.rUSDMarketIface,
      this.config.weETHOracleAddress,
      this.weETHOracleIface,
      blockNumber,
    );

    await this.fxProtocolRusdPool.initialize(blockNumber, {
      state: poolState,
    });
  }

  getConfig() {
    return this.config;
  }

  is_weETH(token: string) {
    return token.toLowerCase() === this.config.weETHAddress.toLowerCase();
  }

  is_rUSD(token: string) {
    return token.toLowerCase() === this.config.rUSDAddress.toLowerCase();
  }

  is_rUSD_swap_token(srcToken: string, destToken: string) {
    return (
      (this.is_weETH(srcToken) && this.is_rUSD(destToken)) ||
      (this.is_rUSD(srcToken) && this.is_weETH(destToken))
    );
  }
  // Returns the list of contract adapters (name and index)
  // for a buy/sell. Return null if there are no adapters.
  getAdapters() {
    return null;
  }

  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    if (!this.is_rUSD_swap_token(srcToken.address, destToken.address)) {
      return [];
    }
    return [`${this.dexKey}_${this.config.rUSDAddress}`];
  }

  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<FxProtocolData>> {
    // note: BUY is not supported
    if (side === SwapSide.BUY) return null;

    const isRUSDSwapToken = this.is_rUSD_swap_token(
      srcToken.address,
      destToken.address,
    );
    if (!isRUSDSwapToken) {
      return null;
    }
    const pool = this.fxProtocolRusdPool;
    const is_redeem = this.is_weETH(destToken.address);
    const unitIn = BI_POWS[18];
    const unitOut = await pool.getPrice(blockNumber, unitIn, is_redeem);
    const amountsOut = await Promise.all(
      amounts.map(_amountIn =>
        pool.getPrice(blockNumber, _amountIn, is_redeem),
      ),
    );

    return [
      {
        unit: unitOut,
        prices: amountsOut,
        data: {},
        poolAddresses: [this.config.rUSDAddress],
        exchange: this.dexKey,
        gasCost: 1000000,
      },
    ];
  }

  // Returns estimated gas cost of calldata for this DEX in multiSwap
  getCalldataGasCost(
    poolPrices: PoolPrices<FxProtocolData>,
  ): number | number[] {
    return CALLDATA_GAS_COST.DEX_NO_PAYLOAD;
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
    data: FxProtocolData,
    side: SwapSide,
  ): AdapterExchangeParam {
    const payload = '0x';

    return {
      targetExchange: this.config.rUSDAddress,
      payload,
      networkFee: '0',
    };
  }

  async getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: FxProtocolData,
    side: SwapSide,
  ): Promise<DexExchangeParam> {
    const is_rUSD_src = this.is_rUSD(srcToken);
    const is_weETH_src = this.is_weETH(srcToken);
    const is_rUSD_dest = this.is_rUSD(destToken);
    const is_weETH_dest = this.is_weETH(destToken);

    if (is_weETH_src && is_rUSD_dest) {
      const exchangeData = this.fxUSDIface.encodeFunctionData('mint', [
        this.config.weETHAddress,
        srcAmount,
        recipient,
        '0',
      ]);
      return {
        needWrapNative: false,
        dexFuncHasRecipient: true,
        exchangeData,
        targetExchange: this.config.rUSDAddress,
        returnAmountPos: extractReturnAmountPosition(
          this.fxUSDIface,
          'mint',
          '_amountOut',
        ),
      };
    }
    if (is_rUSD_src && is_weETH_dest) {
      const exchangeData = this.fxUSDIface.encodeFunctionData('redeem', [
        this.config.weETHAddress,
        srcAmount,
        recipient,
        '0',
      ]);
      return {
        needWrapNative: false,
        dexFuncHasRecipient: true,
        exchangeData,
        targetExchange: this.config.rUSDAddress,
        returnAmountPos: extractReturnAmountPosition(
          this.fxUSDIface,
          'redeem',
          '_amountOut',
        ),
      };
    }
    throw new Error('LOGIC ERROR');
  }

  // Returns list of top pools based on liquidity. Max
  // limit number pools should be returned.
  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    if (!this.is_rUSD(tokenAddress) && !this.is_weETH(tokenAddress)) return [];

    const isWeETH = this.is_weETH(tokenAddress);

    return [
      {
        exchange: this.dexKey,
        address: this.config.rUSDAddress,
        connectorTokens: [
          {
            decimals: 18,
            address: isWeETH
              ? this.config.rUSDAddress
              : this.config.weETHAddress,
          },
        ],
        liquidityUSD: UNLIMITED_USD_LIQUIDITY,
      },
    ];
  }
}

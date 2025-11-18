import {
  Token,
  Address,
  ExchangePrices,
  PoolPrices,
  AdapterExchangeParam,
  PoolLiquidity,
  Logger,
  NumberAsString,
  DexExchangeParam,
} from '../../types';
import { SwapSide, Network, UNLIMITED_USD_LIQUIDITY } from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getDexKeysWithNetwork } from '../../utils';
import { Context, IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { ConcentratorArusdData, DexParams } from './types';
import { SimpleExchange } from '../simple-exchange';
import { ConcentratorArusdConfig } from './config';
import { Interface } from '@ethersproject/abi';
import ArUSD_ABI from '../../abi/concentrator/arUSD.json';
import ArUSD5115_ABI from '../../abi/concentrator/arUSD5115.json';
import { extractReturnAmountPosition } from '../../executor/utils';
import { BI_POWS } from '../../bigint-constants';
import { ConcentratorArusdEvent } from './concentrator-arusd-event';
import { getOnChainState } from './utils';

export class ConcentratorArusd
  extends SimpleExchange
  implements IDex<ConcentratorArusdData>
{
  static readonly arUSDIface = new Interface(ArUSD_ABI);

  protected config: DexParams;

  readonly hasConstantPriceLargeAmounts = true;
  readonly needWrapNative = true;

  readonly isFeeOnTransferSupported = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(ConcentratorArusdConfig);

  arUSD5115Iface: Interface;
  concentratorArusdEvent: ConcentratorArusdEvent;
  logger: Logger;

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
    protected adapters = {},
  ) {
    super(dexHelper, dexKey);
    const config = ConcentratorArusdConfig[dexKey][network];
    this.config = {
      rUSDAddress: config.rUSDAddress.toLowerCase(),
      arUSDAddress: config.arUSDAddress.toLowerCase(),
      arUSD5115Address: config.arUSD5115Address.toLowerCase(),
    };
    this.arUSD5115Iface = new Interface(ArUSD5115_ABI);
    this.logger = dexHelper.getLogger(dexKey);
    this.concentratorArusdEvent = new ConcentratorArusdEvent(
      this.dexKey,
      dexHelper,
      this.config.arUSD5115Address,
      this.arUSD5115Iface,
      this.logger,
    );
  }

  async initializePricing(blockNumber: number) {
    const poolState = await getOnChainState(
      this.dexHelper.multiContract,
      this.config.arUSD5115Address,
      this.arUSD5115Iface,
      blockNumber,
    );

    await this.concentratorArusdEvent.initialize(blockNumber, {
      state: poolState,
    });
  }

  is_arUSD(token: string) {
    return token.toLowerCase() === this.config.arUSDAddress;
  }

  is_rUSD(token: string) {
    return token.toLowerCase() === this.config.rUSDAddress;
  }

  is_arUSD_swap_token(srcToken: string, destToken: string) {
    if (this.is_rUSD(srcToken) && this.is_arUSD(destToken)) {
      return true;
    }
    if (this.is_arUSD(srcToken) && this.is_rUSD(destToken)) {
      return true;
    }
    return false;
  }

  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return null;
  }

  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    if (!this.is_arUSD_swap_token(srcToken.address, destToken.address)) {
      return [];
    }
    return [`${this.dexKey}_${this.config.arUSDAddress}`];
  }

  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<ConcentratorArusdData>> {
    // note: BUY is not supported
    if (side === SwapSide.BUY) return null;

    const isArUSDSwapToken = this.is_arUSD_swap_token(
      srcToken.address,
      destToken.address,
    );
    if (!isArUSDSwapToken) {
      return null;
    }
    const is_deposit = !!this.is_rUSD(srcToken.address);
    const pool = this.concentratorArusdEvent;
    const unitIn = BI_POWS[18];
    const unitOut = await pool.getPrice(blockNumber, unitIn, is_deposit);
    const amountsOut = await Promise.all(
      amounts.map(async amountIn => {
        const _newPrice = await pool.getPrice(
          blockNumber,
          amountIn,
          is_deposit,
        );
        return _newPrice;
      }),
    );
    return [
      {
        unit: unitOut,
        prices: amountsOut,
        data: {},
        poolAddresses: [this.config.arUSDAddress],
        exchange: this.dexKey,
        gasCost: 1000000,
      },
    ];
  }

  // Returns estimated gas cost of calldata for this DEX in multiSwap
  getCalldataGasCost(
    poolPrices: PoolPrices<ConcentratorArusdData>,
  ): number | number[] {
    return CALLDATA_GAS_COST.DEX_NO_PAYLOAD;
  }

  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: ConcentratorArusdData,
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
    data: ConcentratorArusdData,
    side: SwapSide,
    context: Context,
    executorAddress: Address,
  ): Promise<DexExchangeParam> {
    const is_rUSD_src = this.is_rUSD(srcToken);
    const is_arUSD_src = this.is_arUSD(srcToken);
    const is_rUSD_dest = this.is_rUSD(destToken);
    const is_arUSD_dest = this.is_arUSD(destToken);

    if (is_rUSD_src && is_arUSD_dest) {
      const exchangeData = ConcentratorArusd.arUSDIface.encodeFunctionData(
        'deposit',
        [srcAmount, recipient],
      );
      return {
        needWrapNative: false,
        dexFuncHasRecipient: true,
        exchangeData,
        targetExchange: this.config.arUSDAddress,
        returnAmountPos: extractReturnAmountPosition(
          ConcentratorArusd.arUSDIface,
          'deposit',
          'shares',
        ),
      };
    }
    if (is_arUSD_src && is_rUSD_dest) {
      const exchangeData = ConcentratorArusd.arUSDIface.encodeFunctionData(
        'redeem',
        [srcAmount, recipient, executorAddress],
      );
      return {
        needWrapNative: false,
        dexFuncHasRecipient: true,
        exchangeData,
        targetExchange: this.config.arUSDAddress,
        returnAmountPos: extractReturnAmountPosition(
          ConcentratorArusd.arUSDIface,
          'redeem',
          'assets',
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
    if (!this.is_rUSD(tokenAddress) && !this.is_arUSD(tokenAddress)) return [];

    const isArUSD = this.is_arUSD(tokenAddress);

    return [
      {
        exchange: this.dexKey,
        address: this.config.arUSD5115Address,
        connectorTokens: [
          {
            decimals: 18,
            address: isArUSD
              ? this.config.rUSDAddress
              : this.config.arUSDAddress,
          },
        ],
        liquidityUSD: UNLIMITED_USD_LIQUIDITY,
      },
    ];
  }
}

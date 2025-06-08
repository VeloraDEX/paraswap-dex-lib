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
import { getDexKeysWithNetwork } from '../../utils';
import { IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { WstETHData, PoolState, DexParams } from './types';
import { SimpleExchange } from '../simple-exchange';
import { WstETHConfig, Adapters } from './config';
import { uint256ToBigInt } from '../../lib/decoders';
import { Utils } from '../../utils';
import WSTETH_ABI from '../../abi/wstETH.json';
import STETH_ABI from '../../abi/stETH.json';
import { extractReturnAmountPosition } from '../../executor/utils';
import { Interface } from 'ethers';

export class WstETH extends SimpleExchange implements IDex<WstETHData> {
  static readonly wstETHIface = new Interface(WSTETH_ABI);
  static readonly stETHIface = new Interface(STETH_ABI);

  protected config: DexParams;

  readonly hasConstantPriceLargeAmounts = true;

  readonly needWrapNative = false;

  // There aren't actually fees on stETH but it is marked as such
  readonly isFeeOnTransferSupported = true;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(WstETHConfig);

  logger: Logger;

  private state: { blockNumber: number } & PoolState = {
    blockNumber: 0,
    totalPooledEther: 0n,
    totalShares: 0n,
  };

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
    protected adapters = Adapters[network] || {},
  ) {
    super(dexHelper, dexKey);
    const config = WstETHConfig[dexKey][network];
    this.config = {
      wstETHAddress: config.wstETHAddress.toLowerCase(),
      stETHAddress: config.stETHAddress.toLowerCase(),
    };
    this.logger = dexHelper.getLogger(dexKey);
  }

  // Returns the list of contract adapters (name and index)
  // for a buy/sell. Return null if there are no adapters.
  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return this.adapters[side] ? this.adapters[side] : null;
  }

  // Not relevant for hasConstantPriceLargeAmounts exchanges
  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    _blockNumber: number,
  ): Promise<string[]> {
    if (side === SwapSide.BUY) return [];
    const srcTokenAddress = srcToken.address.toLowerCase();
    const destTokenAddress = destToken.address.toLowerCase();
    if (
      !(
        (srcTokenAddress === this.config.wstETHAddress &&
          destTokenAddress === this.config.stETHAddress) ||
        (srcTokenAddress === this.config.stETHAddress &&
          destTokenAddress === this.config.wstETHAddress)
      )
    ) {
      return [];
    }
    return [this.dexKey];
  }

  protected calcWrap = (amount: bigint): bigint =>
    (amount * this.state.totalShares) / this.state.totalPooledEther;

  protected calcUnwrap = (amount: bigint): bigint =>
    (amount * this.state.totalPooledEther) / this.state.totalShares;

  // Returns pool prices for amounts.
  // limitPools always ignored due to hasConstantPriceLargeAmounts
  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    _limitPools?: string[],
  ): Promise<null | ExchangePrices<WstETHData>> {
    if (side === SwapSide.BUY) return null;
    const srcTokenAddress = srcToken.address.toLowerCase();
    const destTokenAddress = destToken.address.toLowerCase();
    if (
      !(
        (srcTokenAddress === this.config.wstETHAddress &&
          destTokenAddress === this.config.stETHAddress) ||
        (srcTokenAddress === this.config.stETHAddress &&
          destTokenAddress === this.config.wstETHAddress)
      )
    ) {
      return null;
    }
    const wrap = srcTokenAddress === this.config.stETHAddress;

    if (blockNumber > this.state.blockNumber) {
      const cached = await this.dexHelper.cache.get(
        this.dexKey,
        this.network,
        'state',
      );
      if (cached) {
        this.state = Utils.Parse(cached);
      }
      if (blockNumber > this.state.blockNumber) {
        const calls = [
          {
            target: this.config.stETHAddress,
            callData: WstETH.stETHIface.encodeFunctionData(
              'getTotalPooledEther',
            ),
            decodeFunction: uint256ToBigInt,
          },
          {
            target: this.config.stETHAddress,
            callData: WstETH.stETHIface.encodeFunctionData('getTotalShares'),
            decodeFunction: uint256ToBigInt,
          },
        ];
        const results = await this.dexHelper.multiWrapper.tryAggregate<bigint>(
          true,
          calls,
          blockNumber,
        );
        this.state = {
          blockNumber,
          totalPooledEther: results[0].returnData,
          totalShares: results[1].returnData,
        };
        this.dexHelper.cache.setex(
          this.dexKey,
          this.network,
          'state',
          60,
          Utils.Serialize(this.state),
        );
      }
    }

    const calc = wrap ? this.calcWrap : this.calcUnwrap;
    return [
      {
        unit: calc(1000000000000000000n),
        prices: amounts.map(calc),
        data: {},
        poolAddresses: [this.config.wstETHAddress],
        exchange: this.dexKey,
        gasCost: wrap ? 60000 : 70000,
        poolIdentifier: this.dexKey,
      },
    ];
  }

  // Returns estimated gas cost of calldata for this DEX in multiSwap
  getCalldataGasCost(_poolPrices: PoolPrices<WstETHData>): number | number[] {
    return CALLDATA_GAS_COST.DEX_NO_PAYLOAD;
  }

  // Encode params required by the exchange adapter
  // Used for multiSwap, buy & megaSwap
  // Hint: abiCoder.encodeParameter() could be useful
  getAdapterParam(
    _srcToken: string,
    _destToken: string,
    _srcAmount: string,
    _destAmount: string,
    _data: WstETHData,
    _side: SwapSide,
  ): AdapterExchangeParam {
    return {
      targetExchange: this.config.wstETHAddress,
      payload: '0x',
      networkFee: '0',
    };
  }

  // Encode call data used by simpleSwap like routers
  // Used for simpleSwap & simpleBuy
  // Hint: this.buildSimpleParamWithoutWETHConversion
  // could be useful
  async getSimpleParam(
    srcToken: string,
    _destToken: string,
    srcAmount: string,
    _destAmount: string,
    _data: WstETHData,
    _side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    if (srcToken.toLowerCase() === this.config.stETHAddress) {
      const approveParam = await this.getApproveSimpleParam(
        this.config.stETHAddress,
        this.config.wstETHAddress,
        srcAmount,
      );
      return {
        callees: [...approveParam.callees, this.config.wstETHAddress],
        calldata: [
          ...approveParam.calldata,
          WstETH.wstETHIface.encodeFunctionData('wrap', [srcAmount]),
        ],
        values: [...approveParam.values, '0'],
        networkFee: '0',
      };
    } else {
      return {
        callees: [this.config.wstETHAddress],
        calldata: [
          WstETH.wstETHIface.encodeFunctionData('unwrap', [srcAmount]),
        ],
        values: ['0'],
        networkFee: '0',
      };
    }
  }

  async getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: WstETHData,
    side: SwapSide,
  ): Promise<DexExchangeParam> {
    const swapFunction =
      srcToken.toLowerCase() === this.config.stETHAddress ? 'wrap' : 'unwrap';
    const exchangeData = WstETH.wstETHIface.encodeFunctionData(swapFunction, [
      srcAmount,
    ]);

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: false,
      exchangeData,
      targetExchange: this.config.wstETHAddress,
      returnAmountPos:
        side === SwapSide.SELL
          ? extractReturnAmountPosition(WstETH.wstETHIface, swapFunction)
          : undefined,
    };
  }

  // Returns list of top pools based on liquidity. Max
  // limit number pools should be returned.
  async getTopPoolsForToken(
    tokenAddress: Address,
    _limit: number,
  ): Promise<PoolLiquidity[]> {
    tokenAddress = tokenAddress.toLowerCase();
    if (
      tokenAddress !== this.config.stETHAddress &&
      tokenAddress !== this.config.wstETHAddress
    ) {
      return [];
    }
    return [
      {
        exchange: this.dexKey,
        address: this.config.wstETHAddress,
        connectorTokens: [
          {
            decimals: 18,
            address:
              tokenAddress === this.config.stETHAddress
                ? this.config.wstETHAddress
                : this.config.stETHAddress,
          },
        ],
        liquidityUSD: 1000000000, // Just returning a big number so this DEX will be preferred
      },
    ];
  }
}

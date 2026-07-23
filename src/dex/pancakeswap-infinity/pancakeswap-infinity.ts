import { NumberAsString, SwapSide } from '@paraswap/core';
import {
  AdapterExchangeParam,
  Address,
  DexExchangeParam,
  PoolLiquidity,
  SimpleExchangeParam,
} from '../../types';
import { IDexTxBuilder } from '../idex';
import { IDexHelper } from '../../dex-helper';
import { PancakeSwapInfinityData } from './types';
import { PancakeSwapInfinityConfig } from './config';
import { isETHAddress } from '../../utils';
import {
  swapExactInputSingleCalldata,
  swapExactOutputSingleCalldata,
} from './encoder';
import { queryAvailablePoolsForToken } from './subgraph';
import { Logger } from 'log4js';
import { NULL_ADDRESS } from '../../constants';

export class PancakeSwapInfinity
  implements IDexTxBuilder<PancakeSwapInfinityData, any>
{
  static dexKeys = ['pancakeswapinfinity'];

  needWrapNative = false;

  private readonly dexKey = 'pancakeswapinfinity';
  private readonly network: number;
  private readonly wethAddress: string;
  private readonly routerAddress: string;
  private readonly subgraphURL: string;
  private readonly logger: Logger;
  private readonly dexHelper: IDexHelper;

  constructor(dexHelper: IDexHelper) {
    this.network = dexHelper.config.data.network;
    this.wethAddress =
      dexHelper.config.data.wrappedNativeTokenAddress.toLowerCase();
    this.logger = dexHelper.getLogger(this.dexKey);
    this.dexHelper = dexHelper;

    const config = PancakeSwapInfinityConfig.PancakeSwapInfinity[this.network];
    this.routerAddress = config.router;
    this.subgraphURL = config.subgraphURL;
  }

  getAdapterParam(
    _srcToken: Address,
    _destToken: Address,
    _srcAmount: NumberAsString,
    _destAmount: NumberAsString,
    _data: PancakeSwapInfinityData,
    _side: SwapSide,
  ): AdapterExchangeParam {
    return {
      targetExchange: this.routerAddress,
      payload: '0x',
      networkFee: '0',
    };
  }

  async getSimpleParam(
    _srcToken: Address,
    _destToken: Address,
    _srcAmount: NumberAsString,
    _destAmount: NumberAsString,
    _data: PancakeSwapInfinityData,
    _side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    return {
      callees: [],
      calldata: [],
      values: [],
      networkFee: '0',
    };
  }

  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: PancakeSwapInfinityData,
    side: SwapSide,
  ): DexExchangeParam {
    const exchangeData =
      side === SwapSide.SELL
        ? swapExactInputSingleCalldata(
            srcToken,
            destToken,
            data,
            BigInt(srcAmount),
            0n,
            recipient,
            this.wethAddress,
          )
        : swapExactOutputSingleCalldata(
            srcToken,
            destToken,
            data,
            BigInt(srcAmount),
            BigInt(destAmount),
            recipient,
            this.wethAddress,
          );

    return {
      needWrapNative: this.needWrapNative,
      sendEthButSupportsInsertFromAmount: true,
      dexFuncHasRecipient: true,
      exchangeData,
      targetExchange: this.routerAddress,
      returnAmountPos: undefined,
      transferSrcTokenBeforeSwap: isETHAddress(srcToken)
        ? undefined
        : this.routerAddress,
      skipApproval: true,
    };
  }

  async getTopPoolsForToken(
    _tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    let tokenAddress = _tokenAddress.toLowerCase();
    if (isETHAddress(tokenAddress)) tokenAddress = NULL_ADDRESS;

    const { pools0, pools1 } = await queryAvailablePoolsForToken(
      this.dexHelper,
      this.logger,
      this.dexKey,
      this.subgraphURL,
      tokenAddress,
      limit,
    );

    if (!(pools0 || pools1)) {
      this.logger.error(
        `Error_${this.dexKey}_Subgraph: couldn't fetch the pools from the subgraph`,
      );
      return [];
    }

    if (pools0.length === 0 && pools1.length === 0) {
      return [];
    }

    const pools0Liquidity: PoolLiquidity[] = pools0.map(pool => ({
      exchange: this.dexKey,
      address: pool.id.toLowerCase(),
      connectorTokens: [
        {
          address: pool.token1.address.toLowerCase(),
          decimals: parseInt(pool.token1.decimals),
        },
      ],
      liquidityUSD: parseFloat(pool.totalValueLockedUSD),
    }));

    const pools1Liquidity: PoolLiquidity[] = pools1.map(pool => ({
      exchange: this.dexKey,
      address: pool.id.toLowerCase(),
      connectorTokens: [
        {
          address: pool.token0.address.toLowerCase(),
          decimals: parseInt(pool.token0.decimals),
        },
      ],
      liquidityUSD: parseFloat(pool.totalValueLockedUSD),
    }));

    const allPools = pools0Liquidity.concat(pools1Liquidity);

    allPools.sort((a, b) => b.liquidityUSD - a.liquidityUSD);

    return allPools.slice(0, limit);
  }
}

import { Interface } from '@ethersproject/abi';
import {
  Token,
  Address,
  ExchangePrices,
  PoolPrices,
  AdapterExchangeParam,
  SimpleExchangeParam,
  PoolLiquidity,
  Logger,
  DexExchangeParam,
} from '../../types';
import {
  SwapSide,
  Network,
  NULL_ADDRESS,
  ETHER_ADDRESS,
  UNLIMITED_USD_LIQUIDITY,
} from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getDexKeysWithNetwork, isETHAddress, getBigIntPow } from '../../utils';
import { IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { Data, Param, PoolAndWethFunctions } from './types';
import { SimpleExchange } from '../simple-exchange';
import { Adapters, Config } from './config';
import {
  getATokenIfAaveV3Pair,
  setTokensOnNetwork,
  TokensByAddress,
} from './tokens';

import WETH_GATEWAY_ABI from '../../abi/aave-v3-weth-gateway.json';
import POOL_ABI from '../../abi/AaveV3_lending_pool.json';
import { fetchTokenList } from './utils';
import { NumberAsString } from '@paraswap/core';

const REF_CODE = 1;
export const TOKEN_LIST_CACHE_KEY = 'token-list';
const TOKEN_LIST_TTL_SECONDS = 24 * 60 * 60;
const TOKEN_LIST_LOCAL_TTL_SECONDS = 3 * 60 * 60;

export class AaveV3 extends SimpleExchange implements IDex<Data, Param> {
  readonly hasConstantPriceLargeAmounts = true;
  readonly isFeeOnTransferSupported = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(Config);

  logger: Logger;

  private pool: Interface;
  private wethGateway: Interface;
  constructor(
    protected network: Network,
    dexKey: string,
    protected dexHelper: IDexHelper,
    protected config = Config[dexKey][network],
    protected adapters = Adapters[network],
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey);
    this.wethGateway = new Interface(WETH_GATEWAY_ABI);
    this.pool = new Interface(POOL_ABI);
  }

  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return this.adapters?.[side] ?? null;
  }

  async initializePricing(blockNumber: number): Promise<void> {
    await this.initializeTokens(blockNumber);
  }

  async initializeTokens(blockNumber?: number): Promise<void> {
    let cachedTokenList = await this.dexHelper.cache.getAndCacheLocally(
      this.dexKey,
      this.network,
      TOKEN_LIST_CACHE_KEY,
      TOKEN_LIST_LOCAL_TTL_SECONDS,
    );
    if (cachedTokenList !== null) {
      setTokensOnNetwork(
        this.network,
        this.dexKey,
        JSON.parse(cachedTokenList),
      );
      return;
    }

    let tokenList = await fetchTokenList(
      this.dexHelper.web3Provider,
      this.config.poolAddress,
      this.pool,
      this.erc20Interface,
      this.dexHelper.multiWrapper,
      blockNumber,
    );

    await this.dexHelper.cache.setex(
      this.dexKey,
      this.network,
      TOKEN_LIST_CACHE_KEY,
      TOKEN_LIST_TTL_SECONDS,
      JSON.stringify(tokenList),
    );

    setTokensOnNetwork(this.network, this.dexKey, tokenList);
  }

  private _getPoolIdentifier(srcToken: Token, destToken: Token): string {
    return (
      this.dexKey +
      [srcToken.address.toLowerCase(), destToken.address.toLowerCase()]
        .sort((a, b) => (a > b ? 1 : -1))
        .join('_')
    );
  }

  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    const aToken = getATokenIfAaveV3Pair(
      this.network,
      this.dexKey,
      this.dexHelper.config.wrapETH(srcToken),
      this.dexHelper.config.wrapETH(destToken),
    );

    if (aToken === null) return [];

    return [this._getPoolIdentifier(srcToken, destToken)];
  }

  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<Data>> {
    const _src = this.dexHelper.config.wrapETH(srcToken);
    const _dst = this.dexHelper.config.wrapETH(destToken);

    const aToken = getATokenIfAaveV3Pair(this.network, this.dexKey, _src, _dst);

    if (!aToken) return null;

    const fromAToken = aToken == _src;

    return [
      {
        prices: amounts,
        unit: getBigIntPow(
          (side === SwapSide.SELL ? destToken : srcToken).decimals,
        ),
        gasCost: isETHAddress(srcToken.address)
          ? this.config.ethGasCost
          : this.config.lendingGasCost,
        exchange: this.dexKey,
        data: {
          isV3: true,
          fromAToken,
        },
        poolAddresses: [fromAToken ? srcToken.address : destToken.address],
        poolIdentifiers: [this._getPoolIdentifier(srcToken, destToken)],
      },
    ];
  }

  // Returns estimated gas cost of calldata for this DEX in multiSwap
  getCalldataGasCost(poolPrices: PoolPrices<Data>): number | number[] {
    return (
      CALLDATA_GAS_COST.DEX_OVERHEAD +
      CALLDATA_GAS_COST.LENGTH_SMALL +
      CALLDATA_GAS_COST.ADDRESS
    );
  }

  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: Data,
    side: SwapSide,
  ): AdapterExchangeParam {
    const aToken = data.fromAToken ? srcToken : destToken; // Warning
    const payload = this.abiCoder.encodeParameter(
      {
        ParentStruct: {
          aToken: 'address',
        },
      },
      { aToken: aToken },
    );

    return {
      // target exchange is not used by the contract
      targetExchange: NULL_ADDRESS,
      payload,
      networkFee: '0',
    };
  }

  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: Data,
    side: SwapSide,
  ): DexExchangeParam {
    const amount = side === SwapSide.SELL ? srcAmount : destAmount;
    const [Interface, swapCallee, swapFunction, swapFunctionParams] = ((): [
      Interface,
      Address,
      PoolAndWethFunctions,
      Param,
    ] => {
      if (isETHAddress(srcToken))
        return [
          this.wethGateway,
          this.config.wethGatewayAddress,
          PoolAndWethFunctions.depositETH,
          [this.config.poolAddress, recipient, REF_CODE],
        ];

      if (isETHAddress(destToken))
        return [
          this.wethGateway,
          this.config.wethGatewayAddress,
          PoolAndWethFunctions.withdrawETH,
          [this.config.poolAddress, amount, recipient],
        ];

      if (data.fromAToken)
        return [
          this.pool,
          this.config.poolAddress,
          PoolAndWethFunctions.withdraw,
          [destToken, amount, recipient],
        ];

      return [
        this.pool,
        this.config.poolAddress,
        PoolAndWethFunctions.supply,
        [srcToken, amount, recipient, REF_CODE],
      ];
    })();

    const exchangeData = Interface.encodeFunctionData(
      swapFunction,
      swapFunctionParams,
    );

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: true,
      exchangeData,
      targetExchange: swapCallee,
      returnAmountPos: undefined,
      skipApproval:
        !data.fromAToken && srcToken.toLowerCase() === ETHER_ADDRESS,
    };
  }

  async getSimpleParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: Data,
    side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    const amount = side === SwapSide.SELL ? srcAmount : destAmount;
    const [Interface, swapCallee, swapFunction, swapFunctionParams] = ((): [
      Interface,
      Address,
      PoolAndWethFunctions,
      Param,
    ] => {
      if (isETHAddress(srcToken))
        return [
          this.wethGateway,
          this.config.wethGatewayAddress,
          PoolAndWethFunctions.depositETH,
          [this.config.poolAddress, this.augustusAddress, REF_CODE],
        ];

      if (isETHAddress(destToken))
        return [
          this.wethGateway,
          this.config.wethGatewayAddress,
          PoolAndWethFunctions.withdrawETH,
          [this.config.poolAddress, amount, this.augustusAddress],
        ];

      if (data.fromAToken)
        return [
          this.pool,
          this.config.poolAddress,
          PoolAndWethFunctions.withdraw,
          [destToken, amount, this.augustusAddress],
        ];

      return [
        this.pool,
        this.config.poolAddress,
        PoolAndWethFunctions.supply,
        [srcToken, amount, this.augustusAddress, REF_CODE],
      ];
    })();

    const swapData = Interface.encodeFunctionData(
      swapFunction,
      swapFunctionParams,
    );

    return this.buildSimpleParamWithoutWETHConversion(
      srcToken,
      amount,
      destToken,
      destAmount,
      swapData,
      swapCallee,
      undefined,
      undefined,
      undefined,
      data.fromAToken,
    );
  }

  async updatePoolState(): Promise<void> {
    await this.initializeTokens();
  }

  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    const address = tokenAddress.toLowerCase();

    const token = TokensByAddress[this.network][this.dexKey][address];
    if (!token) return [];

    const isAToken = token.aAddress === address;

    return [
      {
        exchange: this.dexKey,
        address: token.aAddress,
        connectorTokens: [
          isAToken
            ? {
                address: token.address,
                decimals: token.decimals,
              }
            : {
                address: token.aAddress,
                decimals: token.decimals,
              },
        ],
        liquidityUSD: UNLIMITED_USD_LIQUIDITY,
      },
    ];
  }
}

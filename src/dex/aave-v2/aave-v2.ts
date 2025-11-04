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
  NumberAsString,
  DexExchangeParam,
} from '../../types';
import { SwapSide, Network, NULL_ADDRESS } from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { isETHAddress, getDexKeysWithNetwork, getBigIntPow } from '../../utils';
import { AaveV2Data, AaveV2Param, AaveV2PoolAndWethFunctions } from './types';

import WETH_GATEWAY_ABI_MAINNET from '../../abi/aave-weth-gateway.json';
import WETH_GATEWAY_ABI_POLYGON from '../../abi/aave-weth-gateway-polygon.json';
import WETH_GATEWAY_ABI_AVALANCHE from '../../abi/aave-weth-gateway-avalanche.json';
import AAVE_LENDING_POOL_ABI_V2 from '../../abi/AaveV2_lending_pool.json';

import { IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper/idex-helper';

import { SimpleExchange } from '../simple-exchange';
import {
  AaveV2Config,
  Adapters,
  WETH_GATEWAY,
  aaveLendingPool,
} from './config';
import { isAaveV2Pair } from './tokens';

const WETH_GATEWAY_ABI: any = {
  [Network.MAINNET]: WETH_GATEWAY_ABI_MAINNET,
  [Network.POLYGON]: WETH_GATEWAY_ABI_POLYGON,
  [Network.AVALANCHE]: WETH_GATEWAY_ABI_AVALANCHE,
};

const REF_CODE = 1;

const Aave2ETHGasCost = 246 * 100;
const Aave2LendingGasCost = 328 * 1000;

export class AaveV2
  extends SimpleExchange
  implements IDex<AaveV2Data, AaveV2Param>
{
  readonly hasConstantPriceLargeAmounts = true;
  readonly isFeeOnTransferSupported = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(AaveV2Config);

  logger: Logger;

  private aavePool: Interface;
  private wethGateway: Interface;
  constructor(
    protected network: Network,
    dexKey: string,
    protected dexHelper: IDexHelper,
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey);
    this.wethGateway = new Interface(WETH_GATEWAY_ABI[network]);
    this.aavePool = new Interface(AAVE_LENDING_POOL_ABI_V2);
  }

  // Initialize pricing is called once in the start of
  // pricing service. It is intended to setup the integration
  // for pricing requests. It is optional for a DEX to
  async initializePricing(blockNumber: number) {}

  // Returns the list of contract adapters (name and index)
  // for a buy/sell. Return null if there are no adapters.
  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return Adapters[this.network][side];
  }

  // Returns list of pool identifiers that can be used
  // for a given swap. poolIdentifiers must be unique
  // across DEXes. It is recommended to use
  // ${dexKey}_${poolAddress} as a poolIdentifier
  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    const _src = this.dexHelper.config.wrapETH(srcToken);
    const _dst = this.dexHelper.config.wrapETH(destToken);
    const aToken = isAaveV2Pair(this.network, _src, _dst);
    const fromAToken = aToken == _src;

    if (aToken === null || !fromAToken) {
      return [];
    }
    const tokenAddress = [
      srcToken.address.toLowerCase(),
      destToken.address.toLowerCase(),
    ]
      .sort((a, b) => (a > b ? 1 : -1))
      .join('_');
    return [`${this.dexKey}_${tokenAddress}`];
  }

  // Returns pool prices for amounts.
  // If limitPools is defined only pools in limitPools
  // should be used. If limitPools is undefined then
  // any pools can be used.
  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<AaveV2Data>> {
    const _src = this.dexHelper.config.wrapETH(srcToken);
    const _dst = this.dexHelper.config.wrapETH(destToken);
    const aToken = isAaveV2Pair(this.network, _src, _dst);
    const fromAToken = aToken == _src;
    if (!aToken || !fromAToken) {
      return null;
    }
    return [
      {
        prices: amounts,
        unit: getBigIntPow(
          (side === SwapSide.SELL ? destToken : srcToken).decimals,
        ),
        gasCost: isETHAddress(srcToken.address)
          ? Aave2ETHGasCost
          : Aave2LendingGasCost,
        exchange: this.dexKey,
        data: {
          isV2: true,
          fromAToken,
        },
        poolAddresses: [fromAToken ? srcToken.address : destToken.address],
      },
    ];
  }

  // Returns estimated gas cost of calldata for this DEX in multiSwap
  getCalldataGasCost(poolPrices: PoolPrices<AaveV2Data>): number | number[] {
    return (
      CALLDATA_GAS_COST.DEX_OVERHEAD +
      CALLDATA_GAS_COST.LENGTH_SMALL +
      CALLDATA_GAS_COST.ADDRESS
    );
  }

  // Encode params required by the exchange adapter
  // Used for multiSwap, buy & megaSwap
  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: AaveV2Data,
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

  // Encode call data used by simpleSwap like routers
  // Used for simpleSwap & simpleBuy
  async getSimpleParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: AaveV2Data,
    side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    const amount = side === SwapSide.SELL ? srcAmount : destAmount;
    const [Interface, swapCallee, swapFunction, swapFunctionParams] = ((): [
      Interface,
      Address,
      AaveV2PoolAndWethFunctions,
      AaveV2Param,
    ] => {
      if (isETHAddress(srcToken)) {
        switch (this.network) {
          case 1:
            return [
              this.wethGateway,
              WETH_GATEWAY[this.network],
              AaveV2PoolAndWethFunctions.depositETH,
              [this.augustusAddress, REF_CODE],
            ];
          case 137:
            return [
              this.wethGateway,
              WETH_GATEWAY[this.network],
              AaveV2PoolAndWethFunctions.depositETH,
              [aaveLendingPool[this.network], this.augustusAddress, REF_CODE],
            ];
          case 43114:
            return [
              this.wethGateway,
              WETH_GATEWAY[this.network],
              AaveV2PoolAndWethFunctions.depositETH,
              [aaveLendingPool[this.network], this.augustusAddress, REF_CODE],
            ];
          default:
            throw new Error(`Network ${this.network} not supported`);
        }
      }

      if (isETHAddress(destToken)) {
        switch (this.network) {
          case Network.MAINNET:
            return [
              this.wethGateway,
              WETH_GATEWAY[this.network],
              AaveV2PoolAndWethFunctions.withdrawETH,
              [amount, this.augustusAddress],
            ];
          case Network.POLYGON:
            return [
              this.wethGateway,
              WETH_GATEWAY[this.network],
              AaveV2PoolAndWethFunctions.withdrawETH,
              [aaveLendingPool[this.network], amount, this.augustusAddress],
            ];
          case Network.AVALANCHE:
            return [
              this.wethGateway,
              WETH_GATEWAY[this.network],
              AaveV2PoolAndWethFunctions.withdrawETH,
              [aaveLendingPool[this.network], amount, this.augustusAddress],
            ];
          default:
            throw new Error(`Network ${this.network} not supported`);
        }
      }

      if (data.fromAToken) {
        return [
          this.aavePool,
          aaveLendingPool[this.network],
          AaveV2PoolAndWethFunctions.withdraw,
          [destToken, amount, this.augustusAddress],
        ];
      }

      return [
        this.aavePool,
        aaveLendingPool[this.network],
        AaveV2PoolAndWethFunctions.deposit,
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
    );
  }

  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: AaveV2Data,
    side: SwapSide,
  ): DexExchangeParam {
    const amount = side === SwapSide.SELL ? srcAmount : destAmount;
    const [Interface, swapCallee, swapFunction, swapFunctionParams] = ((): [
      Interface,
      Address,
      AaveV2PoolAndWethFunctions,
      AaveV2Param,
    ] => {
      if (isETHAddress(srcToken)) {
        switch (this.network) {
          case Network.MAINNET:
            return [
              this.wethGateway,
              WETH_GATEWAY[this.network],
              AaveV2PoolAndWethFunctions.depositETH,
              [aaveLendingPool[this.network], recipient, REF_CODE],
            ];
          case Network.POLYGON:
            return [
              this.wethGateway,
              WETH_GATEWAY[this.network],
              AaveV2PoolAndWethFunctions.depositETH,
              [aaveLendingPool[this.network], recipient, REF_CODE],
            ];
          case Network.AVALANCHE:
            return [
              this.wethGateway,
              WETH_GATEWAY[this.network],
              AaveV2PoolAndWethFunctions.depositETH,
              [aaveLendingPool[this.network], recipient, REF_CODE],
            ];
          default:
            throw new Error(`Network ${this.network} not supported`);
        }
      }

      if (isETHAddress(destToken)) {
        switch (this.network) {
          case Network.MAINNET:
            return [
              this.wethGateway,
              WETH_GATEWAY[this.network],
              AaveV2PoolAndWethFunctions.withdrawETH,
              [aaveLendingPool[this.network], amount, recipient],
            ];
          case Network.POLYGON:
            return [
              this.wethGateway,
              WETH_GATEWAY[this.network],
              AaveV2PoolAndWethFunctions.withdrawETH,
              [aaveLendingPool[this.network], amount, recipient],
            ];
          case Network.AVALANCHE:
            return [
              this.wethGateway,
              WETH_GATEWAY[this.network],
              AaveV2PoolAndWethFunctions.withdrawETH,
              [aaveLendingPool[this.network], amount, recipient],
            ];
          default:
            throw new Error(`Network ${this.network} not supported`);
        }
      }

      if (data.fromAToken) {
        return [
          this.aavePool,
          aaveLendingPool[this.network],
          AaveV2PoolAndWethFunctions.withdraw,
          [destToken, amount, recipient],
        ];
      }

      return [
        this.aavePool,
        aaveLendingPool[this.network],
        AaveV2PoolAndWethFunctions.deposit,
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
    };
  }

  // This is called once before getTopPoolsForToken is
  // called for multiple tokens. This can be helpful to
  // update common state required for calculating
  // getTopPoolsForToken. It is optional for a DEX
  updatePoolState(): Promise<void> {
    return Promise.resolve();
  }

  // Returns list of top pools based on liquidity. Max
  // limit number pools should be returned.
  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    return [];
  }
}

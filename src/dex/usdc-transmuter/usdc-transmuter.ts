import { AsyncOrSync } from 'ts-essentials';
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
  NumberAsString,
} from '../../types';
import { SwapSide, Network } from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getDexKeysWithNetwork } from '../../utils';
import { IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { UsdcTransmuterData } from './types';
import { SimpleExchange } from '../simple-exchange';
import { UsdcTransmuterConfig } from './config';
import { UsdcTransmuterEventPool } from './usdc-transmuter-pool';
import {
  gnosisChainUsdcTransmuterAddress,
  gnosisChainUsdcTransmuterTokens,
  gnosisChainUsdcTransmuterAbi,
} from './constants';
import { Interface } from '@ethersproject/abi';

export class UsdcTransmuter
  extends SimpleExchange
  implements IDex<UsdcTransmuterData>
{
  protected eventPools: UsdcTransmuterEventPool;
  protected usdcTransmuterIface: Interface;

  readonly hasConstantPriceLargeAmounts = true;
  readonly needWrapNative = false;

  readonly isFeeOnTransferSupported = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(UsdcTransmuterConfig);

  logger: Logger;

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey);
    this.usdcTransmuterIface = new Interface(gnosisChainUsdcTransmuterAbi);
    this.eventPools = new UsdcTransmuterEventPool(
      dexKey,
      network,
      dexHelper,
      this.logger,
    );
  }

  // Initialize pricing is called once in the start of
  // pricing service. It is intended to setup the integration
  // for pricing requests. It is optional for a DEX to
  // implement this function
  async initializePricing(blockNumber: number) {
    await this.eventPools.initialize(blockNumber, {
      state: {
        initialized: true,
      },
    });
  }

  // Legacy: was only used for V5
  // Returns the list of contract adapters (name and index)
  // for a buy/sell. Return null if there are no adapters.
  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return null;
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
    const srcTokenAddress = srcToken.address.toLowerCase();
    const destTokenAddress = destToken.address.toLowerCase();

    // Check if this is a valid pair for the transmuter
    const validTokens = [
      gnosisChainUsdcTransmuterTokens.USDC.address.toLowerCase(),
      gnosisChainUsdcTransmuterTokens.USDCe.address.toLowerCase(),
    ];

    if (
      validTokens.includes(srcTokenAddress) &&
      validTokens.includes(destTokenAddress) &&
      srcTokenAddress !== destTokenAddress &&
      side === SwapSide.SELL
    ) {
      return [`${this.dexKey}_${gnosisChainUsdcTransmuterAddress}`];
    }

    return [];
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
  ): Promise<null | ExchangePrices<UsdcTransmuterData>> {
    if (side === SwapSide.BUY) {
      return null;
    }

    const srcTokenAddress = srcToken.address.toLowerCase();
    const destTokenAddress = destToken.address.toLowerCase();

    // Check if this is a valid pair for the transmuter
    const validTokens = [
      gnosisChainUsdcTransmuterTokens.USDC.address.toLowerCase(),
      gnosisChainUsdcTransmuterTokens.USDCe.address.toLowerCase(),
    ];

    if (
      !validTokens.includes(srcTokenAddress) ||
      !validTokens.includes(destTokenAddress) ||
      srcTokenAddress === destTokenAddress
    ) {
      return null;
    }

    const poolIdentifier = `${this.dexKey}_${gnosisChainUsdcTransmuterAddress}`;

    if (limitPools && !limitPools.includes(poolIdentifier)) {
      return null;
    }

    // For USDC Transmuter, the exchange rate is always 1:1
    // So the output amount is the same as the input amount
    const prices = amounts.map(amount => amount);

    return [
      {
        prices,
        unit: prices[0],
        data: {
          exchange: gnosisChainUsdcTransmuterAddress,
        },
        poolIdentifier,
        exchange: this.dexKey,
        gasCost: this.getCalldataGasCost(null),
        poolAddresses: [gnosisChainUsdcTransmuterAddress],
      },
    ];
  }

  // Returns estimated gas cost of calldata for this DEX in multiSwap
  getCalldataGasCost(
    poolPrices: PoolPrices<UsdcTransmuterData> | null,
  ): number {
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
    data: UsdcTransmuterData,
    side: SwapSide,
  ): AdapterExchangeParam {
    const { exchange } = data;

    // Determine which function to call based on the source token
    const srcTokenAddress = srcToken.toLowerCase();
    const isDeposit =
      srcTokenAddress ===
      gnosisChainUsdcTransmuterTokens.USDC.address.toLowerCase();

    // Encode the function call
    const functionName = isDeposit ? 'deposit' : 'withdraw';
    const payload = this.usdcTransmuterIface.encodeFunctionData(functionName, [
      srcAmount,
    ]);

    return {
      targetExchange: exchange,
      payload,
      networkFee: '0',
    };
  }

  // This method is required for building the transaction parameters
  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: UsdcTransmuterData,
    side: SwapSide,
  ): DexExchangeParam {
    const srcTokenAddress = srcToken.toLowerCase();
    const isDeposit =
      srcTokenAddress ===
      gnosisChainUsdcTransmuterTokens.USDC.address.toLowerCase();

    // Encode the function call
    const functionName = isDeposit ? 'deposit' : 'withdraw';
    const swapData = this.usdcTransmuterIface.encodeFunctionData(functionName, [
      srcAmount,
    ]);

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: false,
      exchangeData: swapData,
      targetExchange: data.exchange,
      returnAmountPos: undefined,
    };
  }

  // This is called once before getTopPoolsForToken is
  // called for multiple tokens. This can be helpful to
  // update common state required for calculating
  // getTopPoolsForToken. It is optional for a DEX
  // to implement this
  async updatePoolState(): Promise<void> {
    // Nothing to update as the rate is always 1:1
  }

  // Returns list of top pools based on liquidity. Max
  // limit number pools should be returned.
  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    const tokenAddressLower = tokenAddress.toLowerCase();

    // Check if the token is either USDC or USDC.e
    if (
      tokenAddressLower ===
        gnosisChainUsdcTransmuterTokens.USDC.address.toLowerCase() ||
      tokenAddressLower ===
        gnosisChainUsdcTransmuterTokens.USDCe.address.toLowerCase()
    ) {
      // Determine the connector token (the other token in the pair)
      const connectorToken =
        tokenAddressLower ===
        gnosisChainUsdcTransmuterTokens.USDC.address.toLowerCase()
          ? gnosisChainUsdcTransmuterTokens.USDCe
          : gnosisChainUsdcTransmuterTokens.USDC;

      return [
        {
          address: gnosisChainUsdcTransmuterAddress,
          connectorTokens: [
            {
              address: connectorToken.address,
              decimals: connectorToken.decimals,
            },
          ],
          exchange: this.dexKey,
          liquidityUSD: 1000000, // Set a high value to prioritize this pool
        },
      ];
    }

    return [];
  }

  // This is optional function in case if your implementation has acquired any resources
  // you need to release for graceful shutdown. For example, it may be any interval timer
  releaseResources(): AsyncOrSync<void> {
    // No resources to release
  }
}

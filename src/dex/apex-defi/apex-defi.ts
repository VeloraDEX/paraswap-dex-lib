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
} from '../../types';
import { SwapSide, Network } from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getDexKeysWithNetwork } from '../../utils';
import { IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { ApexDefiData } from './types';
import { SimpleExchange } from '../simple-exchange';
import { ApexDefiConfig } from './config';
import { ApexDefiEventPool } from './apex-defi-pool';
import { Interface } from '@ethersproject/abi';
import ApexDefiRouterABI from '../../abi/apex-defi/ApexDefiRouter.abi.json';
import ERC20ABI from '../../abi/erc20.json';
import { ApexDefiFactory, OnPoolCreatedCallback } from './apex-defi-factory';

export class ApexDefi extends SimpleExchange implements IDex<ApexDefiData> {
  readonly eventPools: Record<string, ApexDefiEventPool | null> = {};
  protected supportedTokensMap: { [address: string]: Token } = {};

  protected readonly factory: ApexDefiFactory;

  readonly routerIface: Interface;
  readonly erc20Iface: Interface;

  feeFactor = 10000;

  readonly hasConstantPriceLargeAmounts = false;

  readonly needWrapNative = false;

  readonly isFeeOnTransferSupported = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(ApexDefiConfig);

  logger: Logger;

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
  ) {
    super(dexHelper, dexKey);
    this.routerIface = new Interface(ApexDefiRouterABI);
    this.erc20Iface = new Interface(ERC20ABI);
    this.logger = dexHelper.getLogger(dexKey + '-' + network);

    this.factory = this.getFactoryInstance();
  }

  protected getFactoryInstance(): ApexDefiFactory {
    return new ApexDefiFactory(
      this.dexHelper,
      this.dexKey,
      ApexDefiConfig[this.dexKey][this.network].factoryAddress,
      this.logger,
      this.onPoolCreated().bind(this),
    );
  }

  protected onPoolCreated(): OnPoolCreatedCallback {
    return async ({ pairAddress, blockNumber }) => {
      const logPrefix = '[onPoolCreated]';
      const poolKey = this.getPoolIdentifier(pairAddress);

      this.logger.info(
        `${logPrefix} add pool=${poolKey}; pairAddress=${pairAddress}`,
      );

      const eventPool = new ApexDefiEventPool(
        this.dexKey,
        this.network,
        this.dexHelper,
        this.dexHelper.config.data.wrappedNativeTokenAddress,
        pairAddress,
        pairAddress,
        this.logger,
      );

      // TODO: complete me!
      await eventPool.initialize(blockNumber, {
        state: {
          reserve0: 0n,
          reserve1: 0n,
          fee: 0,
          tradingFee: 0,
        },
      });

      this.eventPools[poolKey] = eventPool;

      this.logger.info(
        `${logPrefix} pool=${poolKey}; pairAddress=${pairAddress} initialized`,
      );
    };
  }

  // Initialize pricing is called once in the start of
  // pricing service. It is intended to setup the integration
  // for pricing requests. It is optional for a DEX to
  // implement this function
  async initializePricing(blockNumber: number) {
    try {
      // Get all supported tokens from the router
      const tokenAddresses = await this.dexHelper.multiContract.methods
        .aggregate([
          {
            target: ApexDefiConfig[this.dexKey][this.network].routerAddress,
            callData: this.routerIface.encodeFunctionData('getAllTokens', []),
          },
        ])
        .call({}, blockNumber);

      const tokens = this.routerIface.decodeFunctionResult(
        'getAllTokens',
        tokenAddresses.returnData[0],
      )[0] as Address[];

      if (!tokens.length) {
        this.logger.info('No tokens found in ApexDefi router');
        return;
      }

      // Get decimals for all tokens using multicall
      const decimalsCallData = this.erc20Iface.encodeFunctionData('decimals');
      const tokenDecimalsMultiCall = tokens.map(token => ({
        target: token,
        callData: decimalsCallData,
      }));

      const decimalsResult = await this.dexHelper.multiContract.methods
        .aggregate(tokenDecimalsMultiCall)
        .call({}, blockNumber);

      // Create Token objects and add to supportedTokensMap
      const tokenDecimals = decimalsResult.returnData.map((r: any) =>
        parseInt(
          this.erc20Iface.decodeFunctionResult('decimals', r)[0].toString(),
        ),
      );

      tokens.forEach((token, i) => {
        const tokenObj: Token = {
          address: token.toLowerCase(),
          decimals: tokenDecimals[i],
        };
        this.supportedTokensMap[token.toLowerCase()] = tokenObj;

        // Create event pool for each token
        const poolKey = this.getPoolIdentifier(token);
        if (!this.eventPools[poolKey]) {
          const eventPool = new ApexDefiEventPool(
            this.dexKey,
            this.network,
            this.dexHelper,
            this.dexHelper.config.data.wrappedNativeTokenAddress,
            token,
            token,
            this.logger,
          );

          this.eventPools[poolKey] = eventPool;
        }
      });

      this.logger.info(
        `Initialized ${tokens.length} tokens for ApexDefi on network ${this.network}`,
      );
    } catch (error) {
      this.logger.error('Error initializing ApexDefi pricing:', error);
    }
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
    if (srcToken.address.toLowerCase() === destToken.address.toLowerCase()) {
      return [];
    }

    const pairAddress = this.getPoolAddress(srcToken, destToken);

    return [this.getPoolIdentifier(pairAddress).toLowerCase()];
  }

  protected getPoolIdentifier(pairAddress: string): string {
    return `${this.dexKey}_${pairAddress}`.toLowerCase();
  }

  protected getPoolAddress(srcToken: Token, destToken: Token): string {
    // ERC314 pairs are always in the format of WETH/token
    // If the srcToken is WETH, then the pair address is the destToken address
    // Otherwise, the pair address is the srcToken address
    if (this.dexHelper.config.isWETH(srcToken.address)) {
      return destToken.address;
    } else {
      return srcToken.address;
    }
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
  ): Promise<null | ExchangePrices<ApexDefiData>> {
    // TODO: complete me!

    // if the pool is not found, we need to fallback to rpc

    return null;
  }

  // Returns estimated gas cost of calldata for this DEX in multiSwap
  getCalldataGasCost(poolPrices: PoolPrices<ApexDefiData>): number | number[] {
    // TODO: update if there is any payload in getAdapterParam
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
    data: ApexDefiData,
    side: SwapSide,
  ): AdapterExchangeParam {
    // TODO: complete me!
    const { path } = data;

    // Encode here the payload for adapter
    const payload = '';

    return {
      targetExchange: ApexDefiConfig[this.dexKey][this.network].routerAddress,
      payload,
      networkFee: '0',
    };
  }

  // This is called once before getTopPoolsForToken is
  // called for multiple tokens. This can be helpful to
  // update common state required for calculating
  // getTopPoolsForToken. It is optional for a DEX
  // to implement this
  async updatePoolState(): Promise<void> {
    return Promise.resolve();
  }

  // Returns list of top pools based on liquidity. Max
  // limit number pools should be returned.
  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    //TODO: complete me!
    return [];
  }

  // This is optional function in case if your implementation has acquired any resources
  // you need to release for graceful shutdown. For example, it may be any interval timer
  releaseResources(): AsyncOrSync<void> {
    // TODO: complete me!
  }
}

import { Interface } from '@ethersproject/abi';
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
import { AlpacaData, DexParams, IInvestPoolProps } from './types';
import { SimpleExchange } from '../simple-exchange';
import { AlpacaConfig, Adapters } from './config';
import { AlpacaEventPool } from './alpaca-pool';
import { InvestPoolEntities } from './investPoolEntities';
import ERC20ABI from '../../abi/erc20.json';
import POOLROUTERABI from '../../abi/alpaca/PoolRouter.json';
import { BigNumber, constants } from 'ethers';
import { compareAddress, mulTruncateBN } from './utils';
import { formatEther } from 'ethers/lib/utils';

const AlpacaGasCost = 3500 * 1000;

export class Alpaca extends SimpleExchange implements IDex<AlpacaData> {
  protected eventPools: AlpacaEventPool;
  protected supportedTokens: Token[] = [];

  readonly hasConstantPriceLargeAmounts = false;

  readonly needWrapNative = true;

  readonly isFeeOnTransferSupported = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(AlpacaConfig);

  public static erc20Interface = new Interface(ERC20ABI);
  public static poolRouterInterface = new Interface(POOLROUTERABI);

  vaultUSDBalance: number = 0;

  logger: Logger;

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
    protected adapters = Adapters[network] || {}, // TODO: add any additional optional params to support other fork DEXes
    protected config: DexParams = AlpacaConfig[dexKey][network],
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey);
    this.eventPools = new AlpacaEventPool(
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
    await this.eventPools.initialize(blockNumber);
  }

  // Returns the list of contract adapters (name and index)
  // for a buy/sell. Return null if there are no adapters.
  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return this.adapters[side] ? this.adapters[side] : null;
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
    const supportTokens = this._getSupportToken(srcToken, destToken);

    if (supportTokens.length !== 2) return [];

    return supportTokens.map(token => {
      return this.dexKey + '_' + token.address;
    });
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
  ): Promise<null | ExchangePrices<AlpacaData>> {
    const supportTokens = this._getSupportToken(srcToken, destToken);

    if (supportTokens.length === 0) return null;

    const poolState = await this.eventPools.generateState(blockNumber);

    const pools = new InvestPoolEntities(
      poolState.investPool as IInvestPoolProps[],
    );

    const prices = amounts.map(amount => {
      return pools.estimateSwapAmountOut(srcToken, destToken, amount);
    });

    return [
      {
        prices: prices.map(price => {
          return price.toBigInt();
        }),
        unit: prices[0].toBigInt(),
        gasCost: AlpacaGasCost,
        exchange: this.dexKey,
        data: {},
        poolAddresses: [this.config.poolRouter],
      },
    ];
  }

  // Returns estimated gas cost of calldata for this DEX in multiSwap
  getCalldataGasCost(poolPrices: PoolPrices<AlpacaData>): number | number[] {
    return CALLDATA_GAS_COST.DEX_NO_PAYLOAD;
  }

  // Encode params required by the exchange adapter
  // Used for multiSwap, buy & megaSwap
  // Hint: abiCoder.encodeParameter() could be useful
  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: AlpacaData,
    side: SwapSide,
  ): AdapterExchangeParam {
    // Encode here the payload for adapter
    const payload = '0x';

    return {
      targetExchange: this.config.poolRouter,
      payload,
      networkFee: '0',
    };
  }

  // Encode call data used by simpleSwap like routers
  // Used for simpleSwap & simpleBuy
  // Hint: this.buildSimpleParamWithoutWETHConversion
  // could be useful
  async getSimpleParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: AlpacaData,
    side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    const investPools: IInvestPoolProps[] =
      await this.eventPools.getInvestPools();

    return {
      callees: [srcToken, this.config.poolRouter],
      calldata: [
        Alpaca.erc20Interface.encodeFunctionData('approve', [
          this.config.poolRouter,
          srcAmount,
        ]),
        Alpaca.poolRouterInterface.encodeFunctionData('swap', [
          srcToken,
          destToken,
          BigNumber.from(srcAmount),
          BigNumber.from(destAmount),
          this.augustusAddress,
          investPools.map(investPool => {
            return investPool.priceUpdateData;
          }),
        ]),
      ],
      values: ['0', investPools.length.toString()],
      networkFee: '0',
    };
  }

  // This is called once before getTopPoolsForToken is
  // called for multiple tokens. This can be helpful to
  // update common state required for calculating
  // getTopPoolsForToken. It is optional for a DEX
  // to implement this
  async updatePoolState(): Promise<void> {
    if (!this.supportedTokens.length) {
      this.supportedTokens = Object.values(this.config.alpacaPoolTokens).map(
        poolToken => {
          return {
            address: poolToken.address,
            decimals: poolToken.decimal,
          };
        },
      );
    }

    const investPools: IInvestPoolProps[] =
      await this.eventPools.getInvestPools();

    this.vaultUSDBalance = investPools.reduce(
      (acc: number, cur: IInvestPoolProps) => {
        return (
          acc +
          parseFloat(formatEther(mulTruncateBN(cur.liquidity, cur.maxPrice)))
        );
      },
      0,
    );
  }

  // Returns list of top pools based on liquidity. Max
  // limit number pools should be returned.
  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    if (
      !this.supportedTokens.some(t => compareAddress(t.address, tokenAddress))
    )
      return [];
    return [
      {
        exchange: this.dexKey,
        address: this.config.poolRouter,
        connectorTokens: this.supportedTokens.filter(
          t => !compareAddress(t.address, tokenAddress),
        ),
        liquidityUSD: this.vaultUSDBalance,
      },
    ];
  }

  // This is optional function in case if your implementation has acquired any resources
  // you need to release for graceful shutdown. For example, it may be any interval timer
  releaseResources(): AsyncOrSync<void> {
    // TODO: complete me!
  }

  private _getSupportToken(srcToken: Token, destToken: Token): Token[] {
    let srcAddress = undefined;
    let destAddress = undefined;
    for (const token of Object.values(this.config.alpacaPoolTokens)) {
      if (compareAddress(srcToken.address, token.address)) {
        srcAddress = srcToken.address.toLowerCase();
      }
      if (compareAddress(destToken.address, token.address)) {
        destAddress = destToken.address.toLowerCase();
      }
    }
    if (
      !srcAddress ||
      !destAddress ||
      compareAddress(srcAddress, destAddress)
    ) {
      return [];
    }
    return [srcToken, destToken];
  }
}

import { AsyncOrSync } from 'ts-essentials';
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
import { AngleTransmuterData, DexParams } from './types';
import { SimpleExchange } from '../simple-exchange';
import { AngleTransmuterConfig, Adapters } from './config';
import { AngleTransmuterEventPool } from './angle-transmuter-pool';
import { Interface, formatUnits, parseUnits } from 'ethers/lib/utils';
import { TransmuterSubscriber } from './transmuter';
import ERC20ABI from '../../abi/erc20.json';
import { extractReturnAmountPosition } from '../../executor/utils';

const TransmuterGasCost = 350000;

export class AngleTransmuter
  extends SimpleExchange
  implements IDex<AngleTransmuterData>
{
  protected eventPools: { [key: string]: AngleTransmuterEventPool } = {};
  protected supportedTokensMap: {
    [key: string]: { [address: string]: boolean };
  } = {};
  protected supportedTokens: { [key: string]: Token[] } = {};
  protected transmuterUSDLiquidity: { [key: string]: number } = {};
  stablecoinList: string[];

  public static erc20Interface = new Interface(ERC20ABI);

  readonly hasConstantPriceLargeAmounts = false;
  readonly needWrapNative = true;

  readonly isFeeOnTransferSupported = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(AngleTransmuterConfig);

  logger: Logger;

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
    protected adapters = Adapters[network] || {},
    protected params: DexParams = AngleTransmuterConfig[dexKey][network],
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey);
    this.stablecoinList = Object.keys(params);
    this.stablecoinList.forEach(stablecoin => {
      this.supportedTokensMap[stablecoin] = {};
      this.supportedTokens[stablecoin] = [];
      this.transmuterUSDLiquidity[stablecoin] = 0;
    });
    this.stablecoinList.forEach(stablecoin => {
      this.supportedTokensMap[stablecoin][
        params[stablecoin as keyof DexParams]!.stablecoin.address.toLowerCase()
      ] = true;
    });
  }

  // Initialize pricing is called once in the start of
  // pricing service. It is intended to setup the integration
  // for pricing requests. It is optional for a DEX to
  // implement this function
  async initializePricing(blockNumber: number) {
    for (const stablecoin of this.stablecoinList) {
      const config = await AngleTransmuterEventPool.getConfig(
        this.params[stablecoin as keyof DexParams]!,
        blockNumber,
        this.dexHelper.multiContract,
      );
      config.collaterals.forEach(
        (token: Address) =>
          (this.supportedTokensMap[stablecoin][token.toLowerCase()] = true),
      );
      this.eventPools[stablecoin] = new AngleTransmuterEventPool(
        this.dexKey,
        this.network,
        this.dexHelper,
        this.logger,
        config,
      );
      await this.eventPools[stablecoin].initialize(blockNumber);
    }
  }

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
    const knownInfo = this._knownAddress(srcToken, destToken);
    if (!knownInfo) return [];
    return [`${this.dexKey}_${knownInfo.agToken.toLowerCase()}`];
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
  ): Promise<null | ExchangePrices<AngleTransmuterData>> {
    const knownInfo = this._knownAddress(srcToken, destToken);

    if (!knownInfo) {
      return null;
    }

    const pool = `${this.dexKey}_${knownInfo.agToken.toLowerCase()}`;

    if (limitPools && limitPools.length > 0 && !limitPools.includes(pool)) {
      return null;
    }

    const fiat = knownInfo.fiatName as keyof DexParams;
    const preProcessDecimals =
      side === SwapSide.SELL ? srcToken.decimals : destToken.decimals;
    const postProcessDecimals =
      side === SwapSide.SELL ? destToken.decimals : srcToken.decimals;
    const unitVolume = 1;
    const amountsFloat = amounts.map(amount =>
      Number.parseFloat(formatUnits(amount.toString(), preProcessDecimals)),
    );

    const prices = await this.eventPools[fiat]!.getAmountOut(
      srcToken.address.toLowerCase(),
      destToken.address.toLowerCase(),
      side,
      [unitVolume, ...amountsFloat],
      blockNumber,
    );

    if (!prices) return null;

    const pricesBigInt = prices.map(price =>
      BigInt(
        parseUnits(
          price.toFixed(postProcessDecimals).toString(),
          postProcessDecimals,
        ).toString(),
      ),
    );

    return [
      {
        prices: pricesBigInt.slice(1),
        unit: pricesBigInt[0],
        gasCost: TransmuterGasCost,
        exchange: this.dexKey,
        data: { exchange: this.params[fiat]!.transmuter },
        poolAddresses: [this.params[fiat]!.transmuter],
        poolIdentifiers: [pool],
      },
    ];
  }

  // Returns estimated gas cost of calldata for this DEX in multiSwap
  getCalldataGasCost(
    poolPrices: PoolPrices<AngleTransmuterData>,
  ): number | number[] {
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
    data: AngleTransmuterData,
    side: SwapSide,
  ): AdapterExchangeParam {
    const { exchange } = data;

    // Encode here the payload for adapter
    const payload = '';

    return {
      targetExchange: exchange,
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
    data: AngleTransmuterData,
    side: SwapSide,
    _: Context,
    executorAddress: Address,
  ): DexExchangeParam {
    const { exchange } = data;

    // Encode here the transaction arguments
    const swapData =
      TransmuterSubscriber.transmuterCrosschainInterface.encodeFunctionData(
        side === SwapSide.SELL ? 'swapExactInput' : 'swapExactOutput',
        [
          side === SwapSide.SELL ? srcAmount : destAmount,
          side === SwapSide.SELL ? destAmount : srcAmount,
          srcToken,
          destToken,
          recipient,
          0,
        ],
      );

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: true,
      exchangeData: swapData,
      targetExchange: exchange,
      returnAmountPos:
        side === SwapSide.SELL
          ? extractReturnAmountPosition(
              TransmuterSubscriber.transmuterCrosschainInterface,
              'swapExactInput',
              'amountOut',
            )
          : undefined,
    };
  }

  async updatePoolState(): Promise<void> {
    for (const stablecoin of this.stablecoinList) {
      const fiat = stablecoin as keyof DexParams;
      const paramFiat = this.params[fiat]!;

      if (!this.supportedTokens.length) {
        let tokenAddresses = await AngleTransmuterEventPool.getCollateralsList(
          paramFiat.transmuter,
          'latest',
          this.dexHelper.multiContract,
        );
        tokenAddresses = tokenAddresses.concat([paramFiat.stablecoin.address]);

        const decimalsCallData =
          AngleTransmuter.erc20Interface.encodeFunctionData('decimals');
        const tokenBalanceMultiCall = tokenAddresses.map(t => ({
          target: t,
          callData: decimalsCallData,
        }));
        const res = (
          await this.dexHelper.multiContract.methods
            .aggregate(tokenBalanceMultiCall)
            .call()
        ).returnData;

        const tokenDecimals = res.map((r: any) =>
          Number.parseInt(
            AngleTransmuter.erc20Interface
              .decodeFunctionResult('decimals', r)[0]
              .toString(),
          ),
        );

        this.supportedTokens[fiat] = tokenAddresses.map((t, i) => ({
          address: t,
          decimals: tokenDecimals[i],
        }));
      }

      // Only work if there are no managers
      const erc20BalanceCalldata =
        AngleTransmuter.erc20Interface.encodeFunctionData('balanceOf', [
          paramFiat.transmuter,
        ]);
      const tokenBalanceMultiCall = this.supportedTokens[fiat].map(t => ({
        target: t.address,
        callData: erc20BalanceCalldata,
      }));
      const res = (
        await this.dexHelper.multiContract.methods
          .aggregate(tokenBalanceMultiCall)
          .call()
      ).returnData;
      const tokenBalances = res.map((r: any) =>
        BigInt(
          AngleTransmuter.erc20Interface
            .decodeFunctionResult('balanceOf', r)[0]
            .toString(),
        ),
      );

      // TODO bC3M price not detected
      const tokenBalancesUSD = await Promise.all(
        this.supportedTokens[fiat].map((t, i) =>
          this.dexHelper.getTokenUSDPrice(t, tokenBalances[i]),
        ),
      );
      this.transmuterUSDLiquidity[fiat] = tokenBalancesUSD.reduce(
        (sum: number, curr: number) => sum + curr,
      );
    }
  }

  // Returns list of top pools based on liquidity. Max
  // limit number pools should be returned.
  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    const tokenAddressLower = tokenAddress.toLowerCase();
    for (const stablecoin of this.stablecoinList) {
      const fiat = stablecoin as keyof DexParams;
      const paramFiat = this.params[fiat]!;
      const stableCoinLowercase = paramFiat.stablecoin.address.toLowerCase();

      // If not this stable let's check another one
      if (
        !this.supportedTokens[fiat].some(
          t => t.address.toLowerCase() === tokenAddressLower,
        )
      )
        continue;

      const connectorTokens =
        tokenAddressLower === stableCoinLowercase
          ? this.supportedTokens[fiat].filter(
              token => token.address.toLowerCase() !== stableCoinLowercase,
            )
          : [paramFiat.stablecoin];

      let liquidityUSD: number;
      if (tokenAddressLower === stableCoinLowercase) {
        liquidityUSD = this.transmuterUSDLiquidity[fiat];
      } else {
        liquidityUSD = UNLIMITED_USD_LIQUIDITY;
      }

      return [
        {
          exchange: this.dexKey,
          address: paramFiat.transmuter,
          connectorTokens: connectorTokens.slice(0, limit),
          liquidityUSD,
        },
      ];
    }

    return [];
  }

  releaseResources(): AsyncOrSync<void> {
    Object.values(this.eventPools).forEach(pool => pool.releaseResources());
  }

  _knownAddress(
    srcToken: Token,
    destToken: Token,
  ): { agToken: string; fiatName: string } | null {
    const srcAddress = this.dexHelper.config
      .wrapETH(srcToken)
      .address.toLowerCase();
    const destAddress = this.dexHelper.config
      .wrapETH(destToken)
      .address.toLowerCase();

    for (const stablecoin of this.stablecoinList) {
      const fiat = stablecoin as keyof DexParams;
      const paramFiat = this.params[fiat]!;
      if (
        srcAddress !== destAddress &&
        this.supportedTokensMap[stablecoin][srcAddress] &&
        this.supportedTokensMap[stablecoin][destAddress] &&
        // check that at least one of the tokens is EURA
        (srcAddress === paramFiat.stablecoin.address.toLowerCase() ||
          destAddress === paramFiat.stablecoin.address.toLowerCase())
      ) {
        return {
          agToken: paramFiat.stablecoin.address.toLowerCase(),
          fiatName: stablecoin,
        };
      }
    }
    return null;
  }
}

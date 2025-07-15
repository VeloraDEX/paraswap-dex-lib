import { Interface } from '@ethersproject/abi';
import type { AsyncOrSync } from 'ts-essentials';
import type {
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
import type { Context, IDex } from '../../dex/idex';
import type { IDexHelper } from '../../dex-helper/idex-helper';
import type { AngleStakedStableData, DexParams } from './types';
import { SimpleExchange } from '../simple-exchange';
import { AngleStakedStableConfig, Adapters } from './config';
import { AngleStakedStableEventPool } from './angle-staked-stable-pool';

// https://dashboard.tenderly.co/paraswap/paraswap/simulator/51688afb-c603-48cf-aa2c-9629c65b1bf9/gas-usage
const AngleStakedGasCost = 70_000;

export class AngleStakedStable
  extends SimpleExchange
  implements IDex<AngleStakedStableData>
{
  protected config: DexParams;

  readonly hasConstantPriceLargeAmounts = false;
  readonly needWrapNative = true;

  readonly isFeeOnTransferSupported = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(AngleStakedStableConfig);

  logger: Logger;

  protected eventPools: { [key: string]: AngleStakedStableEventPool } = {};
  protected isPaused: { [key: string]: boolean } = {};

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
    protected adapters = Adapters[network] || {},
  ) {
    super(dexHelper, dexKey);
    const config = AngleStakedStableConfig[dexKey][network];
    this.logger = dexHelper.getLogger(dexKey);
    this.config = {
      stakeToken: config.stakeToken.toLowerCase(),
      agToken: config.agToken.toLowerCase(),
    };
  }

  async initializePricing(blockNumber: number) {
    this.eventPools[this.config.stakeToken] = new AngleStakedStableEventPool(
      this.dexKey,
      this.network,
      this.dexHelper,
      this.config.stakeToken,
      this.config.agToken,
      this.logger,
    );
    await this.eventPools[this.config.stakeToken].initialize(blockNumber);
  }

  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return this.adapters[side] ? this.adapters[side] : null;
  }

  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    const knownInfo = this._knownAddress(srcToken, destToken);
    if (!knownInfo.known) return [];
    return [`${this.dexKey}_${knownInfo.stakeToken!.toLowerCase()}`];
  }

  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<AngleStakedStableData>> {
    const srcTokenAddress = srcToken.address.toLowerCase();
    const destTokenAddress = destToken.address.toLowerCase();
    const knownInfo = this._knownAddress(srcToken, destToken);
    if (!knownInfo.known) return null;

    const agToken = knownInfo.agToken!;
    const stakeToken = knownInfo.stakeToken!;
    const eventPool = this.eventPools[stakeToken];
    const exchange = `${this.dexKey}`;
    const state = await eventPool?.getOrGenerateState(blockNumber);
    if (this.eventPools === null || state === undefined || state === null)
      return null;
    if (srcTokenAddress === agToken && side === SwapSide.SELL)
      return [
        {
          prices: amounts.map(amount =>
            eventPool.getRateDeposit(amount, state),
          ),
          unit: eventPool.getRateDeposit(1n * BigInt(10 ** 18), state),
          gasCost: AngleStakedGasCost,
          exchange: exchange,
          data: { exchange: stakeToken },
          poolAddresses: [stakeToken],
        },
      ];
    if (destTokenAddress === agToken && side === SwapSide.SELL)
      return [
        {
          prices: amounts.map(share => eventPool.getRateRedeem(share, state)),
          unit: eventPool.getRateRedeem(1n * BigInt(10 ** 18), state),
          gasCost: AngleStakedGasCost,
          exchange: exchange,
          data: { exchange: stakeToken },
          poolAddresses: [stakeToken],
        },
      ];
    if (srcTokenAddress === agToken && side === SwapSide.BUY)
      return [
        {
          prices: amounts.map(share => eventPool.getRateMint(share, state)),
          unit: eventPool.getRateMint(1n * BigInt(10 ** 18), state),
          gasCost: AngleStakedGasCost,
          exchange: exchange,
          data: { exchange: stakeToken },
          poolAddresses: [stakeToken],
        },
      ];
    return [
      {
        prices: amounts.map(amount => eventPool.getRateWithdraw(amount, state)),
        unit: eventPool.getRateWithdraw(1n * BigInt(10 ** 18), state),
        gasCost: AngleStakedGasCost,
        exchange: exchange,
        data: { exchange: stakeToken },
        poolAddresses: [stakeToken],
      },
    ];
  }

  // Returns estimated gas cost of calldata for this DEX in multiSwap
  getCalldataGasCost(
    poolPrices: PoolPrices<AngleStakedStableData>,
  ): number | number[] {
    return CALLDATA_GAS_COST.DEX_NO_PAYLOAD;
  }

  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: AngleStakedStableData,
    side: SwapSide,
  ): AdapterExchangeParam {
    const { exchange } = data;

    const payload = this.abiCoder.encodeParameter(
      {
        ParentStruct: {
          toStaked: 'bool',
        },
      },
      {
        toStaked: srcToken.toLowerCase() === this.config.agToken,
      },
    );

    return {
      targetExchange: exchange,
      payload,
      networkFee: '0',
    };
  }

  async getSimpleParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: AngleStakedStableData,
    side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    const { exchange } = data;

    // Encode here the transaction arguments
    const swapData =
      srcToken.toLowerCase() === this.config.agToken
        ? AngleStakedStableEventPool.angleStakedStableIface.encodeFunctionData(
            side === SwapSide.SELL ? 'deposit' : 'mint',
            [
              side === SwapSide.SELL ? srcAmount : destAmount,
              this.augustusAddress,
            ],
          )
        : AngleStakedStableEventPool.angleStakedStableIface.encodeFunctionData(
            side === SwapSide.SELL ? 'redeem' : 'withdraw',
            [
              side === SwapSide.SELL ? srcAmount : destAmount,
              this.augustusAddress,
              this.augustusAddress,
            ],
          );
    const skipApproval = srcToken.toLowerCase() !== this.config.agToken;

    return this.buildSimpleParamWithoutWETHConversion(
      srcToken,
      srcAmount,
      destToken,
      destAmount,
      swapData,
      exchange,
      undefined,
      undefined,
      undefined,
      skipApproval,
    );
  }

  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: AngleStakedStableData,
    side: SwapSide,
    _: Context,
    executorAddress: Address,
  ): DexExchangeParam {
    const { exchange } = data;

    const swapData =
      srcToken.toLowerCase() === this.config.agToken
        ? AngleStakedStableEventPool.angleStakedStableIface.encodeFunctionData(
            side === SwapSide.SELL ? 'deposit' : 'mint',
            [side === SwapSide.SELL ? srcAmount : destAmount, recipient],
          )
        : AngleStakedStableEventPool.angleStakedStableIface.encodeFunctionData(
            side === SwapSide.SELL ? 'redeem' : 'withdraw',
            [
              side === SwapSide.SELL ? srcAmount : destAmount,
              recipient,
              executorAddress,
            ],
          );

    const skipApproval = srcToken.toLowerCase() !== this.config.agToken;

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: true,
      exchangeData: swapData,
      targetExchange: exchange,
      returnAmountPos: undefined,
      skipApproval,
    };
  }

  // This is called once before getTopPoolsForToken is
  // called for multiple tokens. This can be helpful to
  // update common state required for calculating
  // getTopPoolsForToken. It is optional for a DEX
  // to implement this
  async updatePoolState(): Promise<void> {
    const tokenBalanceMultiCall = [
      {
        target: this.config.stakeToken,
        callData:
          AngleStakedStableEventPool.angleStakedStableIface.encodeFunctionData(
            'paused',
          ),
      },
    ];
    const returnData = (
      await this.dexHelper.multiContract.methods
        .aggregate(tokenBalanceMultiCall)
        .call()
    ).returnData;

    this.isPaused[this.config.stakeToken] =
      AngleStakedStableEventPool.angleStakedStableIface.decodeFunctionResult(
        'paused',
        returnData[0],
      )[0] as boolean;
  }

  // Returns list of top pools based on liquidity. Max
  // limit number pools should be returned.
  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    if (
      this.isPaused[this.config.stakeToken] ||
      (tokenAddress.toLowerCase() !== this.config.agToken &&
        tokenAddress.toLowerCase() !== this.config.stakeToken)
    ) {
      return [];
    }

    return [
      {
        exchange: this.dexKey,
        address: this.config.stakeToken,
        connectorTokens: [
          tokenAddress.toLowerCase() === this.config.agToken
            ? ({ address: this.config.stakeToken, decimals: 18 } as Token)
            : ({ address: this.config.agToken, decimals: 18 } as Token),
        ],
        // liquidity is infinite as to have been able to mint stakeToken, you must have deposited agToken
        liquidityUSD: 1e12,
      },
    ];
  }

  // This is optional function in case if your implementation has acquired any resources
  // you need to release for graceful shutdown. For example, it may be any interval timer
  releaseResources(): AsyncOrSync<void> {}

  _knownAddress(
    srcToken: Token,
    destToken: Token,
  ): { known: boolean; agToken: string | null; stakeToken: string | null } {
    const srcTokenAddress = srcToken.address.toLowerCase();
    const destTokenAddress = destToken.address.toLowerCase();
    if (
      (srcTokenAddress === this.config.agToken &&
        destTokenAddress === this.config.stakeToken) ||
      (srcTokenAddress === this.config.stakeToken &&
        destTokenAddress === this.config.agToken)
    ) {
      return {
        known: true,
        agToken: this.config.agToken,
        stakeToken: this.config.stakeToken,
      };
    }
    return { known: false, agToken: null, stakeToken: null };
  }
}

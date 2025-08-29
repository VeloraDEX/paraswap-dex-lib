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
  NumberAsString,
  DexExchangeParam,
} from '../../types';
import {
  SwapSide,
  Network,
  UNLIMITED_USD_LIQUIDITY,
  NO_USD_LIQUIDITY,
} from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getDexKeysWithNetwork } from '../../utils';
import { IDex, Context } from '../idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import {
  ERC4626Data,
  ERC4626Functions,
  ERC4626Params,
  ERC4626PoolState,
} from './types';
import { SimpleExchange } from '../simple-exchange';
import { ERC4626Config } from './config';
import { BI_POWS } from '../../bigint-constants';
import { ERC4626EventPool } from './erc-4626-pool';
import { Interface } from '@ethersproject/abi';
import ERC4626_ABI from '../../abi/ERC4626.json';
import { DEPOSIT_TOPIC, TRANSFER_TOPIC, WITHDRAW_TOPIC } from './constants';
import { extractReturnAmountPosition } from '../../executor/utils';

export class ERC4626
  extends SimpleExchange
  implements IDex<ERC4626Data, ERC4626Params>
{
  readonly hasConstantPriceLargeAmounts = true;
  readonly isFeeOnTransferSupported = false;
  readonly needWrapNative: boolean = true;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(ERC4626Config);

  public readonly eventPool: ERC4626EventPool;
  logger: Logger;

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
    readonly vault: string = ERC4626Config[dexKey][network].vault,
    readonly asset: string = ERC4626Config[dexKey][network].asset,
    readonly cooldownEnabled: boolean = ERC4626Config[dexKey][network]
      .cooldownEnabled || false,
    readonly erc4626Interface: Interface = new Interface(ERC4626_ABI),
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey);
    this.eventPool = new ERC4626EventPool(
      this.dexKey,
      this.network,
      `${this.vault}_${this.asset}`,
      dexHelper,
      this.vault,
      this.asset,
      this.erc4626Interface,
      this.logger,
      DEPOSIT_TOPIC,
      WITHDRAW_TOPIC,
      TRANSFER_TOPIC,
      cooldownEnabled,
    );
  }

  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return null;
  }

  isAppropriatePair(srcToken: Token, destToken: Token): boolean {
    return (
      (this.isAsset(srcToken.address) && this.isVault(destToken.address)) ||
      (this.isVault(srcToken.address) && this.isAsset(destToken.address))
    );
  }

  async initializePricing(blockNumber: number) {
    await this.eventPool.initialize(blockNumber);
  }

  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    const _srcToken = this.dexHelper.config.wrapETH(srcToken);
    const _destToken = this.dexHelper.config.wrapETH(destToken);

    return this.isAppropriatePair(_srcToken, _destToken)
      ? [`${this.dexKey}_${this.vault}`]
      : [];
  }

  isAsset(tokenAddress: Address) {
    return this.asset.toLowerCase() === tokenAddress.toLowerCase();
  }

  isVault(tokenAddress: Address) {
    return this.vault.toLowerCase() === tokenAddress.toLowerCase();
  }

  isWrap(srcToken: Token, destToken: Token, side: SwapSide) {
    if (side === SwapSide.SELL) {
      return this.isAsset(srcToken.address) && this.isVault(destToken.address);
    }
    return this.isVault(srcToken.address) && this.isAsset(destToken.address);
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
  ): Promise<null | ExchangePrices<ERC4626Data>> {
    const _srcToken = this.dexHelper.config.wrapETH(srcToken);
    const _destToken = this.dexHelper.config.wrapETH(destToken);

    if (!this.isAppropriatePair(_srcToken, _destToken)) return null;
    const state = await this.eventPool.getOrGenerateState(blockNumber);
    if (!state) return null;

    const isSrcAsset = this.isAsset(_srcToken.address);

    const isWrap = this.isWrap(_srcToken, _destToken, side);

    let calcFunction: Function;

    if (side === SwapSide.SELL) {
      if (isSrcAsset) {
        calcFunction = this.previewDeposit.bind(this);
      } else {
        if (!this.eventPool.withdrawRedeemAllowed(state)) {
          return null;
        }
        calcFunction = this.previewRedeem.bind(this);
      }
    } else {
      if (isSrcAsset) {
        calcFunction = this.previewMint.bind(this);
      } else {
        if (!this.eventPool.withdrawRedeemAllowed(state)) {
          return null;
        }
        calcFunction = this.previewWithdraw.bind(this);
      }
    }
    return [
      {
        unit: BI_POWS[18],
        prices: amounts.map(amount => calcFunction(amount, state)),
        gasCost: isWrap ? 60000 : 70000,
        data: {
          exchange: `${this.vault}`,
          state: {
            totalShares: state.totalShares.toString(),
            totalAssets: state.totalAssets.toString(),
          },
        },
        poolAddresses: [this.vault],
        exchange: this.dexKey,
      },
    ];
  }

  // Returns estimated gas cost of calldata for this DEX in multiSwap
  getCalldataGasCost(poolPrices: PoolPrices<ERC4626Data>): number | number[] {
    // TODO: update if there is any payload in getAdapterParam
    return CALLDATA_GAS_COST.DEX_NO_PAYLOAD;
  }

  async updatePoolState() {
    const state = this.eventPool.getStaleState();
    // generate state only once
    if (!state) {
      const blockNumber = await this.dexHelper.provider.getBlockNumber();
      const newState = await this.eventPool.getOrGenerateState(blockNumber);
      this.eventPool.setState(newState, blockNumber);
    }
  }

  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    if (!this.isAsset(tokenAddress) && !this.isVault(tokenAddress)) return [];

    // cooldownDuration is not tracked in the event pool, so get initial state
    const state = this.eventPool.getStaleState();

    const vaultToAsset = this.isVault(tokenAddress);
    const vaultToAssetAllowed =
      state === null ? true : this.eventPool.withdrawRedeemAllowed(state);

    let liquidityUSD = UNLIMITED_USD_LIQUIDITY;
    let connectorLiquidityUSD = UNLIMITED_USD_LIQUIDITY;

    if (!vaultToAssetAllowed) {
      if (vaultToAsset) {
        liquidityUSD = NO_USD_LIQUIDITY;
      } else {
        connectorLiquidityUSD = NO_USD_LIQUIDITY;
      }
    }

    return [
      {
        exchange: this.dexKey,
        address: this.vault,
        connectorTokens: [
          {
            decimals: 18,
            address: vaultToAsset ? this.asset : this.vault,
            liquidityUSD: connectorLiquidityUSD,
          },
        ],
        liquidityUSD,
      },
    ];
  }

  async getSimpleParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: ERC4626Data,
    side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    const isSell = side === SwapSide.SELL;
    const { exchange } = data;

    let swapData: string;
    if (this.isAsset(srcToken)) {
      swapData = this.erc4626Interface.encodeFunctionData(
        isSell ? ERC4626Functions.deposit : ERC4626Functions.mint,
        [isSell ? srcAmount : destAmount, this.augustusAddress],
      );
    } else {
      swapData = this.erc4626Interface.encodeFunctionData(
        isSell ? ERC4626Functions.redeem : ERC4626Functions.withdraw,
        [
          isSell ? srcAmount : destAmount,
          this.augustusAddress,
          this.augustusAddress,
        ],
      );
    }

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
      isSell && this.isAsset(destToken),
    );
  }

  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: ERC4626Data,
    side: SwapSide,
    _: Context,
    executorAddress: Address,
  ): DexExchangeParam {
    const isSell = side === SwapSide.SELL;
    const { exchange } = data;

    let swapData: string;
    if (this.isAsset(srcToken)) {
      swapData = this.erc4626Interface.encodeFunctionData(
        isSell ? ERC4626Functions.deposit : ERC4626Functions.mint,
        [isSell ? srcAmount : destAmount, recipient],
      );
    } else {
      swapData = this.erc4626Interface.encodeFunctionData(
        isSell ? ERC4626Functions.redeem : ERC4626Functions.withdraw,
        [isSell ? srcAmount : destAmount, recipient, executorAddress],
      );
    }

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: true,
      exchangeData: swapData,
      targetExchange: exchange,
      returnAmountPos: isSell
        ? extractReturnAmountPosition(
            this.erc4626Interface,
            this.isAsset(srcToken)
              ? ERC4626Functions.deposit
              : ERC4626Functions.redeem,
          )
        : undefined,
      skipApproval: this.isAsset(destToken),
    };
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
    data: ERC4626Data,
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
        toStaked: this.isAsset(srcToken),
      },
    );

    return {
      targetExchange: exchange,
      payload,
      networkFee: '0',
    };
  }

  previewRedeem(shares: bigint, state: ERC4626PoolState) {
    return (shares * state.totalAssets) / state.totalShares;
  }

  previewMint(shares: bigint, state: ERC4626PoolState) {
    return (shares * state.totalAssets) / state.totalShares;
  }

  previewWithdraw(assets: bigint, state: ERC4626PoolState) {
    return (assets * state.totalShares) / state.totalAssets;
  }

  previewDeposit(assets: bigint, state: ERC4626PoolState) {
    return (assets * state.totalShares) / state.totalAssets;
  }
}

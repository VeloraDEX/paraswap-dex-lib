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
import { SwapSide, Network, UNLIMITED_USD_LIQUIDITY } from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getDexKeysWithNetwork } from '../../utils';
import { IDex, Context } from '../idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { YoData } from './types';
import { YoConfig } from './config';
import { YoEventPool } from './yo-pool';
import { ERC4626 } from '../erc4626/erc4626';
import { Interface } from '@ethersproject/abi';
import ERC4626_ABI from '../../abi/ERC4626.json';
import { extractReturnAmountPosition } from '../../executor/utils';
import { BI_POWS } from '../../bigint-constants';

export enum ERC4626Functions {
  deposit = 'deposit',
  redeem = 'redeem',
  withdraw = 'withdraw',
  mint = 'mint',
}

export class Yo extends ERC4626 implements IDex<YoData> {
  readonly needWrapNative = true;
  readonly isFeeOnTransferSupported = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(YoConfig);

  logger: Logger;
  public readonly eventPool: YoEventPool;

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
    readonly vault: string = YoConfig[dexKey][network].vault,
    readonly asset: string = YoConfig[dexKey][network].asset,
    readonly decimals: number = YoConfig[dexKey][network].decimals,
    readonly erc4626Interface: Interface = new Interface(ERC4626_ABI),
  ) {
    super(network, dexKey, dexHelper, vault, asset, false, erc4626Interface);
    this.logger = dexHelper.getLogger(dexKey);
    this.eventPool = new YoEventPool(
      dexKey,
      network,
      dexHelper,
      this.logger,
      vault,
      asset,
    );
  }

  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
  ): Promise<null | ExchangePrices<YoData>> {
    const _srcToken = this.dexHelper.config.wrapETH(srcToken);
    const _destToken = this.dexHelper.config.wrapETH(destToken);

    if (!this.isAppropriatePair(_srcToken, _destToken)) {
      return null;
    }
    const state = await this.eventPool.getOrGenerateState(blockNumber);
    if (!state) {
      return null;
    }

    const isSrcAsset = this.isAsset(_srcToken.address);

    let calcFunction: Function;
    if (side === SwapSide.SELL) {
      if (isSrcAsset) {
        calcFunction = this.previewDeposit.bind(this);
      } else {
        calcFunction = this.previewRedeem.bind(this);
      }
    } else {
      if (isSrcAsset) {
        calcFunction = this.previewMint.bind(this);
      } else {
        calcFunction = this.previewWithdraw.bind(this);
      }
    }

    return [
      {
        unit: BI_POWS[this.decimals],
        prices: amounts.map(amount => calcFunction(amount, state)),
        gasCost: 100_000,
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

  async getSimpleParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: YoData,
    side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    const isSell = side === SwapSide.SELL;
    const { exchange } = data;

    let swapData: string;
    if (this.isAsset(srcToken)) {
      if (isSell) {
        // SELL: User specifies assets, we call deposit(assets)
        swapData = this.erc4626Interface.encodeFunctionData(
          ERC4626Functions.deposit,
          [srcAmount, this.augustusAddress],
        );
      } else {
        // BUY: User wants shares, we need to calculate required assets
        const state = await this.eventPool.getOrGenerateState(
          await this.dexHelper.provider.getBlockNumber(),
        );
        const requiredAssets = this.previewMint(BigInt(destAmount), state);
        swapData = this.erc4626Interface.encodeFunctionData(
          ERC4626Functions.deposit,
          [requiredAssets.toString(), this.augustusAddress],
        );
      }
    } else {
      if (isSell) {
        // SELL: User specifies shares, we call redeem(shares)
        swapData = this.erc4626Interface.encodeFunctionData(
          ERC4626Functions.redeem,
          [srcAmount, this.augustusAddress, this.augustusAddress],
        );
      } else {
        // BUY: User wants assets, we need to calculate required shares
        const state = await this.eventPool.getOrGenerateState(
          await this.dexHelper.provider.getBlockNumber(),
        );
        const requiredShares = this.previewWithdraw(BigInt(destAmount), state);
        swapData = this.erc4626Interface.encodeFunctionData(
          ERC4626Functions.redeem,
          [
            requiredShares.toString(),
            this.augustusAddress,
            this.augustusAddress,
          ],
        );
      }
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

  async getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: YoData,
    side: SwapSide,
    _: Context,
    executorAddress: Address,
  ): Promise<DexExchangeParam> {
    const isSell = side === SwapSide.SELL;
    const { exchange } = data;

    let swapData: string;
    if (this.isAsset(srcToken)) {
      if (isSell) {
        // SELL: User specifies assets, we call deposit(assets)
        swapData = this.erc4626Interface.encodeFunctionData(
          ERC4626Functions.deposit,
          [srcAmount, recipient],
        );
      } else {
        // BUY: User wants shares, we need to calculate required assets
        const state = await this.eventPool.getOrGenerateState(
          await this.dexHelper.provider.getBlockNumber(),
        );
        const requiredAssets = this.previewMint(BigInt(destAmount), state);
        swapData = this.erc4626Interface.encodeFunctionData(
          ERC4626Functions.deposit,
          [requiredAssets.toString(), recipient],
        );
      }
    } else {
      if (isSell) {
        // SELL: User specifies shares, we call redeem(shares)
        swapData = this.erc4626Interface.encodeFunctionData(
          ERC4626Functions.redeem,
          [srcAmount, recipient, executorAddress],
        );
      } else {
        // BUY: User wants assets, we need to calculate required shares
        const state = await this.eventPool.getOrGenerateState(
          await this.dexHelper.provider.getBlockNumber(),
        );
        const requiredShares = this.previewWithdraw(BigInt(destAmount), state);
        swapData = this.erc4626Interface.encodeFunctionData(
          ERC4626Functions.redeem,
          [requiredShares.toString(), recipient, executorAddress],
        );
      }
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

  // Override getAdapterParam to use YoData
  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: YoData,
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

  // Override getCalldataGasCost
  getCalldataGasCost(_poolPrices: PoolPrices<YoData>): number | number[] {
    return CALLDATA_GAS_COST.DEX_NO_PAYLOAD;
  }

  // Override updatePoolState
  async updatePoolState(): Promise<void> {
    await super.updatePoolState();
  }

  async getTopPoolsForToken(
    tokenAddress: Address,
    _limit: number,
  ): Promise<PoolLiquidity[]> {
    if (!this.isAsset(tokenAddress) && !this.isVault(tokenAddress)) {
      return [];
    }

    const vaultToAsset = this.isVault(tokenAddress);

    return [
      {
        exchange: this.dexKey,
        address: this.vault,
        connectorTokens: [
          {
            decimals: this.decimals,
            address: vaultToAsset ? this.asset : this.vault,
            liquidityUSD: UNLIMITED_USD_LIQUIDITY,
          },
        ],
        liquidityUSD: UNLIMITED_USD_LIQUIDITY,
      },
    ];
  }
}

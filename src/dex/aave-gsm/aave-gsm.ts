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
import { SwapSide, Network } from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getDexKeysWithNetwork } from '../../utils';
import { IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { AaveGsmData, DexParams, PoolState } from './types';
import { SimpleExchange } from '../simple-exchange';
import { AaveGsmConfig } from './config';

import GSM_ABI from '../../abi/aave-gsm/Aave_GSM.json';
import { Interface } from '@ethersproject/abi';
import { formatUnits, parseUnits } from 'ethers/lib/utils';
import { AaveGsmEventPool } from './aave-gsm-pool';
import { MMath } from '../maverick-v1/maverick-math/maverick-basic-math';
import {
  RETURN_AMOUNT_POS_0,
  RETURN_AMOUNT_POS_32,
} from '../../executor/constants';

export class AaveGsm extends SimpleExchange implements IDex<AaveGsmData> {
  static readonly gsmInterface = new Interface(GSM_ABI);
  protected eventPools: Record<string, AaveGsmEventPool>;

  protected config: DexParams;

  readonly hasConstantPriceLargeAmounts = false;
  readonly needWrapNative = false;

  readonly isFeeOnTransferSupported = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(AaveGsmConfig);

  logger: Logger;

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
  ) {
    super(dexHelper, dexKey);
    const config = AaveGsmConfig[dexKey][network];
    this.config = {
      POOL: config.POOL.toLowerCase(),
      GSM_USDT: config.GSM_USDT.toLowerCase(),
      GSM_USDC: config.GSM_USDC.toLowerCase(),
      waEthUSDT: config.waEthUSDT.toLowerCase(),
      waEthUSDC: config.waEthUSDC.toLowerCase(),
      GHO: config.GHO.toLowerCase(),
    };

    this.logger = dexHelper.getLogger(dexKey);

    this.eventPools = {
      [this.config.GSM_USDT]: new AaveGsmEventPool(
        this.config.GSM_USDT,
        this.config.waEthUSDT,
        this.config.POOL,
        this.dexKey,
        this.network,
        this.dexHelper,
        this.logger,
      ),
      [this.config.GSM_USDC]: new AaveGsmEventPool(
        this.config.GSM_USDC,
        this.config.waEthUSDC,
        this.config.POOL,
        this.dexKey,
        this.network,
        this.dexHelper,
        this.logger,
      ),
    };
  }

  async initializePoolPricing(pool: AaveGsmEventPool, blockNumber: number) {
    const state = await pool.generateState(blockNumber);

    pool.initialize(blockNumber, {
      state,
    });
  }

  async initializePricing(blockNumber: number) {
    await this.initializePoolPricing(
      this.eventPools[this.config.GSM_USDT],
      blockNumber,
    );
    await this.initializePoolPricing(
      this.eventPools[this.config.GSM_USDC],
      blockNumber,
    );
  }

  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return null;
  }

  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    const srcTokenAddress = srcToken.address.toLowerCase();
    const destTokenAddress = destToken.address.toLowerCase();

    if (
      (srcTokenAddress === this.config.GHO &&
        destTokenAddress === this.config.waEthUSDT) ||
      (srcTokenAddress === this.config.waEthUSDT &&
        destTokenAddress === this.config.GHO)
    ) {
      return [`${this.dexKey}_${this.config.GSM_USDT}`];
    } else if (
      (srcTokenAddress === this.config.GHO &&
        destTokenAddress === this.config.waEthUSDC) ||
      (srcTokenAddress === this.config.waEthUSDC &&
        destTokenAddress === this.config.GHO)
    ) {
      return [`${this.dexKey}_${this.config.GSM_USDC}`];
    } else {
      return [];
    }
  }

  async getPoolState(gsm: string, blockNumber?: number): Promise<PoolState> {
    if (!blockNumber) {
      return this.eventPools[gsm].getStaleState()!;
    }
    const eventState = this.eventPools[gsm].getState(blockNumber);
    if (eventState) return eventState;
    const onChainState = await this.eventPools[gsm].generateState(blockNumber);
    this.eventPools[gsm].setState(onChainState, blockNumber);
    return onChainState;
  }

  canBuyAsset(assetAmount: bigint, state: PoolState) {
    return assetAmount > 0n && state.underlyingLiquidity >= assetAmount;
  }

  canSellAsset(assetAmount: bigint, state: PoolState) {
    return (
      assetAmount > 0n &&
      state.underlyingLiquidity + assetAmount <= state.exposureCap
    );
  }

  getGhoAmountForBuyAsset(assetAmount: bigint, state: PoolState) {
    if (!this.canBuyAsset(assetAmount, state)) {
      return 0n;
    }

    let grossAmount = MMath.mulDiv(
      assetAmount,
      state.rate,
      1_000_000_000_000_000_000_000_000_000n,
      true,
    );
    grossAmount *= 1_000_000_000_000n; // 18 - 6 = 12 (decimals)
    const fee = MMath.mulDiv(grossAmount, state.buyFee, 10_000n, true);

    const result = grossAmount + fee;

    return result;
  }

  getAssetAmountForBuyAsset(ghoAmount: bigint, state: PoolState) {
    const grossAmount = MMath.mulDiv(
      ghoAmount,
      10_000n,
      10_000n + state.buyFee,
      false,
    );

    const vaultAssets = MMath.mulDiv(
      grossAmount,
      1n,
      1_000_000_000_000n, // 18 - 6 = 12 (decimals)
      false,
    );

    const result = MMath.mulDiv(
      vaultAssets,
      1_000_000_000_000_000_000_000_000_000n,
      state.rate,
      false,
    );

    if (this.canBuyAsset(result, state)) {
      return result;
    }
    return 0n;
  }

  getGhoAmountForSellAsset(assetAmount: bigint, state: PoolState) {
    if (!this.canSellAsset(assetAmount, state)) {
      return 0n;
    }

    let grossAmount = MMath.mulDiv(
      assetAmount,
      state.rate,
      1_000_000_000_000_000_000_000_000_000n,
      false,
    );

    grossAmount *= 1_000_000_000_000n; // 18 - 6 = 12 (decimals)
    const fee = MMath.mulDiv(grossAmount, state.sellFee, 10_000n, false);

    return grossAmount - fee;
  }

  getAssetAmountForSellAsset(ghoAmount: bigint, state: PoolState) {
    const grossAmount = MMath.mulDiv(
      ghoAmount,
      10_000n,
      10_000n - state.sellFee,
      true,
    );

    const vaultAssets = MMath.mulDiv(
      grossAmount,
      1n,
      1_000_000_000_000n, // 18 - 6 = 12 (decimals)
      false,
    );

    const result = MMath.mulDiv(
      vaultAssets,
      1_000_000_000_000_000_000_000_000_000n,
      state.rate,
      true,
    );

    if (this.canSellAsset(result, state)) {
      return result;
    }
    return 0n;
  }

  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<AaveGsmData>> {
    const srcTokenAddress = srcToken.address.toLowerCase();
    const destTokenAddress = destToken.address.toLowerCase();

    if (
      !(
        (srcTokenAddress === this.config.GHO &&
          (destTokenAddress === this.config.waEthUSDC ||
            destTokenAddress === this.config.waEthUSDT)) ||
        (destTokenAddress === this.config.GHO &&
          (srcTokenAddress === this.config.waEthUSDC ||
            srcTokenAddress === this.config.waEthUSDT))
      )
    ) {
      return null;
    }

    let endpoint: Function;
    let target: string;
    let gas: number;

    if (
      srcTokenAddress === this.config.waEthUSDT ||
      destTokenAddress === this.config.waEthUSDT
    ) {
      target = this.config.GSM_USDT;
    } else {
      target = this.config.GSM_USDC;
    }

    if (srcTokenAddress === this.config.GHO && side === SwapSide.BUY) {
      // amount = destAmount = assetAmount
      endpoint = this.getGhoAmountForBuyAsset.bind(this);
      gas = 300_000;
    } else if (srcTokenAddress === this.config.GHO && side === SwapSide.SELL) {
      // amount = srcAmount = ghoAmount
      endpoint = this.getAssetAmountForBuyAsset.bind(this);
      gas = 300_000;
    } else if (destTokenAddress === this.config.GHO && side === SwapSide.SELL) {
      // amount = srcAmount = assetAmount
      endpoint = this.getGhoAmountForSellAsset.bind(this);
      gas = 200_000;
    } else {
      // amount = destAmount = ghoAmount
      endpoint = this.getAssetAmountForSellAsset.bind(this);
      gas = 200_000;
    }

    const unit = parseUnits(
      '1',
      side === SwapSide.SELL ? srcToken.decimals : destToken.decimals,
    ).toBigInt();

    const poolState = await this.getPoolState(target, blockNumber);

    if (poolState.isFrozen || poolState.isSeized) {
      return null;
    }

    return [
      {
        unit: endpoint(unit, poolState),
        prices: amounts.map(amount => endpoint(amount, poolState)),
        data: {
          exchange: this.dexKey,
        },
        poolAddresses: [target],
        exchange: this.dexKey,
        gasCost: gas,
        poolIdentifier: `${this.dexKey}_${target}`,
      },
    ];
  }

  getCalldataGasCost(poolPrices: PoolPrices<AaveGsmData>): number | number[] {
    return CALLDATA_GAS_COST.DEX_NO_PAYLOAD;
  }

  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: AaveGsmData,
    side: SwapSide,
  ): AdapterExchangeParam {
    const { exchange } = data;

    const payload = '';

    return {
      targetExchange: exchange,
      payload,
      networkFee: '0',
    };
  }

  async getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: AaveGsmData,
    side: SwapSide,
  ): Promise<DexExchangeParam> {
    const isSrcGho = srcToken.toLowerCase() === this.config.GHO;
    const swapFunction = isSrcGho ? 'buyAsset' : 'sellAsset';
    const ghoAmount = isSrcGho ? srcAmount : destAmount;
    let assetAmount = isSrcGho ? destAmount : srcAmount;
    const targetExchange =
      srcToken.toLowerCase() === this.config.waEthUSDT ||
      destToken.toLowerCase() === this.config.waEthUSDT
        ? this.config.GSM_USDT
        : this.config.GSM_USDC;

    if (BigInt(assetAmount) === 1n) {
      const poolState = await this.getPoolState(targetExchange);
      assetAmount = isSrcGho
        ? this.getAssetAmountForBuyAsset(
            BigInt(ghoAmount),
            poolState,
          ).toString()
        : this.getAssetAmountForSellAsset(
            BigInt(ghoAmount),
            poolState,
          ).toString();
    }

    const exchangeData = AaveGsm.gsmInterface.encodeFunctionData(swapFunction, [
      assetAmount,
      recipient,
    ]);

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: true,
      exchangeData,
      targetExchange,
      returnAmountPos:
        side === SwapSide.SELL
          ? isSrcGho
            ? RETURN_AMOUNT_POS_0
            : RETURN_AMOUNT_POS_32
          : undefined,
    };
  }

  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    tokenAddress = tokenAddress.toLowerCase();

    if (tokenAddress === this.config.GHO) {
      const usdtState = this.eventPools[this.config.GSM_USDT].getStaleState();
      const usdcState = this.eventPools[this.config.GSM_USDC].getStaleState();

      return [
        {
          exchange: this.dexKey,
          address: this.config.GSM_USDT,
          connectorTokens: [
            {
              decimals: 6,
              address: this.config.waEthUSDT,
            },
          ],
          liquidityUSD: usdtState
            ? +formatUnits(usdtState.underlyingLiquidity, 6)
            : 1000000000,
        },
        {
          exchange: this.dexKey,
          address: this.config.GSM_USDC,
          connectorTokens: [
            {
              decimals: 6,
              address: this.config.waEthUSDC,
            },
          ],
          liquidityUSD: usdcState
            ? +formatUnits(usdcState.underlyingLiquidity, 6)
            : 1000000000,
        },
      ];
    } else if (tokenAddress === this.config.waEthUSDC) {
      return [
        {
          exchange: this.dexKey,
          address: this.config.GSM_USDC,
          connectorTokens: [
            {
              decimals: 18,
              address: this.config.GHO,
            },
          ],
          liquidityUSD: 1000000000, // Just returning a big number so this DEX will be preferred
        },
      ];
    } else if (tokenAddress === this.config.waEthUSDT) {
      return [
        {
          exchange: this.dexKey,
          address: this.config.GSM_USDT,
          connectorTokens: [
            {
              decimals: 18,
              address: this.config.GHO,
            },
          ],
          liquidityUSD: 1000000000, // Just returning a big number so this DEX will be preferred
        },
      ];
    } else {
      return [];
    }
  }
}

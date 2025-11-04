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
import { IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import {
  AllVaultConfigs,
  VaultConfig,
  VaultsStates,
  VaultState,
  TradeType,
  CapData,
} from './types';
import {
  getLocalDeadlineAsFriendlyPlaceholder,
  SimpleExchange,
} from '../simple-exchange';
import { CapConfig } from './config';
import { CapPools } from './cap-pools';
import { BI_POWS } from '../../bigint-constants';
import { Interface } from '@ethersproject/abi';
import CapTokenAbi from '../../abi/cap/CapToken.json';
import { extractReturnAmountPosition } from '../../executor/utils';

const RAY_PRECISION = 10n ** 27n;

export class Cap extends SimpleExchange implements IDex<CapData> {
  public eventPools: CapPools;
  readonly hasConstantPriceLargeAmounts = false;
  readonly needWrapNative = true;
  readonly isFeeOnTransferSupported = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(CapConfig);

  logger: Logger;
  configs: AllVaultConfigs;

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
    public capIface = new Interface(CapTokenAbi),
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey);
    this.configs = CapConfig[dexKey][network];
    this.eventPools = new CapPools(
      dexKey,
      network,
      dexHelper,
      this.logger,
      this.configs,
    );
  }

  // Initialize pricing is called once in the start of
  // pricing service. It is intended to setup the integration
  // for pricing requests. It is optional for a DEX to
  // implement this function
  async initializePricing(blockNumber: number) {
    await this.eventPools.initialize(blockNumber);
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
    _side: SwapSide,
    _blockNumber: number,
  ): Promise<string[]> {
    // no methods that support exact output amount out
    if (_side === SwapSide.BUY) {
      return [];
    }

    const detect = this._detectMintBurn(srcToken, destToken, _side);
    if (detect) {
      return [this.getPoolIdentifier(detect.vault.address)];
    }
    return [];
  }

  private getPoolIdentifier(vaultAddress: Address): string {
    return `${this.dexKey}_${vaultAddress}`.toLowerCase();
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
  ): Promise<null | ExchangePrices<CapData>> {
    // no methods that support exact output amount out
    if (side === SwapSide.BUY) {
      return null;
    }

    const detect = this._detectMintBurn(srcToken, destToken, side);
    if (!detect) {
      return null;
    }

    const poolKey = this.getPoolIdentifier(detect.vault.address);
    const excludePoolKey = limitPools && !limitPools.includes(poolKey);

    if (excludePoolKey) {
      return null;
    }

    const { type, vault, asset } = detect;

    const state = await this.eventPools.getOrGenerateState(blockNumber);
    const vaultConfig = this.configs[vault.address.toLowerCase()];

    const isMint = type === TradeType.Mint;
    const isSell = side === SwapSide.SELL; // not used, but might be extended if cap adds exact amount out support

    const prices = amounts.map(amount => {
      if (isSell) {
        return this.getAmountOut(state, vaultConfig, {
          mint: isMint,
          asset: asset.address,
          amount,
        });
      } else {
        return this.getAmountIn(state, vaultConfig, {
          mint: isMint,
          asset: asset.address,
          amount,
        });
      }
    });

    return [
      {
        unit: BI_POWS[18],
        prices,
        gasCost: isMint ? 250_000 : 240_000,
        data: {
          vaultAddress: vault.address,
          assetAddress: asset.address,
          isMint: type === TradeType.Mint,
        },
        poolAddresses: [vault.address.toLowerCase()],
        poolIdentifiers: [poolKey],
        exchange: this.dexKey,
      },
    ];
  }

  // Returns estimated gas cost of calldata for this DEX in multiSwap
  getCalldataGasCost(poolPrices: PoolPrices<CapData>): number | number[] {
    return (
      CALLDATA_GAS_COST.DEX_OVERHEAD +
      CALLDATA_GAS_COST.ADDRESS +
      CALLDATA_GAS_COST.AMOUNT * 2 +
      CALLDATA_GAS_COST.ADDRESS +
      CALLDATA_GAS_COST.TIMESTAMP
    );
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
    data: CapData,
    side: SwapSide,
  ): AdapterExchangeParam {
    return {
      targetExchange: data.vaultAddress,
      payload: '0x',
      networkFee: '0',
    };
  }

  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: CapData,
    side: SwapSide,
  ): DexExchangeParam {
    const functionName = data.isMint ? 'mint' : 'burn';

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: true,
      exchangeData: this.capIface.encodeFunctionData(functionName, [
        data.assetAddress,
        srcAmount,
        '1', // minAmountOut
        recipient,
        getLocalDeadlineAsFriendlyPlaceholder(),
      ]),
      targetExchange: data.vaultAddress,
      returnAmountPos: extractReturnAmountPosition(
        this.capIface,
        functionName,
        'amountOut',
      ),
    };
  }

  // Returns list of top pools based on liquidity. Max
  // limit number pools should be returned.
  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    const _tokenAddress = tokenAddress.toLowerCase();
    const pools: PoolLiquidity[] = [];

    for (const config of Object.values(this.configs)) {
      const vault = config.vault;
      const assets = Object.values(config.assets);

      if (_tokenAddress === vault.address.toLowerCase()) {
        pools.push({
          exchange: this.dexKey,
          address: vault.address,
          connectorTokens: assets.map(asset => ({
            address: asset.address,
            decimals: asset.decimals,
          })),
          liquidityUSD: UNLIMITED_USD_LIQUIDITY,
        });
      }

      const asset = assets.find(
        asset => _tokenAddress === asset.address.toLowerCase(),
      );

      if (asset) {
        pools.push({
          exchange: this.dexKey,
          address: asset.address,
          connectorTokens: [
            {
              address: vault.address,
              decimals: vault.decimals,
            },
          ],
          liquidityUSD: UNLIMITED_USD_LIQUIDITY,
        });
      }
    }

    return pools.slice(0, limit);
  }

  private _detectMintBurn(
    srcToken: Token | string,
    destToken: Token | string,
    side: SwapSide,
  ): null | { type: 'mint' | 'burn'; vault: Token; asset: Token } {
    const _srcAddress = (
      typeof srcToken === 'string' ? srcToken : srcToken.address
    ).toLowerCase();
    const _destAddress = (
      typeof destToken === 'string' ? destToken : destToken.address
    ).toLowerCase();

    for (const config of Object.values(this.configs)) {
      const vault = config.vault;
      const assets = Object.values(config.assets);
      const srcAsset = assets.find(
        a => a.address.toLowerCase() === _srcAddress,
      );
      const destAsset = assets.find(
        a => a.address.toLowerCase() === _destAddress,
      );

      if (_destAddress === vault.address.toLowerCase() && srcAsset) {
        return { type: 'mint', vault, asset: srcAsset };
      }
      if (_srcAddress === vault.address.toLowerCase() && destAsset) {
        return { type: 'burn', vault, asset: destAsset };
      }
    }

    return null;
  }

  public getAmountOut(
    state: VaultsStates,
    config: VaultConfig,
    params: { mint: boolean; asset: Address; amount: bigint },
  ): bigint {
    const vaultState = state[config.vault.address.toLowerCase()];
    if (!vaultState) return params.amount;

    const assetAddr = params.asset.toLowerCase();
    const assetConf = config.assets[assetAddr];
    if (!assetConf) return params.amount;

    const assetPrice = vaultState.assetPrice[assetAddr];
    const capPrice = vaultState.capPrice;
    if (assetPrice === 0n || capPrice === 0n) return 0n;

    const capDecimals = 10n ** BigInt(config.vault.decimals);
    const assetDecimals = 10n ** BigInt(assetConf.decimals);

    const capSupply = vaultState.totalSupply;
    const capValue = (capSupply * capPrice) / capDecimals;
    const allocValue =
      (vaultState.assetSupply[assetAddr] * assetPrice) / assetDecimals;

    const assetValue = params.mint
      ? (params.amount * assetPrice) / assetDecimals
      : (params.amount * capPrice) / capDecimals;

    let newRatio: bigint;
    if (params.mint) {
      if (capSupply === 0n) newRatio = 0n;
      else
        newRatio =
          ((allocValue + assetValue) * RAY_PRECISION) / (capValue + assetValue);
    } else if (capSupply === params.amount) {
      newRatio = RAY_PRECISION;
    } else if (allocValue > assetValue && capValue > assetValue) {
      newRatio =
        ((allocValue - assetValue) * RAY_PRECISION) / (capValue - assetValue);
    } else {
      newRatio = 0n;
    }

    let amount = params.mint
      ? (assetValue * capDecimals) / capPrice
      : (assetValue * assetDecimals) / assetPrice;

    const fees = vaultState.assetFeeConfig[assetAddr];
    if (fees) {
      let feeRate = 0n;

      if (params.mint) {
        feeRate = fees.minMintFee;
        if (newRatio > fees.optimalRatio) {
          if (newRatio > fees.mintKinkRatio) {
            const excess = newRatio - fees.mintKinkRatio;
            feeRate +=
              fees.slope0 +
              (fees.slope1 * excess) / (RAY_PRECISION - fees.mintKinkRatio);
          } else {
            feeRate +=
              (fees.slope0 * (newRatio - fees.optimalRatio)) /
              (fees.mintKinkRatio - fees.optimalRatio);
          }
        }
      } else if (newRatio < fees.optimalRatio) {
        if (newRatio < fees.burnKinkRatio) {
          const excess = fees.burnKinkRatio - newRatio;
          feeRate = fees.slope0 + (fees.slope1 * excess) / fees.burnKinkRatio;
        } else {
          feeRate =
            (fees.slope0 * (fees.optimalRatio - newRatio)) /
            (fees.optimalRatio - fees.burnKinkRatio);
        }
      }

      if (feeRate > 0n) {
        if (feeRate > RAY_PRECISION) feeRate = RAY_PRECISION;
        amount -= (amount * feeRate) / RAY_PRECISION;
      }
    }

    return amount;
  }

  public getAmountIn(
    state: VaultsStates,
    config: VaultConfig,
    params: { mint: boolean; asset: Address; amount: bigint },
  ): bigint {
    return this.getAmountOut(state, config, {
      ...params,
      mint: !params.mint,
    });
  }
}

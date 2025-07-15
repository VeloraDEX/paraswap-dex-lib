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
import { SwapSide, Network } from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getDexKeysWithNetwork, getBigIntPow } from '../../utils';
import { IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { GMXData, DexParams } from './types';
import { GMXEventPool } from './pool';
import { SimpleExchange } from '../simple-exchange';
import { GMXConfig, Adapters } from './config';
import { Vault } from './vault';
import ERC20ABI from '../../abi/erc20.json';
import { extractReturnAmountPosition } from '../../executor/utils';

const GMXGasCost = 300 * 1000;

export class GMX extends SimpleExchange implements IDex<GMXData> {
  protected pool: GMXEventPool | null = null;
  protected supportedTokensMap: { [address: string]: boolean } = {};
  // supportedTokens is only used by the pooltracker
  protected supportedTokens: Token[] = [];

  readonly hasConstantPriceLargeAmounts = false;
  readonly needWrapNative = true;
  readonly isFeeOnTransferSupported = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(GMXConfig);

  public static erc20Interface = new Interface(ERC20ABI);

  vaultUSDBalance: number = 0;

  logger: Logger;

  constructor(
    protected network: Network,
    dexKey: string,
    protected dexHelper: IDexHelper,
    protected adapters = Adapters[network],
    protected params: DexParams = GMXConfig[dexKey][network],
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey);
  }

  // Initialize pricing is called once in the start of
  // pricing service. It is intended to setup the integration
  // for pricing requests.
  async initializePricing(blockNumber: number) {
    const pool = await this.setupPool(blockNumber);
    await pool.initialize(blockNumber);
  }

  async setupPool(blockNumber?: number) {
    const config = await GMXEventPool.getConfig(
      this.params,
      blockNumber ?? 'latest',
      this.dexHelper.multiContract,
    );
    config.tokenAddresses.forEach(
      (token: Address) => (this.supportedTokensMap[token] = true),
    );
    this.pool = new GMXEventPool(
      this.dexKey,
      this.network,
      this.dexHelper,
      this.logger,
      config,
    );

    return this.pool;
  }

  // Returns the list of contract adapters (name and index)
  // for a buy/sell. Return null if there are no adapters.
  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return this.adapters[side];
  }

  // Returns list of pool identifiers that can be used
  // for a given swap. poolIdentifiers must be unique
  // across DEXes.
  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    if (side === SwapSide.BUY || !this.pool) return [];
    const srcAddress = this.dexHelper.config
      .wrapETH(srcToken)
      .address.toLowerCase();
    const destAddress = this.dexHelper.config
      .wrapETH(destToken)
      .address.toLowerCase();
    if (
      srcAddress !== destAddress &&
      this.supportedTokensMap[srcAddress] &&
      this.supportedTokensMap[destAddress]
    ) {
      return [`${this.dexKey}_${srcAddress}`, `${this.dexKey}_${destAddress}`];
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
  ): Promise<null | ExchangePrices<GMXData>> {
    if (side === SwapSide.BUY || !this.pool) return null;
    const srcAddress = this.dexHelper.config
      .wrapETH(srcToken)
      .address.toLowerCase();
    const destAddress = this.dexHelper.config
      .wrapETH(destToken)
      .address.toLowerCase();
    if (
      srcAddress === destAddress ||
      !(
        this.supportedTokensMap[srcAddress] &&
        this.supportedTokensMap[destAddress]
      )
    )
      return null;
    const srcPoolIdentifier = `${this.dexKey}_${srcAddress}`;
    const destPoolIdentifier = `${this.dexKey}_${destAddress}`;
    const pools = [srcPoolIdentifier, destPoolIdentifier];
    if (limitPools && pools.some(p => !limitPools.includes(p))) return null;

    const unitVolume = getBigIntPow(srcToken.decimals);
    const prices = await this.pool.getAmountOut(
      srcAddress,
      destAddress,
      [unitVolume, ...amounts],
      blockNumber,
    );

    if (!prices) return null;

    return [
      {
        prices: prices.slice(1),
        unit: prices[0],
        gasCost: GMXGasCost,
        exchange: this.dexKey,
        data: {},
        poolAddresses: [this.params.vault],
      },
    ];
  }

  // Returns estimated gas cost of calldata for this DEX in multiSwap
  getCalldataGasCost(poolPrices: PoolPrices<GMXData>): number | number[] {
    return CALLDATA_GAS_COST.DEX_NO_PAYLOAD;
  }

  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: GMXData,
    side: SwapSide,
  ): AdapterExchangeParam {
    return {
      targetExchange: this.params.vault,
      payload: '0x',
      networkFee: '0',
    };
  }

  getSimpleParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: GMXData,
    side: SwapSide,
  ): SimpleExchangeParam {
    return {
      callees: [srcToken, this.params.vault],
      calldata: [
        GMX.erc20Interface.encodeFunctionData('transfer', [
          this.params.vault,
          srcAmount,
        ]),
        Vault.interface.encodeFunctionData('swap', [
          srcToken,
          destToken,
          this.augustusAddress,
        ]),
      ],
      values: ['0', '0'],
      networkFee: '0',
    };
  }

  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: GMXData,
    side: SwapSide,
  ): DexExchangeParam {
    const exchangeData = Vault.interface.encodeFunctionData('swap', [
      srcToken,
      destToken,
      recipient,
    ]);

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: true,
      transferSrcTokenBeforeSwap: this.params.vault,
      swappedAmountNotPresentInExchangeData: true,
      exchangeData,
      targetExchange: this.params.vault,
      returnAmountPos:
        side === SwapSide.SELL
          ? extractReturnAmountPosition(Vault.interface, 'swap')
          : undefined,
    };
  }

  async updatePoolState(): Promise<void> {
    if (!this.supportedTokens.length) {
      const tokenAddresses = await GMXEventPool.getWhitelistedTokens(
        this.params.vault,
        'latest',
        this.dexHelper.multiContract,
      );

      const decimalsCallData =
        GMX.erc20Interface.encodeFunctionData('decimals');
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
        parseInt(
          GMX.erc20Interface.decodeFunctionResult('decimals', r)[0].toString(),
        ),
      );

      this.supportedTokens = tokenAddresses.map((t, i) => ({
        address: t,
        decimals: tokenDecimals[i],
      }));
    }

    if (!this.pool) {
      this.pool = await this.setupPool();
    }
  }

  // Returns list of top pools based on liquidity. Max
  // limit number pools should be returned.
  async getTopPoolsForToken(
    _tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    const tokenAddress = _tokenAddress.toLowerCase();
    if (!this.supportedTokens.some(t => t.address === tokenAddress)) return [];

    const tokens = this.supportedTokens.filter(t => t.address !== tokenAddress);
    const maxAmounts: Record<string, bigint> = {};

    await Promise.all(
      tokens.map(async token => {
        const maxAmountIn = await this.pool?.getMaxAmountIn(
          tokenAddress,
          token.address,
        );
        if (maxAmountIn) {
          maxAmounts[token.address] = maxAmountIn;
        }
      }),
    );

    if (!Object.keys(maxAmounts).length) return [];

    const usdMaxAmountIn = await this.dexHelper.getUsdTokenAmounts(
      // maxAmounts are in the asked token, so replace token address
      Object.entries(maxAmounts).map(([_, amount]) => [tokenAddress, amount]),
    );

    return Object.keys(maxAmounts).map((connectorToken, i) => ({
      exchange: this.dexKey,
      address: this.params.vault,
      connectorTokens: [
        this.supportedTokens.find(t => connectorToken === t.address)!,
      ],
      liquidityUSD: usdMaxAmountIn[i],
    }));
  }
}

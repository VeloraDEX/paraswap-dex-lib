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
import { IDex } from '../idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { QuickPerpsData, DexParams } from './types';
import { QuickPerpsEventPool } from './pool';
import { SimpleExchange } from '../simple-exchange';
import { QuickPerpsConfig, Adapters } from './config';
import { Vault } from './vault';
import ERC20ABI from '../../abi/erc20.json';
import { Interface } from 'ethers';
import { extractReturnAmountPosition } from '../../executor/utils';

const QuickPerpsGasCost = 300 * 1000;

export class QuickPerps extends SimpleExchange implements IDex<QuickPerpsData> {
  protected pool: QuickPerpsEventPool | null = null;
  protected supportedTokensMap: { [address: string]: boolean } = {};
  // supportedTokens is only used by the pooltracker
  protected supportedTokens: Token[] = [];

  readonly hasConstantPriceLargeAmounts = false;
  readonly needWrapNative = true;
  readonly isFeeOnTransferSupported = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(QuickPerpsConfig);

  public static erc20Interface = new Interface(ERC20ABI);

  vaultUSDBalance: number = 0;

  logger: Logger;

  constructor(
    protected network: Network,
    dexKey: string,
    protected dexHelper: IDexHelper,
    protected adapters = Adapters[network],
    protected params: DexParams = QuickPerpsConfig[dexKey][network],
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey);
  }

  async initializePricing(blockNumber: number) {
    const config = await QuickPerpsEventPool.getConfig(
      this.params,
      blockNumber,
      this.dexHelper.multiContract,
    );
    config.tokenAddresses.forEach(
      (token: Address) => (this.supportedTokensMap[token] = true),
    );
    this.pool = new QuickPerpsEventPool(
      this.dexKey,
      this.network,
      this.dexHelper,
      config,
    );
    await this.pool.initialize(blockNumber);
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
  ): Promise<null | ExchangePrices<QuickPerpsData>> {
    if (side === SwapSide.BUY || !this.pool) return null;
    try {
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
          gasCost: QuickPerpsGasCost,
          exchange: this.dexKey,
          data: {},
          poolAddresses: [this.params.vault],
        },
      ];
    } catch (e) {
      this.logger.error(
        `Error_getPrices ${srcToken.symbol || srcToken.address}, ${
          destToken.symbol || destToken.address
        }, ${side}: `,
        e,
      );
      return null;
    }
  }

  // Returns estimated gas cost of calldata for this DEX in multiSwap
  getCalldataGasCost(
    poolPrices: PoolPrices<QuickPerpsData>,
  ): number | number[] {
    return CALLDATA_GAS_COST.DEX_NO_PAYLOAD;
  }

  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: QuickPerpsData,
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
    data: QuickPerpsData,
    side: SwapSide,
  ): SimpleExchangeParam {
    return {
      callees: [srcToken, this.params.vault],
      calldata: [
        QuickPerps.erc20Interface.encodeFunctionData('transfer', [
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
    data: QuickPerpsData,
    side: SwapSide,
  ): DexExchangeParam {
    const iface = Vault.interface;
    const functionName = 'swap';
    const swapData = iface.encodeFunctionData(functionName, [
      srcToken,
      destToken,
      recipient,
    ]);

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: true,
      exchangeData: swapData,
      targetExchange: this.params.vault,
      swappedAmountNotPresentInExchangeData: true,
      transferSrcTokenBeforeSwap: this.params.vault,
      returnAmountPos:
        side === SwapSide.SELL
          ? extractReturnAmountPosition(iface, functionName)
          : undefined,
    };
  }

  async updatePoolState(): Promise<void> {
    if (!this.supportedTokens.length) {
      const tokenAddresses = await QuickPerpsEventPool.getWhitelistedTokens(
        this.params.vault,
        'latest',
        this.dexHelper.multiContract,
      );

      const decimalsCallData =
        QuickPerps.erc20Interface.encodeFunctionData('decimals');
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
          QuickPerps.erc20Interface
            .decodeFunctionResult('decimals', r)[0]
            .toString(),
        ),
      );

      this.supportedTokens = tokenAddresses.map((t, i) => ({
        address: t,
        decimals: tokenDecimals[i],
      }));
    }

    const erc20BalanceCalldata = QuickPerps.erc20Interface.encodeFunctionData(
      'balanceOf',
      [this.params.vault],
    );
    const tokenBalanceMultiCall = this.supportedTokens.map(t => ({
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
        QuickPerps.erc20Interface
          .decodeFunctionResult('balanceOf', r)[0]
          .toString(),
      ),
    );
    const tokenBalancesUSD = await Promise.all(
      this.supportedTokens.map((t, i) =>
        this.dexHelper.getTokenUSDPrice(t, tokenBalances[i]),
      ),
    );
    this.vaultUSDBalance = tokenBalancesUSD.reduce(
      (sum: number, curr: number) => sum + curr,
    );
  }

  // Returns list of top pools based on liquidity. Max
  // limit number pools should be returned.
  async getTopPoolsForToken(
    _tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    const tokenAddress = _tokenAddress.toLowerCase();
    if (!this.supportedTokens.some(t => t.address === tokenAddress)) return [];
    return [
      {
        exchange: this.dexKey,
        address: this.params.vault,
        connectorTokens: this.supportedTokens.filter(
          t => t.address !== tokenAddress,
        ),
        liquidityUSD: this.vaultUSDBalance,
      },
    ];
  }
}

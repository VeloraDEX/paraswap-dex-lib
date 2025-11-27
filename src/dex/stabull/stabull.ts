import {
  Token,
  Address,
  ExchangePrices,
  PoolPrices,
  AdapterExchangeParam,
  PoolLiquidity,
  Logger,
  DexExchangeParam,
  ConnectorToken,
} from '../../types';
import { SwapSide, Network } from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getDexKeysWithNetwork } from '../../utils';
import { IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { StabullEventPool } from './stabull-pool';
import { PoolsConfig, StabullData } from './types';
import {
  getLocalDeadlineAsFriendlyPlaceholder,
  SimpleExchange,
} from '../simple-exchange';
import { StabullConfig } from './config';
import curveABI from '../../abi/stabull/stabull-curve.json';
import routerABI from '../../abi/stabull/stabull-router.json';
import { ethers } from 'ethers';
import { uint256ToBigInt } from '../../lib/decoders';
import { BI_POWS } from '../../bigint-constants';

export class Stabull extends SimpleExchange implements IDex<StabullData> {
  private pools: Record<string, StabullEventPool> = {};
  private poolsConfig: PoolsConfig;

  readonly hasConstantPriceLargeAmounts = false;
  readonly needWrapNative = true;

  readonly isFeeOnTransferSupported = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(StabullConfig);

  logger: Logger;

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
    protected poolIface = new ethers.utils.Interface(curveABI),
    protected routerIface = new ethers.utils.Interface(routerABI),
    protected routerAddress = StabullConfig.Stabull[network].router,
    protected quoteCurrency = StabullConfig.Stabull[network].quoteCurrency,
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey);
    this.poolsConfig = StabullConfig.Stabull[network].pools;

    //Iterate over pools and Initialize event pools
    Object.keys(this.poolsConfig).forEach(poolAddress => {
      const pool = this.poolsConfig[poolAddress];
      const tokenAddresses = pool.tokens.map(t => t.address);

      // Initialize event pools
      this.pools[poolAddress] = new StabullEventPool(
        dexKey,
        network,
        dexHelper,
        poolAddress,
        tokenAddresses,
        this.logger,
      );
    });
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
    const pool = Object.entries(this.poolsConfig).find(([, pool]) => {
      const tokenAddresses = pool.tokens.map(t => t.address.toLowerCase());

      return (
        tokenAddresses.includes(srcToken.address.toLowerCase()) &&
        tokenAddresses.includes(destToken.address.toLowerCase())
      );
    })?.[0];

    return pool ? [`${this.dexKey}_${pool}`.toLowerCase()] : [];
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
  ): Promise<null | ExchangePrices<StabullData>> {
    const poolIdentifiers = await this.getPoolIdentifiers(
      srcToken,
      destToken,
      side,
      blockNumber,
    );

    if (poolIdentifiers.length === 0) return null;

    const poolIdentifier = poolIdentifiers[0];
    const poolAddress = poolIdentifier.split('_')[1];

    if (!poolAddress) {
      this.logger.debug(`Invalid pool identifier: ${poolIdentifier}`);
      return null;
    }

    const isSell = side === SwapSide.SELL;
    const methodName = isSell ? 'viewOriginSwap' : 'viewTargetSwap';

    try {
      const unitAmount =
        BI_POWS[isSell ? srcToken.decimals : destToken.decimals];
      const queryAmounts = [unitAmount, ...amounts];

      const callData = queryAmounts.map(amount => ({
        target: poolAddress,
        callData: this.poolIface.encodeFunctionData(methodName, [
          srcToken.address,
          destToken.address,
          amount.toString(),
        ]),
        decodeFunction: uint256ToBigInt,
      }));

      const quotes = await this.dexHelper.multiWrapper.tryAggregate(
        false,
        callData,
        blockNumber,
        this.dexHelper.multiWrapper.defaultBatchSize,
        false,
      );

      const unit = quotes[0].success ? quotes[0].returnData : 0n;
      const prices = quotes.slice(1).map(q => (q.success ? q.returnData : 0n));

      return [
        {
          unit,
          prices,
          data: { poolAddress },
          exchange: this.dexKey,
          gasCost: 150000,
          poolAddresses: [poolAddress],
          poolIdentifiers: [poolIdentifier],
        },
      ];
    } catch (e) {
      this.logger.error('Failed to get prices', e);
      return null;
    }
  }

  // Returns estimated gas cost of calldata for this DEX in multiSwap
  getCalldataGasCost(poolPrices: PoolPrices<StabullData>): number | number[] {
    return (
      CALLDATA_GAS_COST.DEX_OVERHEAD +
      CALLDATA_GAS_COST.FUNCTION_SELECTOR +
      CALLDATA_GAS_COST.ADDRESS * 2 +
      CALLDATA_GAS_COST.AMOUNT * 2 +
      CALLDATA_GAS_COST.TIMESTAMP
    );
  }

  // Encode params required by the exchange adapter
  // V5: Used for multiSwap, buy & megaSwap
  // V6: Not used, can be left blank
  // Hint: abiCoder.encodeParameter() could be useful
  // Update this method to use the correct AbiCoder syntax
  getAdapterParam = (
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: StabullData,
    side: SwapSide,
  ): AdapterExchangeParam => {
    return {
      targetExchange: StabullConfig.Stabull[this.network].router,
      payload: '0x',
      networkFee: '0',
    };
  };

  // This is called once before getTopPoolsForToken is
  // called for multiple tokens. This can be helpful to
  // update common state required for calculating
  // getTopPoolsForToken. It is optional for a DEX
  // to implement this
  async updatePoolState(): Promise<void> {
    const blockNumber = await this.dexHelper.web3Provider.eth.getBlockNumber();

    await Promise.all(
      Object.values(this.pools).map(async poolInstance => {
        const state = await poolInstance.generateState(blockNumber);
        poolInstance.setState(state, blockNumber);
      }),
    );
  }

  // Returns list of top pools based on liquidity. Max
  // limit number pools should be returned.
  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    const lowerToken = tokenAddress.toLowerCase();
    const poolsWithToken = [];

    for (const [poolAddress, pool] of Object.entries(this.pools)) {
      const tokenIndex = pool.addressesSubscribed.findIndex(
        t => t.toLowerCase() === lowerToken,
      );
      if (tokenIndex === -1) continue;

      poolsWithToken.push({
        pool,
        tokenIndex,
        connectorIndex: 1 - tokenIndex,
        poolConfig: this.poolsConfig[poolAddress],
      });
    }

    if (poolsWithToken.length === 0) return [];

    const tokenToAmount = new Map<string, bigint>();

    for (const { pool, tokenIndex, connectorIndex } of poolsWithToken) {
      const state = pool.getStaleState();
      if (!state) continue;

      const token = pool.addressesSubscribed[tokenIndex];
      const connector = pool.addressesSubscribed[connectorIndex];

      tokenToAmount.set(
        token,
        state[tokenIndex === 0 ? 'reserves0' : 'reserves1'] ?? 0n,
      );
      tokenToAmount.set(
        connector,
        state[connectorIndex === 0 ? 'reserves0' : 'reserves1'] ?? 0n,
      );
    }

    const tokenAmountsArray = Array.from(tokenToAmount.entries());
    const usdAmounts = await this.dexHelper.getUsdTokenAmounts(
      tokenAmountsArray,
    );
    const usdMap = new Map(
      tokenAmountsArray.map((t, i) => [t[0], usdAmounts[i]]),
    );

    const relevantPools = poolsWithToken.map(
      ({ pool, tokenIndex, connectorIndex, poolConfig }) => {
        const token = pool.addressesSubscribed[tokenIndex];
        const connector = pool.addressesSubscribed[connectorIndex];

        return {
          exchange: this.dexKey,
          address: pool.poolAddress,
          connectorTokens: [
            {
              address: connector,
              decimals: poolConfig.tokens[connectorIndex]?.decimals ?? 18,
              liquidityUSD: usdMap.get(connector) ?? 0,
            },
          ],
          liquidityUSD: usdMap.get(token) ?? 0,
        };
      },
    );

    relevantPools.sort((a, b) => b.liquidityUSD - a.liquidityUSD);
    return relevantPools.slice(0, limit);
  }

  /**
   * Retrieves the decentralized exchange (DEX) parameters for a swap operation.
   *
   * @param srcToken - The address of the source token.
   * @param destToken - The address of the destination token.
   * @param srcAmount - The amount of the source token to swap.
   * @param destAmount - The desired amount of the destination token.
   * @param recipient - The address of the recipient.
   * @param data - Additional data required for the swap.
   * @param side - The side of the swap (SELL or BUY).
   * @param options - Options for global tokens.
   * @param executorAddress - The address of the executor.
   * @returns A promise that resolves to the DEX exchange parameters.
   */
  async getDexParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    recipient: string,
    data: StabullData,
    side: SwapSide,
    options: {
      isGlobalSrcToken: boolean;
      isGlobalDestToken: boolean;
    },
    executorAddress: string,
  ): Promise<DexExchangeParam> {
    // For SELL operations, always use the router for swaps
    if (side === SwapSide.SELL) {
      const swapData = this.routerIface.encodeFunctionData('originSwap', [
        this.quoteCurrency, // quoteCurrency
        srcToken, // origin
        destToken, // target
        srcAmount, // originAmount
        '1', // minTargetAmount - set to minimum to ensure execution
        getLocalDeadlineAsFriendlyPlaceholder(), // deadline
      ]);

      return {
        needWrapNative: this.needWrapNative,
        dexFuncHasRecipient: false,
        exchangeData: swapData,
        targetExchange: this.routerAddress,
        spender: this.routerAddress,
        returnAmountPos: 0,
      };
    }

    // Direct swap case for BUY operations (one token must be quote currency)
    const swapData = this.poolIface.encodeFunctionData('targetSwap', [
      srcToken, // origin
      destToken, // target
      ethers.constants.MaxUint256.toString(), // maxOriginAmount
      destAmount, // targetAmount
      getLocalDeadlineAsFriendlyPlaceholder(), // deadline
    ]);

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: false,
      exchangeData: swapData,
      targetExchange: data.poolAddress,
      spender: data.poolAddress,
      returnAmountPos: 0,
    };
  }
}

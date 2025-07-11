import { AsyncOrSync, DeepReadonly } from 'ts-essentials';
import {
  Token,
  Address,
  ExchangePrices,
  PoolPrices,
  AdapterExchangeParam,
  PoolLiquidity,
  Logger,
  DexExchangeParam,
} from '../../types';
import {
  SwapSide,
  Network,
  NULL_ADDRESS,
  ETHER_ADDRESS,
} from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getDexKeysWithNetwork, isETHAddress } from '../../utils';
import { IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { BunniV2Data, DexParams, PoolState, PoolStateMap } from './types';
import { SimpleExchange } from '../simple-exchange';
import { BunniV2Config } from './config';
import { BunniV2EventPool } from './bunni-v2-pool';
import V4QuoterABI from '../../abi/bunni-v2/V4Quoter.abi.json';
import { Interface } from '@ethersproject/abi';
import { MultiResult } from '../../lib/multi-wrapper';
import { BytesLike } from 'ethers';
import { generalDecoder } from '../../lib/decoders';
import { BI_POWS } from '../../bigint-constants';
import _ from 'lodash';
import {
  swapExactInputCalldata,
  swapExactInputSingleCalldata,
  swapExactOutputCalldata,
  swapExactOutputSingleCalldata,
} from './encoder';
import { getAvailablePoolsForToken, isWETHAddress } from './utils';

export class BunniV2 extends SimpleExchange implements IDex<BunniV2Data> {
  protected eventPools: BunniV2EventPool;

  readonly hasConstantPriceLargeAmounts = false;
  readonly needWrapNative = false;

  readonly isFeeOnTransferSupported = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(BunniV2Config);

  config: DexParams;
  logger: Logger;
  quoterInterface: Interface;

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
  ) {
    super(dexHelper, dexKey);
    this.config = BunniV2Config.BunniV2[network];
    this.logger = dexHelper.getLogger(dexKey);
    this.quoterInterface = new Interface(V4QuoterABI);

    this.eventPools = new BunniV2EventPool(
      dexKey,
      network,
      dexHelper,
      this.logger,
    );
  }

  async initializePricing(blockNumber: number) {
    await this.eventPools.initialize(blockNumber);
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
    const poolState = this.eventPools.getState(blockNumber);

    if (poolState === null) return [];
    return this.findPoolIdentifiersWithTokens(
      poolState,
      srcTokenAddress,
      destTokenAddress,
    );
  }

  findPoolIdentifiersWithTokens(
    pools: DeepReadonly<PoolStateMap>,
    srcToken: string,
    destToken: string,
  ): string[] {
    return this.getAvailablePoolsForPair(pools, srcToken, destToken).map(
      (poolState: PoolState) => `BunniV2_${poolState.id}`,
    );
  }

  getAvailablePoolsForPair(
    pools: DeepReadonly<PoolStateMap>,
    srcToken: string,
    destToken: string,
  ): PoolState[] {
    const isEthSrc = isETHAddress(srcToken);
    const isEthDest = isETHAddress(destToken);

    const isWethSrc = isWETHAddress(srcToken, this.config);
    const isWethDest = isWETHAddress(destToken, this.config);

    const needCheckWeth = isEthSrc || isEthDest;
    const needCheckETH = isWethSrc || isWethDest;

    const _srcToken = isEthSrc ? NULL_ADDRESS : srcToken.toLowerCase();
    const _destToken = isEthDest ? NULL_ADDRESS : destToken.toLowerCase();

    return Object.values(pools).filter((poolState: PoolState) => {
      const checkToken0Src = poolState.key.currency0 === _srcToken;
      const checkToken1Dest = poolState.key.currency1 === _destToken;
      const checkToken1Src = poolState.key.currency1 === _srcToken;
      const checkToken0Dest = poolState.key.currency0 === _destToken;

      const checkToken0Weth =
        needCheckWeth && isWETHAddress(poolState.key.currency0, this.config); // check token0 to discover WETH pools when ETH is src or dest
      const checkToken0ETH =
        needCheckETH && poolState.key.currency0 === NULL_ADDRESS; // check token0 to discover ETH pools when WETH is src or dest
      const checkToken1Weth =
        needCheckWeth && isWETHAddress(poolState.key.currency1, this.config); // check token1 to discover WETH pools when ETH is src or dest
      const checkToken1ETH =
        needCheckETH && poolState.key.currency1 === NULL_ADDRESS; // check token1 to discover ETH pools when WETH is src or dest

      return (
        ((checkToken0Src ||
          (isEthSrc && checkToken0Weth) ||
          (isWethSrc && checkToken0ETH)) &&
          (checkToken1Dest ||
            (isEthDest && checkToken1Weth) ||
            (isWethDest && checkToken1ETH))) ||
        ((checkToken0Dest ||
          (isEthDest && checkToken0Weth) ||
          (isWethDest && checkToken0ETH)) &&
          (checkToken1Src ||
            (isEthSrc && checkToken1Weth) ||
            (isWethSrc && checkToken1ETH)))
      );
    });
  }

  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<BunniV2Data>> {
    const poolStates = this.eventPools.getState(blockNumber);
    if (poolStates === null) return null;

    const pools = this.getAvailablePoolsForPair(
      poolStates,
      srcToken.address,
      destToken.address,
    );

    const poolIdSet = new Set((limitPools ?? []).map(id => id));
    const availablePools =
      limitPools && limitPools.length
        ? pools.filter(pool => poolIdSet.has(`BunniV2_${pool.id}`))
        : pools;

    const pricesPromises = availablePools.map(async pool => {
      let prices: bigint[] | null;

      const zeroForOne =
        srcToken.address.toLowerCase() === pool.key.currency0.toLowerCase() ||
        (isETHAddress(srcToken.address) &&
          pool.key.currency0 === NULL_ADDRESS) || // ETH is src and native ETH pool
        (isETHAddress(srcToken.address) &&
          pool.key.currency0 === this.config.WETH.toLowerCase()) || // ETH is src and WETH pool
        (srcToken.address.toLowerCase() === this.config.WETH.toLowerCase() &&
          pool.key.currency0 === NULL_ADDRESS); // WETH is src and native ETH pool

      try {
        prices = await this.getOnChainPrices(
          zeroForOne,
          amounts,
          pool,
          side,
          blockNumber,
        );
      } catch (error) {
        this.logger.warn(error);
        prices = null;
      }

      if (prices === null) {
        return null;
      }

      if (side === SwapSide.BUY && prices[prices.length - 1] === 0n) {
        return null;
      }

      if (prices.every(price => price === 0n)) {
        return null;
      }

      return {
        unit: BI_POWS[destToken.decimals],
        prices,
        data: {
          path: [
            {
              pool,
              tokenIn: zeroForOne ? pool.key.currency0 : pool.key.currency1,
              tokenOut: zeroForOne ? pool.key.currency1 : pool.key.currency0,
              zeroForOne,
            },
          ],
        },
        exchange: this.dexKey,
        gasCost: 100_000,
        poolIdentifier: pool.id,
      };
    });

    const prices = await Promise.all(pricesPromises);
    return prices.filter(res => res !== null);
  }

  async getOnChainPrices(
    zeroForOne: boolean,
    amounts: bigint[],
    pool: PoolState,
    side: SwapSide,
    blockNumber: number,
  ): Promise<bigint[]> {
    const funcName =
      side === SwapSide.SELL
        ? 'quoteExactInputSingle'
        : 'quoteExactOutputSingle';

    const callData = amounts.map(amount => {
      return {
        target: BunniV2Config.BunniV2[this.network].quoter,
        callData: this.quoterInterface.encodeFunctionData(funcName, [
          [pool.key, zeroForOne, amount, '0x'],
        ]),
        decodeFunction: (
          result: MultiResult<BytesLike> | BytesLike,
        ): bigint => {
          // amountOut, gasEstimate
          return generalDecoder(result, ['uint256', 'uint256'], 0n, value =>
            BigInt(value[0].toString()),
          );
        },
      };
    });

    const results = await this.dexHelper.multiWrapper.tryAggregate(
      false,
      callData,
      blockNumber,
    );

    return results.map(result => (result.success ? result.returnData : 0n));
  }

  // Returns estimated gas cost of calldata for this DEX in multiSwap
  getCalldataGasCost(poolPrices: PoolPrices<BunniV2Data>): number | number[] {
    return CALLDATA_GAS_COST.DEX_NO_PAYLOAD;
  }

  getDexParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    recipient: Address,
    data: BunniV2Data,
    side: SwapSide,
  ): DexExchangeParam {
    let encodingMethod: (
      srcToken: Address,
      destToken: Address,
      data: BunniV2Data,
      amount1: bigint,
      amount2: bigint,
      recipient: Address,
      dexHelper: IDexHelper,
    ) => string;

    if (data.path.length === 1 && side === SwapSide.SELL) {
      // Single-hop encoding for SELL side
      encodingMethod = swapExactInputSingleCalldata;
    } else if (data.path.length === 1 && side === SwapSide.BUY) {
      // Single-hop encoding for BUY side
      encodingMethod = swapExactOutputSingleCalldata;
    } else if (data.path.length > 1 && side === SwapSide.SELL) {
      // Multi-hop encoding for SELL side
      encodingMethod = swapExactInputCalldata;
    } else if (data.path.length > 1 && side === SwapSide.BUY) {
      // Multi-hop encoding for BUY side
      encodingMethod = swapExactOutputCalldata;
    } else {
      throw new Error(
        `${this.dexKey}-${this.network}: Logic error for side: ${side}, data.path.length: ${data.path.length}`,
      );
    }

    const exchangeData = encodingMethod(
      srcToken,
      destToken,
      data,
      BigInt(srcAmount),
      side === SwapSide.SELL ? 0n : BigInt(destAmount),
      recipient,
      this.dexHelper,
    );

    return {
      needWrapNative: this.needWrapNative,
      sendEthButSupportsInsertFromAmount: true,
      dexFuncHasRecipient: true,
      exchangeData,
      targetExchange: BunniV2Config.BunniV2[this.network].router,
      permit2Approval: true,
      returnAmountPos: undefined,
    };
  }

  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: BunniV2Data,
    side: SwapSide,
  ): AdapterExchangeParam {
    const payload = '';

    return {
      targetExchange: BunniV2Config.BunniV2[this.network].router,
      payload,
      networkFee: '0',
    };
  }

  async updatePoolState(): Promise<void> {}

  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    let _tokenAddress = tokenAddress.toLowerCase();
    if (isETHAddress(_tokenAddress)) _tokenAddress = NULL_ADDRESS;

    const availablePoolsForToken = await getAvailablePoolsForToken(
      this.dexHelper,
      this.logger,
      BunniV2Config.BunniV2[this.network].subgraphURL,
      _tokenAddress,
    );

    // TODO
    // Instead of relying on the vault pricePerVaultShare values
    // from the subgraph, which can be stale, we can query them
    // via RPC to get the most accurate liquidityUSD values.

    if (!availablePoolsForToken) {
      this.logger.error(
        `Error_${this.dexKey}_Subgraph: couldn't fetch the pools from the subgraph`,
      );
      return [];
    }

    const connectors: PoolLiquidity[] = availablePoolsForToken.map(pool => {
      const connectorAddress =
        _tokenAddress.toLowerCase() === pool.currency0.id.toLowerCase()
          ? pool.currency1.id.toLowerCase()
          : pool.currency0.id.toLowerCase();

      const connectorDecimals =
        _tokenAddress.toLowerCase() === pool.currency0.id.toLowerCase()
          ? parseInt(pool.currency1.decimals)
          : parseInt(pool.currency0.decimals);

      const rawBalance0 = parseFloat(pool.bunniToken.rawBalance0);
      const rawBalance1 = parseFloat(pool.bunniToken.rawBalance1);

      const reserveBalance0 = pool.bunniToken.vault0
        ? parseFloat(pool.bunniToken.reserve0) *
          parseFloat(pool.bunniToken.vault0.pricePerVaultShare)
        : 0;
      const reserveBalance1 = pool.bunniToken.vault1
        ? parseFloat(pool.bunniToken.reserve1) *
          parseFloat(pool.bunniToken.vault1.pricePerVaultShare)
        : 0;

      const totalBalance0 = rawBalance0 + reserveBalance0;
      const totalBalance1 = rawBalance1 + reserveBalance1;

      let liquidity0 = 0;
      if (parseFloat(pool.currency0.price) > 0) {
        liquidity0 = totalBalance0 * parseFloat(pool.currency0.price);
      } else if (parseFloat(pool.currency1.price) > 0) {
        liquidity0 =
          totalBalance0 *
          parseFloat(pool.priceCurrency1) *
          parseFloat(pool.currency1.price);
      } else {
        // TODO what do we do here (i.e. neither token has a USD price from the subgraph)?
      }

      let liquidity1 = 0;
      if (parseFloat(pool.currency1.price) > 0) {
        liquidity1 = totalBalance1 * parseFloat(pool.currency1.price);
      } else if (parseFloat(pool.currency0.price) > 0) {
        liquidity1 =
          totalBalance1 *
          parseFloat(pool.priceCurrency0) *
          parseFloat(pool.currency0.price);
      } else {
        // TODO what do we do here (i.e. neither token has a USD price from the subgraph)?
      }

      return {
        exchange: this.dexKey,
        address: BunniV2Config.BunniV2[this.network].poolManager,
        connectorTokens: [
          {
            address:
              connectorAddress.toLowerCase() === NULL_ADDRESS
                ? ETHER_ADDRESS
                : connectorAddress.toLowerCase(),
            decimals: connectorDecimals,
          },
        ],
        liquidityUSD: liquidity0 + liquidity1,
      };
    });

    const pools = _.orderBy(connectors, ['liquidityUSD'], ['desc']).slice(
      0,
      limit,
    );
    return pools;
  }

  releaseResources(): AsyncOrSync<void> {}
}

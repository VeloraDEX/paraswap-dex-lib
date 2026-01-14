import { Interface } from '@ethersproject/abi';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { ETHER_ADDRESS, Network, SwapSide } from '../../constants';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { Context, IDex } from '../idex';
import {
  AdapterExchangeParam,
  Address,
  DexExchangeParam,
  ExchangePrices,
  NumberAsString,
  PoolLiquidity,
  PoolPrices,
  Token,
} from '../../types';
import { getBigIntPow, getDexKeysWithNetwork } from '../../utils';
import { SimpleExchange } from '../simple-exchange';
import { CORE_ADDRESS, EKUBO_V3_CONFIG, ROUTER_ADDRESS } from './config';
import { EkuboData } from './types';
import {
  convertParaSwapToEkubo,
  convertAndSortTokens,
  ekuboContracts,
  convertEkuboToParaSwap,
} from './utils';

import { BigNumber, Contract } from 'ethers';
import { concat, zeroPad } from 'ethers/lib/utils';
import { AsyncOrSync } from 'ts-essentials';
import RouterABI from '../../abi/ekubo-v3/mev-capture-router.json';
import { erc20Iface } from '../../lib/tokens/utils';
import { EkuboV3PoolManager } from './ekubo-v3-pool-manager';
import { uint8ToNumber } from '../../lib/decoders';

// Ekubo Protocol https://ekubo.org/
export class EkuboV3 extends SimpleExchange implements IDex<EkuboData> {
  public static readonly dexKeysWithNetwork: {
    key: string;
    networks: Network[];
  }[] = getDexKeysWithNetwork(EKUBO_V3_CONFIG);

  public readonly hasConstantPriceLargeAmounts = false;
  public readonly needWrapNative = false;
  public readonly isFeeOnTransferSupported = false;

  public readonly routerIface;
  private readonly logger;
  private readonly config;

  private readonly poolManager;
  private readonly contracts;

  private decimals: Record<string, number> = {
    [ETHER_ADDRESS.toLowerCase()]: 18,
  };

  public constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
  ) {
    super(dexHelper, dexKey);

    this.logger = dexHelper.getLogger(dexKey);
    this.config = EKUBO_V3_CONFIG[dexKey][network];

    this.contracts = ekuboContracts(dexHelper.provider);
    this.routerIface = new Interface(RouterABI);
    this.poolManager = new EkuboV3PoolManager(
      this.dexKey,
      this.logger,
      this.dexHelper,
      this.contracts,
      this.config.subgraphId,
    );
  }

  public async initializePricing(blockNumber: number) {
    await this.poolManager.updatePools(blockNumber, true);
  }

  public async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    _side: SwapSide,
    _blockNumber: number,
  ): Promise<string[]> {
    const [token0, token1] = convertAndSortTokens(srcToken, destToken);

    return Array.from(
      this.poolManager.poolsByBI
        .values()
        .filter(
          pool => pool.key.token0 === token0 && pool.key.token1 === token1,
        )
        .map(pool => pool.key.stringId),
    );
  }

  public async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<EkuboData>> {
    const pools = await this.poolManager.getQuotePools(
      srcToken,
      destToken,
      limitPools,
    );

    const isExactOut = side === SwapSide.BUY;

    const amountToken = isExactOut ? destToken : srcToken;
    const amountTokenAddress = convertParaSwapToEkubo(amountToken.address);
    const unitAmount = getBigIntPow(amountToken.decimals);

    const token1 = convertAndSortTokens(srcToken, destToken)[1];

    const exchangePrices = [];

    // eslint-disable-next-line no-restricted-syntax
    poolLoop: for (const pool of pools) {
      const poolId = pool.key.stringId;

      try {
        const quotes = [];
        const skipAheadMap: Record<string, number> = {};

        for (const amount of [unitAmount, ...amounts]) {
          const inputAmount = isExactOut ? -amount : amount;

          const quote = pool.quote(
            inputAmount,
            amountTokenAddress,
            blockNumber,
          );

          if (quote.consumedAmount !== inputAmount) {
            this.logger.debug(
              `Pool ${poolId} doesn't have enough liquidity to support swap of ${amount} ${
                amountToken.symbol ?? amountToken.address
              }`,
            );

            // There doesn't seem to be a way to skip just this one price.
            // Anyway, this pool is probably not the right one if it has such thin liquidity.
            continue poolLoop;
          }

          quotes.push(quote);
          skipAheadMap[amount.toString()] = quote.skipAhead;
        }

        const [unitQuote, ...otherQuotes] = quotes;

        exchangePrices.push({
          prices: otherQuotes.map(quote => quote.calculatedAmount),
          unit: unitQuote.calculatedAmount,
          data: {
            poolKeyAbi: pool.key.toAbi(),
            isToken1: amountTokenAddress === token1,
            skipAhead: skipAheadMap,
          },
          poolIdentifiers: [poolId],
          exchange: this.dexKey,
          gasCost: otherQuotes.map(quote => quote.gasConsumed),
        });
      } catch (err) {
        this.logger.error('Quote error:', err);
        continue;
      }
    }

    return exchangePrices;
  }

  public getDexParam(
    _srcToken: Address,
    _destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: EkuboData,
    side: SwapSide,
    _context: Context,
    _executorAddress: Address,
  ): DexExchangeParam {
    const amount = BigInt(side === SwapSide.BUY ? `-${destAmount}` : srcAmount);
    const amountStr = (
      side === SwapSide.SELL ? srcAmount : destAmount
    ).toString();

    const isToken1AndSkipAhead = zeroPad(
      BigNumber.from(data.skipAhead[amountStr] ?? 0).toHexString(),
      4,
    );
    if (data.isToken1) {
      isToken1AndSkipAhead[0] |= 0x80;
    }

    const params = concat([
      '0x000000000000000000000000', // No sqrt ratio limit
      zeroPad(BigNumber.from(amount).toTwos(128).toHexString(), 16),
      isToken1AndSkipAhead,
    ]);

    return {
      needWrapNative: this.needWrapNative,
      exchangeData: this.routerIface.encodeFunctionData(
        'swapAllowPartialFill((address,address,bytes32),bytes32,address)',
        [data.poolKeyAbi, params, recipient],
      ),
      sendEthButSupportsInsertFromAmount: true,
      targetExchange: ROUTER_ADDRESS,
      dexFuncHasRecipient: true,
      returnAmountPos: undefined,
    };
  }

  public async updatePoolState() {
    const blockNumber = await this.dexHelper.provider.getBlockNumber();
    await this.poolManager.updatePools(blockNumber, false);

    const tokenAddresses = new Set<string>();
    for (const pool of this.poolManager.poolsByBI.values()) {
      tokenAddresses.add(convertEkuboToParaSwap(pool.key.token0).toLowerCase());
      tokenAddresses.add(convertEkuboToParaSwap(pool.key.token1).toLowerCase());
    }

    if (!tokenAddresses.size) return;

    const calls = Array.from(tokenAddresses).map(tokenAddress => ({
      target: tokenAddress,
      callData: erc20Iface.encodeFunctionData('decimals'),
      decodeFunction: uint8ToNumber,
    }));

    const results = await this.dexHelper.multiWrapper.tryAggregate(
      false,
      calls,
      blockNumber,
    );

    Array.from(tokenAddresses).forEach((address, i) => {
      const result = results[i];
      if (result.success) {
        this.decimals[address] = result.returnData;
      }
    });
  }

  public async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    tokenAddress = tokenAddress.toLowerCase();

    const poolsTokenTvls = (
      await Promise.all(
        this.poolManager.poolsByBI.values().map(async pool => {
          try {
            const tokenPair = [
              convertEkuboToParaSwap(pool.key.token0),
              convertEkuboToParaSwap(pool.key.token1),
            ];

            if (!tokenPair.includes(tokenAddress)) {
              return null;
            }

            const tvls = pool.computeTvl();

            const [token0Tvl, token1Tvl] = tokenPair.map((tokenAddress, i) => {
              const decimals = this.decimals[tokenAddress.toLowerCase()];
              if (!decimals) {
                return null;
              }

              return {
                tvl: tvls[i],
                address: tokenAddress,
                decimals,
              };
            });

            if (token0Tvl === null || token1Tvl === null) {
              return null;
            }

            return {
              pool,
              token0Tvl,
              token1Tvl,
            };
          } catch (err) {
            this.logger.error(
              `TVL computation for pool ${pool.key.stringId} failed: ${err}`,
            );
            return null;
          }
        }),
      )
    ).filter(res => res !== null);

    const usdTvls = await this.dexHelper.getUsdTokenAmounts(
      poolsTokenTvls.flatMap(({ token0Tvl, token1Tvl }) => [
        [token0Tvl.address, token0Tvl.tvl],
        [token1Tvl.address, token1Tvl.tvl],
      ]),
    );

    const poolLiquidities: PoolLiquidity[] = poolsTokenTvls.map(
      ({ token0Tvl, token1Tvl }, i) => {
        const [token0UsdTvl, token1UsdTvl] = usdTvls.slice(i * 2, i * 2 + 2);

        const [connector, thisLiquidityUSD, connectorLiquidityUsd] =
          token0Tvl.address === tokenAddress
            ? [token1Tvl, token0UsdTvl, token1UsdTvl]
            : [token0Tvl, token1UsdTvl, token0UsdTvl];

        return {
          exchange: this.dexKey,
          address: CORE_ADDRESS,
          connectorTokens: [
            {
              address: connector.address,
              decimals: connector.decimals,
              liquidityUSD: connectorLiquidityUsd,
            },
          ],
          liquidityUSD: thisLiquidityUSD,
        };
      },
    );

    poolLiquidities
      .sort((a, b) => b.liquidityUSD - a.liquidityUSD)
      .splice(limit, Infinity);

    return poolLiquidities;
  }

  // LEGACY
  public getAdapters(
    _side: SwapSide,
  ): { name: string; index: number }[] | null {
    return null;
  }

  // LEGACY
  public getCalldataGasCost(
    _poolPrices: PoolPrices<EkuboData>,
  ): number | number[] {
    return CALLDATA_GAS_COST.DEX_NO_PAYLOAD;
  }

  // LEGACY
  public getAdapterParam(
    _srcToken: string,
    _destToken: string,
    _srcAmount: string,
    _destAmount: string,
    _data: EkuboData,
    _side: SwapSide,
  ): AdapterExchangeParam {
    return {
      targetExchange: this.dexKey,
      payload: '',
      networkFee: '0',
    };
  }
}

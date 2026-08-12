import { Interface, JsonFragment } from '@ethersproject/abi';
import {
  AdapterExchangeParam,
  Address,
  DexExchangeParam,
  ExchangePrices,
  Logger,
  NumberAsString,
  PoolLiquidity,
  PoolPrices,
  Token,
} from '../../types';
import {
  ETHER_ADDRESS,
  Network,
  NULL_ADDRESS,
  SwapSide,
  UNLIMITED_USD_LIQUIDITY,
} from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getDexKeysWithNetwork, getBigIntPow, isETHAddress } from '../../utils';
import { IDex } from '../idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import {
  SimpleExchange,
  getLocalDeadlineAsFriendlyPlaceholder,
} from '../simple-exchange';
import { extractReturnAmountPosition } from '../../executor/utils';
import PoolABI from '../../abi/lunar-base/pool.json';
import { LunarBaseConfig } from './config';
import {
  LunarBaseData,
  LunarBasePoolConfig,
  LunarBasePoolState,
  DexParams,
} from './types';
import { LunarBaseEventPool } from './lunar-base-pool';
import { quoteXToY, quoteYToX } from './math';

export class LunarBase extends SimpleExchange implements IDex<LunarBaseData> {
  readonly hasConstantPriceLargeAmounts = false;
  readonly needWrapNative = false;
  readonly isFeeOnTransferSupported = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(LunarBaseConfig);

  protected config: DexParams;
  protected eventPools: Map<Address, LunarBaseEventPool>;
  protected poolIface: Interface;
  logger: Logger;

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey);
    this.config = LunarBaseConfig[dexKey][network];
    this.poolIface = new Interface(PoolABI as JsonFragment[]);
    this.eventPools = new Map(
      this.config.pools.map(pool => [
        pool.address,
        new LunarBaseEventPool(dexKey, dexHelper, pool.address, this.logger),
      ]),
    );
  }

  async initializePricing(blockNumber: number) {
    await Promise.all(
      Array.from(this.eventPools.values()).map(eventPool =>
        eventPool.initialize(blockNumber),
      ),
    );
  }

  getAdapters(_side: SwapSide): { name: string; index: number }[] | null {
    return null;
  }

  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    _blockNumber: number,
  ): Promise<string[]> {
    if (side === SwapSide.BUY) return [];

    return this.config.pools
      .filter(pool =>
        this.isPoolPair(pool, srcToken.address, destToken.address),
      )
      .map(pool => this.getPoolIdentifier(pool));
  }

  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<ExchangePrices<LunarBaseData> | null> {
    if (side === SwapSide.BUY) return null;

    const pool = this.config.pools.find(candidate =>
      this.isPoolPair(candidate, srcToken.address, destToken.address),
    );
    if (!pool) return null;

    const poolIdentifier = this.getPoolIdentifier(pool);
    if (limitPools && !limitPools.includes(poolIdentifier)) return null;

    const eventPool = this.eventPools.get(pool.address);
    if (!eventPool) return null;

    const state = await eventPool.getOrGenerateState(blockNumber);
    if (!state || !this.isStateUsable(state, blockNumber)) return null;

    const isXToY = this.isTokenX(pool, srcToken.address);
    const feeMultiplier = state.blacklistFeeMultiplier || 1n;
    const quote = (amount: bigint) =>
      isXToY
        ? quoteXToY(state, amount, feeMultiplier).amountOut
        : quoteYToX(state, amount, feeMultiplier).amountOut;

    const unit = quote(getBigIntPow(srcToken.decimals));
    if (unit === 0n) return null;

    return [
      {
        unit,
        prices: amounts.map(amount => (amount === 0n ? 0n : quote(amount))),
        data: {
          pool: pool.address,
          tokenIn: this.toPoolTokenAddress(pool, srcToken.address),
          tokenOut: this.toPoolTokenAddress(pool, destToken.address),
          isXToY,
        },
        poolAddresses: [pool.address],
        poolIdentifiers: [poolIdentifier],
        exchange: this.dexKey,
        gasCost: isETHAddress(srcToken.address) ? 180000 : 210000,
      },
    ];
  }

  getCalldataGasCost(
    _poolPrices: PoolPrices<LunarBaseData>,
  ): number | number[] {
    return CALLDATA_GAS_COST.DEX_NO_PAYLOAD;
  }

  getAdapterParam(
    _srcToken: Address,
    _destToken: Address,
    _srcAmount: NumberAsString,
    _destAmount: NumberAsString,
    data: LunarBaseData,
    _side: SwapSide,
  ): AdapterExchangeParam {
    return {
      targetExchange: data.pool,
      payload: '0x',
      networkFee: '0',
    };
  }

  getDexParam(
    srcToken: Address,
    _destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: LunarBaseData,
    side: SwapSide,
  ): DexExchangeParam {
    if (side === SwapSide.BUY) {
      throw new Error(`${this.dexKey}: BUY is not supported`);
    }

    const deadline = getLocalDeadlineAsFriendlyPlaceholder();

    if (isETHAddress(srcToken)) {
      const exchangeData = this.poolIface.encodeFunctionData(
        'swapExactInNative',
        [data.tokenOut, recipient, destAmount, deadline],
      );

      return {
        needWrapNative: false,
        dexFuncHasRecipient: true,
        exchangeData,
        targetExchange: data.pool,
        swappedAmountNotPresentInExchangeData: true,
        returnAmountPos: extractReturnAmountPosition(
          this.poolIface,
          'swapExactInNative',
          'amountOut',
        ),
      };
    }

    const exchangeData = this.poolIface.encodeFunctionData('swapExactIn', [
      [data.tokenIn, data.tokenOut, recipient, srcAmount, destAmount, deadline],
    ]);

    return {
      needWrapNative: false,
      dexFuncHasRecipient: true,
      exchangeData,
      targetExchange: data.pool,
      spender: data.pool,
      returnAmountPos: extractReturnAmountPosition(
        this.poolIface,
        'swapExactIn',
        'amountOut',
      ),
    };
  }

  async updatePoolState(): Promise<void> {
    const blockNumber = await this.dexHelper.provider.getBlockNumber();
    await Promise.all(
      Array.from(this.eventPools.values()).map(eventPool =>
        eventPool.updatePoolState(blockNumber),
      ),
    );
  }

  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    return this.config.pools
      .filter(pool => this.isPoolToken(pool, tokenAddress))
      .slice(0, limit)
      .map(pool => {
        const isTokenX = this.isTokenX(pool, tokenAddress);
        const connector = isTokenX ? pool.tokenY : pool.tokenX;

        return {
          exchange: this.dexKey,
          address: pool.address,
          connectorTokens: [
            {
              decimals: connector.decimals,
              address: connector.address,
            },
          ],
          liquidityUSD: UNLIMITED_USD_LIQUIDITY,
        };
      });
  }

  private getPoolIdentifier(pool: LunarBasePoolConfig): string {
    return `${this.dexKey}_${pool.address}`.toLowerCase();
  }

  private isStateUsable(
    state: LunarBasePoolState,
    blockNumber: number,
  ): boolean {
    if (state.paused) return false;
    if (state.anchorPrice === 0n) return false;
    if (state.reserveX === 0n || state.reserveY === 0n) return false;

    return blockNumber < state.latestUpdateBlock + state.blockDelay;
  }

  private isPoolPair(
    pool: LunarBasePoolConfig,
    src: Address,
    dest: Address,
  ): boolean {
    return (
      (this.isTokenX(pool, src) && this.isTokenY(pool, dest)) ||
      (this.isTokenY(pool, src) && this.isTokenX(pool, dest))
    );
  }

  private isPoolToken(pool: LunarBasePoolConfig, token: Address): boolean {
    return this.isTokenX(pool, token) || this.isTokenY(pool, token);
  }

  private isTokenX(pool: LunarBasePoolConfig, token: Address): boolean {
    return this.normalizedToken(token) === pool.tokenX.address;
  }

  private isTokenY(pool: LunarBasePoolConfig, token: Address): boolean {
    return this.normalizedToken(token) === pool.tokenY.address;
  }

  private normalizedToken(token: Address): Address {
    return isETHAddress(token) ? ETHER_ADDRESS : token.toLowerCase();
  }

  private toPoolTokenAddress(
    pool: LunarBasePoolConfig,
    token: Address,
  ): Address {
    if (this.isTokenX(pool, token)) return pool.tokenX.poolAddress;
    if (this.isTokenY(pool, token)) return pool.tokenY.poolAddress;
    return NULL_ADDRESS;
  }
}

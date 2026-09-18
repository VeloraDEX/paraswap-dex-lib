import { BytesLike, Interface } from 'ethers/lib/utils';
import { SwapSide } from '@paraswap/core';
import { IDexHelper } from '../../../../dex-helper';
import { ETHER_ADDRESS, Network, NULL_ADDRESS } from '../../../../constants';
import { Logger, PoolLiquidity } from '../../../../types';
import UniswapV4PoolManagerABI from '../../../../abi/uniswap-v4/pool-manager.abi.json';
import { MultiResult } from '../../../../lib/multi-wrapper';
import { uint256ToBigInt } from '../../../../lib/decoders';
import { Pool, PoolKey } from '../../types';
import { HooksPermissions, IBaseHook } from '../types';
import { BASE_USDC, BuffetHookConfig } from './config';
import { BuffetEngineState } from './types';

const WAD = 10n ** 18n;
const DECAY_NUM = 100000000000000n;
const DECAY_DEN = 5000000000000000000n;
const SLIP_CAP = 200000000000000n;
const MIN_EXACT_IN_PRICE = 10n * 10n ** 6n;
const MAX_EXACT_IN_PRICE = 50000n * 10n ** 6n;
const UINT64_MASK = (1n << 64n) - 1n;
const UINT128_MASK = (1n << 128n) - 1n;

function mulDiv(x: bigint, y: bigint, d: bigint, roundUp = false): bigint {
  if (d === 0n) {
    throw new Error('division by zero');
  }

  const product = x * y;
  const result = product / d;
  return roundUp && product % d !== 0n ? result + 1n : result;
}

function decodeSlot5(
  slot5: string,
): Pick<BuffetEngineState, 'priceE6' | 'depth' | 'expiryTs'> {
  const packed = BigInt(slot5);

  return {
    priceE6: packed & UINT128_MASK,
    depth: (packed >> 128n) & UINT64_MASK,
    expiryTs: packed >> 192n,
  };
}

export function getBuffetQuote(
  token: string,
  amount: bigint,
  exactIn: boolean,
  state: BuffetEngineState,
): bigint | null {
  const isEth = token.toLowerCase() !== BASE_USDC;
  const { priceE6, depth, expiryTs, ethBal, usdcBal, blockTs } = state;

  if (priceE6 === 0n || blockTs >= expiryTs) {
    return null;
  }

  let q: bigint;
  if (exactIn) {
    q = isEth ? amount : mulDiv(amount, WAD, priceE6, true);
  } else {
    q = isEth ? mulDiv(amount, WAD, priceE6, true) : amount;
  }

  const spread = depth + mulDiv(q, DECAY_NUM, DECAY_DEN, true);
  const usdcInEth = mulDiv(usdcBal, WAD, priceE6);
  const total = ethBal + usdcInEth;
  const mid = total / 2n;

  if (mid === 0n) {
    return null;
  }

  let impactPrice: bigint;
  if (ethBal > usdcInEth) {
    const imbalance = ethBal - mid;
    const slip = (imbalance * SLIP_CAP) / mid;
    impactPrice = mulDiv(
      priceE6,
      WAD,
      WAD + (slip > SLIP_CAP ? SLIP_CAP : slip),
    );
  } else {
    const imbalance = usdcInEth - mid;
    const slip = (imbalance * SLIP_CAP) / mid;
    impactPrice = mulDiv(
      priceE6,
      WAD + (slip > SLIP_CAP ? SLIP_CAP : slip),
      WAD,
    );
  }

  return isEth
    ? mulDiv(impactPrice, WAD, WAD + spread)
    : mulDiv(impactPrice, WAD + spread, WAD, true);
}

export function getBuffetHookAmount(
  zeroForOne: boolean,
  exactIn: boolean,
  amount: bigint,
  price: bigint,
): bigint | null {
  if (price === 0n) {
    return null;
  }

  if (zeroForOne) {
    return exactIn
      ? mulDiv(amount, price, WAD)
      : mulDiv(amount, WAD, price, true);
  }

  return exactIn
    ? mulDiv(amount, WAD, price)
    : mulDiv(amount, price, WAD, true);
}

export class BuffetHook implements IBaseHook {
  readonly name = this.constructor.name;
  readonly address: string;

  private readonly poolManagerIface = new Interface(UniswapV4PoolManagerABI);
  private readonly poolIds = new Set<string>();
  private readonly wethAddress: string;

  constructor(
    readonly dexHelper: IDexHelper,
    readonly network: Network,
    readonly logger: Logger,
  ) {
    this.address = BuffetHookConfig[network].hookAddress.toLowerCase();
    this.wethAddress =
      this.dexHelper.config.data.wrappedNativeTokenAddress.toLowerCase();
  }

  registerPool(poolId: string, poolKey: PoolKey): boolean {
    const config = BuffetHookConfig[this.network];

    if (
      poolId.toLowerCase() === config.poolId &&
      poolKey.currency0.toLowerCase() === config.token0 &&
      poolKey.currency1.toLowerCase() === config.token1 &&
      poolKey.fee === config.fee &&
      poolKey.tickSpacing.toString() === config.tickSpacing
    ) {
      this.poolIds.add(poolId.toLowerCase());
      return true;
    }

    return false;
  }

  initialize(_blockNumber: number): Promise<void> {
    return Promise.resolve();
  }

  getHookPermissions(): HooksPermissions {
    return {
      beforeInitialize: false,
      afterInitialize: false,
      beforeAddLiquidity: false,
      afterAddLiquidity: false,
      beforeRemoveLiquidity: false,
      afterRemoveLiquidity: false,
      beforeSwap: true,
      afterSwap: false,
      beforeDonate: false,
      afterDonate: false,
      beforeSwapReturnDelta: true,
      afterSwapReturnDelta: false,
      afterAddLiquidityReturnDelta: false,
      afterRemoveLiquidityReturnDelta: false,
    };
  }

  async getPricesVolume({
    pool,
    amounts,
    zeroForOne,
    side,
    blockNumber,
  }: {
    pool: Pool;
    amounts: bigint[];
    zeroForOne: boolean;
    side: SwapSide;
    blockNumber: number;
    routerAddress: string;
  }): Promise<bigint[] | null> {
    if (!this.poolIds.has(pool.id.toLowerCase())) {
      return null;
    }

    try {
      const state = await this.getEngineState(blockNumber);
      if (!state) {
        return null;
      }

      const isSell = side === SwapSide.SELL;
      const outputBalance = zeroForOne ? state.usdcBal : state.ethBal;
      const token = zeroForOne ? NULL_ADDRESS : BASE_USDC;

      return amounts.map(amount => {
        if (amount === 0n) {
          return 0n;
        }

        if (!isSell && amount > outputBalance) {
          return 0n;
        }

        const price = getBuffetQuote(token, amount, isSell, state);
        if (price === null) {
          return 0n;
        }

        if (
          isSell &&
          (price <= MIN_EXACT_IN_PRICE || price >= MAX_EXACT_IN_PRICE)
        ) {
          return 0n;
        }

        const quoteAmount = getBuffetHookAmount(
          zeroForOne,
          isSell,
          amount,
          price,
        );

        if (quoteAmount === null) {
          return 0n;
        }

        if (isSell && quoteAmount > outputBalance) {
          return 0n;
        }

        return quoteAmount;
      });
    } catch (e) {
      this.logger.debug(`${this.name}: failed to price Buffet hook`, e);
      return null;
    }
  }

  async getTopPoolsForToken(
    tokenAddress: string,
    limit: number,
    blockNumber: number,
    dexKey: string,
  ): Promise<PoolLiquidity[]> {
    if (limit <= 0) {
      return [];
    }

    const token = tokenAddress.toLowerCase();
    const isNative =
      token === NULL_ADDRESS ||
      token === ETHER_ADDRESS ||
      token === this.wethAddress;
    const isUsdc = token === BASE_USDC;

    if (!isNative && !isUsdc) {
      return [];
    }

    try {
      const state = await this.getEngineState(blockNumber);
      if (!state) {
        return [];
      }

      const [ethUsd, usdcUsd] = await this.dexHelper.getUsdTokenAmounts([
        [ETHER_ADDRESS, state.ethBal],
        [BASE_USDC, state.usdcBal],
      ]);

      const config = BuffetHookConfig[this.network];

      return [
        {
          exchange: dexKey,
          address: config.poolId,
          poolIdentifier: config.poolId,
          liquidityUSD: isNative ? usdcUsd : ethUsd,
          connectorTokens: [
            {
              address: isNative ? BASE_USDC : ETHER_ADDRESS,
              decimals: isNative ? 6 : 18,
              liquidityUSD: isNative ? ethUsd : usdcUsd,
            },
          ],
        },
      ];
    } catch (e) {
      this.logger.debug(`${this.name}: failed to load Buffet top pool`, e);
      return [];
    }
  }

  private async getEngineState(
    blockNumber: number,
  ): Promise<BuffetEngineState | null> {
    const config = BuffetHookConfig[this.network];
    const [slot5, block, balances] = await Promise.all([
      this.dexHelper.provider.getStorageAt(config.priceEngine, 5, blockNumber),
      this.dexHelper.provider.getBlock(blockNumber),
      this.getBalances(blockNumber),
    ]);

    if (!block || balances === null) {
      return null;
    }

    return {
      ...decodeSlot5(slot5),
      ethBal: balances.ethBal,
      usdcBal: balances.usdcBal,
      blockTs: BigInt(block.timestamp),
    };
  }

  private async getBalances(
    blockNumber: number,
  ): Promise<{ ethBal: bigint; usdcBal: bigint } | null> {
    const config = BuffetHookConfig[this.network];

    const calls = [0n, BigInt(BASE_USDC)].map(currencyId => ({
      target: config.poolManager,
      callData: this.poolManagerIface.encodeFunctionData('balanceOf', [
        config.hookAddress,
        currencyId.toString(),
      ]),
      decodeFunction: (result: MultiResult<BytesLike> | BytesLike): bigint =>
        uint256ToBigInt(result),
    }));

    const [ethBal, usdcBal] =
      await this.dexHelper.multiWrapper.tryAggregate<bigint>(
        false,
        calls,
        blockNumber,
        this.dexHelper.multiWrapper.defaultBatchSize,
        false,
      );

    if (!ethBal.success || !usdcBal.success) {
      return null;
    }

    return {
      ethBal: ethBal.returnData,
      usdcBal: usdcBal.returnData,
    };
  }
}

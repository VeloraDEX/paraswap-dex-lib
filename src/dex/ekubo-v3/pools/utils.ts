import { defaultAbiCoder } from '@ethersproject/abi';
import { hexZeroPad, hexlify } from 'ethers/lib/utils';
import { keccak256 } from 'web3-utils';
import { AbiPoolKey } from '../types';
import { floatSqrtRatioToFixed } from './math/sqrt-ratio';

export class PoolKey<C extends PoolTypeConfig> {
  private _stringId?: string;

  public constructor(
    public readonly token0: bigint,
    public readonly token1: bigint,
    public readonly config: PoolConfig<C>,
    private _numId?: bigint,
  ) {}

  public static fromStringId(stringId: string): EkuboPoolKey {
    const [
      _dexIdentifier,
      token0,
      token1,
      extension,
      fee,
      poolTypeConfigDiscriminator,
      poolTypeConfig1,
      poolTypeConfig2,
    ] = stringId.split('_');
    if (poolTypeConfigDiscriminator === 'stableswap') {
      const poolKey = new PoolKey(
        BigInt(token0),
        BigInt(token1),
        new PoolConfig(
          BigInt(extension),
          BigInt(fee),
          new StableswapPoolTypeConfig(
            Number(poolTypeConfig2),
            Number(poolTypeConfig1),
          ),
        ),
      );

      poolKey._stringId = stringId;
      return poolKey;
    }

    if (poolTypeConfigDiscriminator === 'concentrated') {
      const poolKey = new PoolKey(
        BigInt(token0),
        BigInt(token1),
        new PoolConfig(
          BigInt(extension),
          BigInt(fee),
          new ConcentratedPoolTypeConfig(Number(poolTypeConfig1)),
        ),
      );

      poolKey._stringId = stringId;
      return poolKey;
    }

    throw new Error(
      `unknown pool type config discriminator "${poolTypeConfigDiscriminator}"`,
    );
  }

  public get stringId(): string {
    this._stringId ??= [
      'ekubo',
      hexZeroPad(hexlify(this.token0), 20),
      hexZeroPad(hexlify(this.token1), 20),
      hexZeroPad(hexlify(this.config.extension), 20),
      this.config.fee,
      this.config.poolTypeConfig.stringId(),
    ].join('_');

    return this._stringId;
  }

  public get numId(): bigint {
    this._numId ??= BigInt(
      keccak256(
        defaultAbiCoder.encode(
          ['address', 'address', 'bytes32'],
          [
            hexZeroPad(hexlify(this.token0), 20),
            hexZeroPad(hexlify(this.token1), 20),
            hexZeroPad(hexlify(this.config.compressed), 32),
          ],
        ),
      ),
    );

    return this._numId;
  }

  public toAbi(): AbiPoolKey {
    return {
      token0: hexZeroPad(hexlify(this.token0), 20),
      token1: hexZeroPad(hexlify(this.token1), 20),
      config: hexZeroPad(hexlify(this.config.compressed), 32),
    };
  }
}

export interface PoolTypeConfig {
  readonly kind: 'stableswap' | 'concentrated';
  compressed(): bigint;
  stringId(): string;
}

export class StableswapPoolTypeConfig implements PoolTypeConfig {
  public readonly kind = 'stableswap';
  public static fullRangeConfig(): StableswapPoolTypeConfig {
    return new StableswapPoolTypeConfig(0, 0);
  }

  public constructor(
    public centerTick: number,
    public amplificationFactor: number,
  ) {}

  public isFullRange(): boolean {
    return this.centerTick === 0 && this.amplificationFactor === 0;
  }

  public compressed(): bigint {
    return BigInt(this.centerTick) + (BigInt(this.amplificationFactor) << 24n);
  }

  public stringId(): string {
    return `stableswap_${this.amplificationFactor}_${this.centerTick}`;
  }
}

export class ConcentratedPoolTypeConfig implements PoolTypeConfig {
  public readonly kind = 'concentrated';
  public constructor(public tickSpacing: number) {}

  public compressed(): bigint {
    return BigInt(this.tickSpacing) + (1n << 31n);
  }

  public stringId(): string {
    return `concentrated_${this.tickSpacing}`;
  }
}

export type PoolTypeConfigUnion =
  | {
      kind: 'stableswap';
      amplificationFactor: number;
      centerTick: number;
    }
  | {
      kind: 'concentrated';
      tickSpacing: number;
    };

export class PoolConfig<C extends PoolTypeConfig> {
  public constructor(
    public readonly extension: bigint,
    public readonly fee: bigint,
    public readonly poolTypeConfig: C,
    private _compressed?: bigint,
  ) {}

  public get compressed(): bigint {
    this._compressed ??=
      this.poolTypeConfig.compressed() +
      (this.fee << 32n) +
      (this.extension << 96n);
    return this._compressed;
  }
}

export type EkuboPoolKey =
  | PoolKey<StableswapPoolTypeConfig>
  | PoolKey<ConcentratedPoolTypeConfig>;

export function isStableswapKey(
  key: EkuboPoolKey,
): key is PoolKey<StableswapPoolTypeConfig> {
  return key.config.poolTypeConfig.kind === 'stableswap';
}

export function isConcentratedKey(
  key: EkuboPoolKey,
): key is PoolKey<ConcentratedPoolTypeConfig> {
  return key.config.poolTypeConfig.kind === 'concentrated';
}

export interface SwappedEvent {
  poolId: bigint;
  tickAfter: number;
  sqrtRatioAfter: bigint;
  liquidityAfter: bigint;
}

export function parseSwappedEvent(data: string): SwappedEvent {
  let n = BigInt(data);

  const liquidityAfter = BigInt.asUintN(128, n);
  n >>= 128n;

  const tickAfter = Number(BigInt.asIntN(32, n));
  n >>= 32n;

  const sqrtRatioAfter = floatSqrtRatioToFixed(BigInt.asUintN(96, n));
  n >>= 352n;

  const poolId = BigInt.asUintN(256, n);

  return {
    poolId,
    tickAfter,
    sqrtRatioAfter,
    liquidityAfter,
  };
}

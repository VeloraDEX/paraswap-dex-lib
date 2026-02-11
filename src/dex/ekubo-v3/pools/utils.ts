import { defaultAbiCoder } from '@ethersproject/abi';
import { hexZeroPad, hexlify } from 'ethers/lib/utils';
import { keccak256 } from 'web3-utils';
import { AbiPoolKey } from '../types';
import { floatSqrtRatioToFixed } from './math/sqrt-ratio';

export type EkuboPoolKey = PoolKey<
  StableswapPoolTypeConfig | ConcentratedPoolTypeConfig
>;

export class PoolKey<C extends PoolTypeConfig> {
  private _stringId?: string;

  public constructor(
    public readonly token0: bigint,
    public readonly token1: bigint,
    public readonly config: PoolConfig<C>,
    private _numId?: bigint,
  ) {}

  public static fromAbi(abiPk: AbiPoolKey): EkuboPoolKey {
    return new PoolKey(
      BigInt(abiPk.token0),
      BigInt(abiPk.token1),
      PoolConfig.fromCompressed(BigInt(abiPk.config)),
    );
  }

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
    let poolTypeConfig;
    if (poolTypeConfigDiscriminator === 'stableswap') {
      poolTypeConfig = new StableswapPoolTypeConfig(
        Number(poolTypeConfig2),
        Number(poolTypeConfig1),
      );
    } else if (poolTypeConfigDiscriminator === 'concentrated') {
      poolTypeConfig = new ConcentratedPoolTypeConfig(Number(poolTypeConfig1));
    } else {
      throw new Error(
        `unknown pool type config discriminator "${poolTypeConfigDiscriminator}"`,
      );
    }

    const poolKey = new PoolKey(
      BigInt(token0),
      BigInt(token1),
      new PoolConfig(BigInt(extension), BigInt(fee), poolTypeConfig),
    );

    poolKey._stringId = stringId;
    return poolKey;
  }

  public get stringId(): string {
    this._stringId ??= [
      'ekubov3',
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
    // Store the bit pattern of a signed in a truncated unsigned bigint
    const centerTick = BigInt.asUintN(24, BigInt(this.centerTick));
    return (BigInt(this.amplificationFactor) << 24n) | centerTick;
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
  public static fromCompressed(
    compressed: bigint,
  ): PoolConfig<ConcentratedPoolTypeConfig | StableswapPoolTypeConfig> {
    const poolTypeConfigRaw = compressed % 2n ** 32n;

    let poolTypeConfig;

    if ((poolTypeConfigRaw & 0x80000000n) === 0n) {
      poolTypeConfig = new StableswapPoolTypeConfig(
        Number(BigInt.asIntN(24, poolTypeConfigRaw)),
        Number(BigInt.asUintN(7, poolTypeConfigRaw >> 24n)),
      );
    } else {
      poolTypeConfig = new ConcentratedPoolTypeConfig(
        Number(BigInt.asUintN(31, poolTypeConfigRaw)),
      );
    }

    const config = new PoolConfig(
      compressed >> 96n,
      (compressed >> 32n) % 2n ** 64n,
      poolTypeConfig,
    );

    config._compressed = compressed;

    return config;
  }

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

  return {
    tickAfter,
    sqrtRatioAfter,
    liquidityAfter,
  };
}

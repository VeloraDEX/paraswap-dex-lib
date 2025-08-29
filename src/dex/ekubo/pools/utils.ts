import { defaultAbiCoder } from '@ethersproject/abi';
import { hexZeroPad, hexlify } from 'ethers/lib/utils';
import { keccak256 } from 'web3-utils';
import { AbiPoolKey } from '../types';
import { floatSqrtRatioToFixed } from './math/sqrt-ratio';

export class PoolKey {
  private _stringId?: string;
  private _numId?: bigint;

  public constructor(
    public readonly token0: bigint,
    public readonly token1: bigint,
    public readonly config: PoolConfig,
  ) {}

  public static fromStringId(stringId: string): PoolKey {
    const [, token0, token1, extension, fee, tickSpacing] = stringId.split('_');

    const poolKey = new PoolKey(
      BigInt(token0),
      BigInt(token1),
      new PoolConfig(BigInt(extension), BigInt(fee), Number(tickSpacing)),
    );

    poolKey._stringId = stringId;

    return poolKey;
  }

  public get stringId(): string {
    this._stringId ??= [
      'ekubo',
      hexZeroPad(hexlify(this.token0), 20),
      hexZeroPad(hexlify(this.token1), 20),
      hexZeroPad(hexlify(this.config.extension), 20),
      this.config.fee,
      this.config.tickSpacing,
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

export class PoolConfig {
  private _compressed?: bigint;

  public constructor(
    public readonly extension: bigint,
    public readonly fee: bigint,
    public readonly tickSpacing: number,
  ) {}

  public get compressed(): bigint {
    this._compressed ??=
      BigInt(this.tickSpacing) + (this.fee << 32n) + (this.extension << 96n);
    return this._compressed;
  }

  public static fromCompressed(compressed: bigint) {
    const config = new this(
      compressed >> 96n,
      (compressed >> 32n) % 2n ** 64n,
      Number(compressed % 2n ** 32n),
    );

    config._compressed = compressed;

    return config;
  }
}

export interface SwappedEvent {
  poolId: bigint;
  tickAfter: number;
  sqrtRatioAfter: bigint;
  liquidityAfter: bigint;
}

export function parseSwappedEvent(data: string): SwappedEvent {
  let n = BigInt(data);

  const tickAfter = Number(BigInt.asIntN(32, n));
  n >>= 32n;

  const sqrtRatioAfterCompact = BigInt.asUintN(96, n);
  n >>= 96n;

  const sqrtRatioAfter = floatSqrtRatioToFixed(sqrtRatioAfterCompact);

  const liquidityAfter = BigInt.asUintN(128, n);
  n >>= 384n;

  const poolId = BigInt.asUintN(256, n);

  return {
    poolId,
    tickAfter,
    sqrtRatioAfter,
    liquidityAfter,
  };
}

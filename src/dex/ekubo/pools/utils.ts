import { defaultAbiCoder } from '@ethersproject/abi';
import { hexZeroPad, hexlify } from 'ethers/lib/utils';
import { keccak256 } from 'web3-utils';
import { AbiPoolKey } from '../types';
import { hexStringTokenPair } from '../utils';
import { floatSqrtRatioToFixed } from './math/price';

export class PoolKey {
  private _string_id?: string;
  private _num_id?: bigint;

  public constructor(
    public readonly token0: bigint,
    public readonly token1: bigint,
    public readonly config: PoolConfig,
  ) {}

  public get string_id(): string {
    this._string_id ??= `${hexStringTokenPair(this.token0, this.token1)}_${
      this.config.fee
    }_${this.config.tickSpacing}_${hexZeroPad(
      hexlify(this.config.extension),
      20,
    )}`;

    return this._string_id;
  }

  public get num_id(): bigint {
    this._num_id ??= BigInt(
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

    return this._num_id;
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
  public constructor(
    public readonly tickSpacing: number,
    public readonly fee: bigint,
    public readonly extension: bigint,
    private _compressed?: bigint,
  ) {}

  public get compressed(): bigint {
    this._compressed ??=
      BigInt(this.tickSpacing) + (this.fee << 32n) + (this.extension << 96n);
    return this._compressed;
  }

  public static fromCompressed(compressed: bigint) {
    return new this(
      Number(compressed % 2n ** 32n),
      (compressed >> 32n) % 2n ** 64n,
      compressed >> 96n,
      compressed,
    );
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

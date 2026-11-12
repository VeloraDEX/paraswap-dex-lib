import { Interface } from '@ethersproject/abi';
import { DeepReadonly } from 'ts-essentials';
import { IDexHelper } from '../../../dex-helper/idex-helper';
import { Address, BlockHeader, Log, Logger } from '../../../types';
import { bigIntify } from '../../../utils';
import { MultiCallParams } from '../../../lib/multi-wrapper';
import { addressDecode, uint16ToBigInt } from '../../../lib/decoders';
import { AlgebraIntegralEventPool } from '../algebra-integral-pool';
import { AlgebraIntegralPoolState } from '../types';
import NamiV4PoolABI from '../../../abi/algebra-integral/nami-v4/NamiV4Pool.abi.json';
import NamiV4PluginABI from '../../../abi/algebra-integral/nami-v4/NamiV4Plugin.abi.json';

// The plugin sets a per-direction fee in beforeSwap, so `pool.fee()` is not
// what a swap pays. We read `swapFee(zeroToOne)` into `feeZto` / `feeOtz`.
export type NamiV4PoolState = AlgebraIntegralPoolState & {
  plugin: Address;
  globalState: AlgebraIntegralPoolState['globalState'] & {
    feeZto: bigint;
    feeOtz: bigint;
  };
};

export type DirectionalFees = { feeZto: bigint; feeOtz: bigint };

export const namiV4PluginIface = new Interface(NamiV4PluginABI);

export function buildSwapFeeCallData(
  plugin: Address,
): MultiCallParams<bigint>[] {
  return [true, false].map(zeroToOne => ({
    target: plugin,
    callData: namiV4PluginIface.encodeFunctionData('swapFee', [zeroToOne]),
    decodeFunction: uint16ToBigInt,
  }));
}

export class NamiV4Pool extends AlgebraIntegralEventPool {
  public poolIface: Interface = new Interface(NamiV4PoolABI);
  protected readonly stopOnlyAtInitializedTicks = true;

  constructor(
    readonly dexHelper: IDexHelper,
    parentName: string,
    readonly stateMulticallIface: Interface,
    readonly stateMulticallAddress: Address,
    readonly erc20Interface: Interface,
    token0: Address,
    token1: Address,
    logger: Logger,
    mapKey: string,
    poolAddress: Address,
  ) {
    super(
      dexHelper,
      parentName,
      stateMulticallIface,
      stateMulticallAddress,
      erc20Interface,
      token0,
      token1,
      logger,
      mapKey,
      poolAddress,
    );

    this.handlers['Plugin'] = this.handlePluginChange.bind(this);
  }

  async fetchPluginAddress(blockNumber?: number): Promise<Address> {
    const [res] = await this.dexHelper.multiWrapper.tryAggregate<string>(
      false,
      [
        {
          target: this.poolAddress,
          callData: this.poolIface.encodeFunctionData('plugin'),
          decodeFunction: addressDecode,
        },
      ],
      blockNumber,
    );
    if (!res.success) {
      throw new Error(`Pool ${this.poolAddress}: failed to read plugin`);
    }
    return res.returnData.toLowerCase();
  }

  async fetchDirectionalFees(
    plugin: Address,
    blockNumber?: number,
  ): Promise<DirectionalFees | null> {
    const [resZto, resOtz] =
      await this.dexHelper.multiWrapper.tryAggregate<bigint>(
        false,
        buildSwapFeeCallData(plugin),
        blockNumber,
      );
    if (!resZto.success || !resOtz.success) return null;
    return { feeZto: resZto.returnData, feeOtz: resOtz.returnData };
  }

  async generateState(blockNumber: number): Promise<Readonly<NamiV4PoolState>> {
    const [baseState, plugin] = await Promise.all([
      super.generateState(blockNumber),
      this.fetchPluginAddress(blockNumber),
    ]);

    const fees = await this.fetchDirectionalFees(plugin, blockNumber);
    if (!fees) {
      this.logger.warn(
        `${this.parentName}: pool ${this.poolAddress} swapFee call failed, falling back to pool.fee()`,
      );
    }

    return {
      ...baseState,
      plugin,
      globalState: {
        ...baseState.globalState,
        feeZto: fees?.feeZto ?? baseState.globalState.fee,
        feeOtz: fees?.feeOtz ?? baseState.globalState.fee,
      },
    };
  }

  // A new plugin brings its own fee configuration, so the state is rebuilt.
  handlePluginChange(
    _event: any,
    pool: AlgebraIntegralPoolState,
    _log: Log,
    blockHeader: BlockHeader,
  ) {
    pool.isValid = false;
    pool.blockTimestamp = bigIntify(blockHeader.timestamp);
    return pool;
  }

  getNamiState(): DeepReadonly<NamiV4PoolState> | null {
    return this.getStaleState() as DeepReadonly<NamiV4PoolState> | null;
  }
}

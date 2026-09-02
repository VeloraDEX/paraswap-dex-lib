import { Interface } from 'ethers/lib/utils';
import { BytesLike } from 'ethers';
import { IDexHelper } from '../../../../dex-helper';
import { ArrakisPrivateHookConfig } from './config';
import { Network, NULL_ADDRESS } from '../../../../constants';
import { Logger } from '../../../../types';
import { PoolKey, SubgraphPool } from '../../types';
import {
  SwapParams,
  BeforeSwapDelta,
  HooksPermissions,
  IBaseHook,
} from '../types';
import { toId } from '../../utils';
import { LPFeeLibrary } from '../../contract-math/LPFeeLibrary';
import { ArrakisFeeHelper } from './arrakis-fee-helper';
import ArrakisDiscoveryABI from '../../../../abi/uniswap-v4/hooks/arrakis/arrakis-discovery.abi.json';
import { MultiResult } from '../../../../lib/multi-wrapper';
import { generalDecoder, addressDecode } from '../../../../lib/decoders';

const BEFORE_SWAP_SELECTOR = '0x575e24b4'; // beforeSwap(address,(address,address,uint24,int24,address),(bool,int256,uint160),bytes)

const VAULTS_PAGE_SIZE = 1000;

type ModulePoolKey = {
  currency0: string;
  currency1: string;
  fee: bigint;
  tickSpacing: number;
  hooks: string;
};

const poolKeyDecoder = (
  result: MultiResult<BytesLike> | BytesLike,
): ModulePoolKey | null =>
  generalDecoder(
    result,
    ['address', 'address', 'uint24', 'int24', 'address'],
    null,
    value => ({
      currency0: value[0].toLowerCase(),
      currency1: value[1].toLowerCase(),
      fee: BigInt(value[2]),
      tickSpacing: Number(value[3]),
      hooks: value[4].toLowerCase(),
    }),
  );

/**
 * ArrakisPrivateHook is a dynamic fee hook used by Arrakis private vaults.
 * The vault executor sets a per-pool directional LP fee (zeroForOneFee /
 * oneForZeroFee) via `setFees`. On swaps `beforeSwap` overrides the pool's
 * LP fee with the configured value and does not modify swap amounts.
 * Swaps revert on-chain (ModuleNotSet) until fees are configured for a pool.
 */
export class ArrakisPrivateHook implements IBaseHook {
  readonly name = this.constructor.name;
  readonly address: string;
  readonly factoryAddress: string;
  readonly feeHelper: ArrakisFeeHelper;
  readonly discoveryIface = new Interface(ArrakisDiscoveryABI);

  constructor(
    readonly dexHelper: IDexHelper,
    readonly network: Network,
    readonly logger: Logger,
  ) {
    this.address = ArrakisPrivateHookConfig[network].hookAddress.toLowerCase();
    this.factoryAddress =
      ArrakisPrivateHookConfig[network].factoryAddress.toLowerCase();

    this.feeHelper = new ArrakisFeeHelper(
      this.name,
      network,
      dexHelper,
      logger,
    );
  }

  /**
   * Discovers all pools using this hook on-chain (no subgraph dependency):
   * enumerates the private vaults of the ArrakisMetaVaultFactory, reads each
   * vault's active module and keeps the modules whose poolKey uses this hook
   */
  async discoverPools(blockNumber: number): Promise<SubgraphPool[]> {
    const numOfVaultsResult = await this.dexHelper.multiWrapper.tryAggregate(
      true,
      [
        {
          target: this.factoryAddress,
          callData:
            this.discoveryIface.encodeFunctionData('numOfPrivateVaults'),
          decodeFunction: (result: MultiResult<BytesLike> | BytesLike) =>
            generalDecoder(result, ['uint256'], 0n, value =>
              BigInt(value[0].toString()),
            ),
        },
      ],
      blockNumber,
    );

    const numOfVaults = Number(numOfVaultsResult[0].returnData);
    if (numOfVaults === 0) return [];

    const vaultsPagesCalls = [];
    for (let start = 0; start < numOfVaults; start += VAULTS_PAGE_SIZE) {
      const end = Math.min(start + VAULTS_PAGE_SIZE, numOfVaults);
      vaultsPagesCalls.push({
        target: this.factoryAddress,
        callData: this.discoveryIface.encodeFunctionData('privateVaults', [
          start,
          end,
        ]),
        decodeFunction: (result: MultiResult<BytesLike> | BytesLike) =>
          generalDecoder(result, ['address[]'], [], value =>
            value[0].map((v: string) => v.toLowerCase()),
          ),
      });
    }

    const vaultsPages = await this.dexHelper.multiWrapper.tryAggregate<
      string[]
    >(true, vaultsPagesCalls, blockNumber);
    const vaults = vaultsPages.flatMap(page => page.returnData);

    const modulesResults = await this.dexHelper.multiWrapper.tryAggregate(
      false,
      vaults.map(vault => ({
        target: vault,
        callData: this.discoveryIface.encodeFunctionData('module'),
        decodeFunction: addressDecode,
      })),
      blockNumber,
    );

    const modules = modulesResults
      .filter(result => result.success)
      .map(result => result.returnData.toLowerCase());

    // non UniswapV4 modules do not implement poolKey() and just fail here
    const poolKeysResults = await this.dexHelper.multiWrapper.tryAggregate(
      false,
      modules.map(module => ({
        target: module,
        callData: this.discoveryIface.encodeFunctionData('poolKey'),
        decodeFunction: poolKeyDecoder,
      })),
      blockNumber,
    );

    const pools: Record<string, SubgraphPool> = {};
    poolKeysResults.forEach(result => {
      if (!result.success || !result.returnData) return;

      const key = result.returnData;
      if (key.hooks !== this.address) return;

      const id = toId({
        currency0: key.currency0,
        currency1: key.currency1,
        fee: key.fee.toString(),
        tickSpacing: key.tickSpacing,
        hooks: key.hooks,
      }).toLowerCase();

      pools[id] = {
        id,
        fee: key.fee.toString(),
        hooks: key.hooks,
        token0: { address: key.currency0 },
        token1: { address: key.currency1 },
        tickSpacing: key.tickSpacing.toString(),
      };
    });

    return Object.values(pools);
  }

  registerPool(poolId: string, _poolKey: PoolKey) {
    this.feeHelper.addPoolId(poolId.toLowerCase());
  }

  async initialize(blockNumber: number) {
    if (!this.feeHelper.isInitialized) {
      await this.feeHelper.initialize(blockNumber);
    }
  }

  getHookPermissions(): HooksPermissions {
    return {
      beforeInitialize: false,
      afterInitialize: false,
      beforeAddLiquidity: true,
      afterAddLiquidity: false,
      beforeRemoveLiquidity: false,
      afterRemoveLiquidity: false,
      beforeSwap: true,
      afterSwap: false,
      beforeDonate: false,
      afterDonate: false,
      beforeSwapReturnDelta: false,
      afterSwapReturnDelta: false,
      afterAddLiquidityReturnDelta: false,
      afterRemoveLiquidityReturnDelta: false,
    };
  }

  beforeSwap(
    _sender: string,
    key: PoolKey,
    params: SwapParams,
    _hookData: string,
  ): [string, BeforeSwapDelta, number] {
    const poolId = toId(key).toLowerCase();

    const state = this.feeHelper.getStaleState();
    if (!state) {
      throw new Error(
        `${this.name}: fees state is not available for pool ${poolId}`,
      );
    }

    const feesData = state.poolIdToFeesData[poolId];
    if (!feesData || feesData.module === NULL_ADDRESS) {
      // mirrors on-chain ModuleNotSet revert: such pools are not swappable
      throw new Error(`${this.name}: fees are not set for pool ${poolId}`);
    }

    const fee = params.zeroForOne
      ? feesData.zeroForOneFee
      : feesData.oneForZeroFee;

    const lpFeeOverride = fee | LPFeeLibrary.OVERRIDE_FEE_FLAG;

    return [
      BEFORE_SWAP_SELECTOR,
      { amount0: 0n, amount1: 0n },
      Number(lpFeeOverride),
    ];
  }
}

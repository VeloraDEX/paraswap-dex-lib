import { Interface } from '@ethersproject/abi';
import { Contract } from 'web3-eth-contract';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { Address, BlockHeader, Log, Logger } from '../../types';
import { bigIntify } from '../../utils';
import { AlgebraEventPoolV1_1 } from './algebra-pool-v1_1';
import { PoolStateV1_1 } from './types';

export class AlgebraEventPoolV1_9_bidirectional_fee extends AlgebraEventPoolV1_1 {
  constructor(
    readonly dexHelper: IDexHelper,
    parentName: string,
    readonly stateMultiContract: Contract,
    readonly erc20Interface: Interface,
    protected readonly factoryAddress: Address,
    token0: Address,
    token1: Address,
    logger: Logger,
    mapKey: string = '',
    readonly poolInitCodeHash: string,
    readonly poolDeployer: string,
  ) {
    super(
      dexHelper,
      parentName,
      stateMultiContract,
      erc20Interface,
      factoryAddress,
      token0,
      token1,
      logger,
      mapKey,
      poolInitCodeHash,
      poolDeployer,
      true, // forceManualStateGeneration; mainly used for xLayer
      false, // areTicksCompressed
    );

    this.handlers['TickSpacing'] = this.handleTickSpacing.bind(this);
  }

  handleTickSpacing(
    event: any,
    pool: PoolStateV1_1,
    log: Log,
    blockHeader: BlockHeader,
  ) {
    const newTickSpacing = bigIntify(event.args.newTickSpacing);

    pool.tickSpacing = newTickSpacing;
    pool.blockTimestamp = bigIntify(blockHeader.timestamp);

    return pool;
  }
}

import { Interface } from 'ethers/lib/utils';
import { IDexHelper } from '../../../dex-helper';
import { Address, Logger } from '../../../types';
import { AlgebraIntegralEventPool } from '../algebra-integral-pool';
import BlackholeCLPoolABI from '../../../abi/algebra-integral/blackhole-cl/BlackholeCLPool.abi.json';

export class BlackholeCLPool extends AlgebraIntegralEventPool {
  public poolIface: Interface = new Interface(BlackholeCLPoolABI);

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
  }
}

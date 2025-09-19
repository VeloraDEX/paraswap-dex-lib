import { Interface } from '@ethersproject/abi';
import { Logger, Address } from '../../types';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { ERC4626EventPool } from '../erc4626/erc-4626-pool';
import { Network } from '../../constants';
import ERC4626_ABI from '../../abi/ERC4626.json';
import {
  DEPOSIT_TOPIC,
  TRANSFER_TOPIC,
  WITHDRAW_TOPIC,
} from '../erc4626/constants';
import { ERC4626PoolState } from '../erc4626/types';

export class YoEventPool extends ERC4626EventPool {
  constructor(
    readonly parentName: string,
    protected network: Network,
    protected dexHelper: IDexHelper,
    logger: Logger,
    vault: Address,
    asset: Address,
    cooldownEnabled: boolean = false,
    yoIface = new Interface(ERC4626_ABI),
  ) {
    super(
      parentName,
      network,
      `${vault}_${asset}`,
      dexHelper,
      vault,
      asset,
      yoIface,
      logger,
      DEPOSIT_TOPIC,
      WITHDRAW_TOPIC,
      TRANSFER_TOPIC,
      cooldownEnabled,
    );
  }

  withdrawRedeemAllowed(state: ERC4626PoolState): boolean {
    return true;
  }
}

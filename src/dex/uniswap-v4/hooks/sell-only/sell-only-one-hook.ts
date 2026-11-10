import { IDexHelper } from '../../../../dex-helper';
import { Network } from '../../../../constants';
import { Logger } from '../../../../types';
import { SellOnlyHook } from './sell-only-hook';
import { SellOnlyOneHookConfig } from './config';

export class SellOnlyOneHook extends SellOnlyHook {
  constructor(dexHelper: IDexHelper, network: Network, logger: Logger) {
    super(dexHelper, network, logger, SellOnlyOneHookConfig[network]);
  }
}

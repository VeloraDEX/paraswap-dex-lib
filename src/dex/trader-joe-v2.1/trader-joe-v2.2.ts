import { IDexHelper } from '../../dex-helper';
import { Interface, JsonFragment } from 'ethers';
import TraderJoeV21RouterABI from '../../abi/TraderJoeV21Router.json';
import { TRADERJOE_V2_2_ROUTER_ADDRESS } from './config';
import { BaseTraderJoeV2 } from './base';

export class TraderJoeV22 extends BaseTraderJoeV2 {
  static dexKeys = ['traderjoev2.2'];
  needWrapNative = true;

  constructor(dexHelper: IDexHelper) {
    super(
      dexHelper,
      'traderjoev2.2',
      TRADERJOE_V2_2_ROUTER_ADDRESS[dexHelper.config.data.network],
      '3',
    );

    this.exchangeRouterInterface = new Interface(
      TraderJoeV21RouterABI as JsonFragment[],
    );
  }
}

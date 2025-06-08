import { IDexHelper } from '../../dex-helper';
import { Interface, JsonFragment } from 'ethers';
import TraderJoeV21RouterABI from '../../abi/TraderJoeV21Router.json';
import { TRADERJOE_V2_1_ROUTER_ADDRESS } from './config';
import { BaseTraderJoeV2 } from './base';

export class TraderJoeV21 extends BaseTraderJoeV2 {
  static dexKeys = ['traderjoev2.1'];
  needWrapNative = true;

  constructor(dexHelper: IDexHelper) {
    super(
      dexHelper,
      'traderjoev2.1',
      TRADERJOE_V2_1_ROUTER_ADDRESS[dexHelper.config.data.network],
      '2',
    );

    this.exchangeRouterInterface = new Interface(
      TraderJoeV21RouterABI as JsonFragment[],
    );
  }
}

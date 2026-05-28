import {
  Address,
  DexConfigMap,
  DexExchangeParam,
  NumberAsString,
} from '../../types';
import { Network, SwapSide } from '../../constants';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { DexParams } from './types';
import { Interface, JsonFragment } from '@ethersproject/abi';
import { Usual } from './usual';
import { getDexKeysWithNetwork } from '../../utils';
import SWAPFACILITY_ABI from '../../abi/usual-m-wrapped/mSwapFacility.abi.json';

const Config: DexConfigMap<DexParams> = {
  UsualMWrappedM: {
    [Network.MAINNET]: {
      fromToken: {
        address: '0x437cc33344a0b27a429f795ff6b469c72698b291', // wM
        decimals: 6,
      },
      toToken: {
        address: '0x4cbc25559dbbd1272ec5b64c7b5f48a2405e6470', // UsualM
        decimals: 6,
      },
    },
  },
};

export class UsualMWrappedM extends Usual {
  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(Config);

  swapFacilityIface: Interface;

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
  ) {
    super(network, dexKey, dexHelper, Config[dexKey][network]);
    this.swapFacilityIface = new Interface(SWAPFACILITY_ABI as JsonFragment[]);
  }

  async getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: {},
    side: SwapSide,
  ): Promise<DexExchangeParam> {
    if (this.isFromToken(srcToken) && this.isToToken(destToken)) {
      const exchangeData = this.swapFacilityIface.encodeFunctionData(
        'swap(address, address, uint256, address)',
        [
          // extensionIn
          side === SwapSide.SELL
            ? this.config.fromToken.address
            : this.config.toToken.address,
          // extensionOut
          side === SwapSide.SELL
            ? this.config.toToken.address
            : this.config.fromToken.address,
          // amountIn
          side === SwapSide.SELL ? srcAmount : destAmount,
          // recipient
          recipient,
        ],
      );

      return {
        needWrapNative: false,
        dexFuncHasRecipient: true,
        exchangeData,
        targetExchange: this.config.toToken.address,
        returnAmountPos: undefined,
      };
    }

    throw new Error('LOGIC ERROR');
  }
}

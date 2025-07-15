import {
  Address,
  DexConfigMap,
  DexExchangeParam,
  NumberAsString,
} from '../../types';
import { Network, SwapSide } from '../../constants';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { DexParams, UsualBondData } from './types';
import { Interface, JsonFragment } from '@ethersproject/abi';
import USD0PP_ABI from '../../abi/usual-bond/usd0pp.abi.json';
import { Usual } from './usual';
import { getDexKeysWithNetwork } from '../../utils';

const Config: DexConfigMap<DexParams> = {
  UsualBond: {
    [Network.MAINNET]: {
      fromToken: {
        address: '0x73a15fed60bf67631dc6cd7bc5b6e8da8190acf5',
        decimals: 18,
      },
      toToken: {
        address: '0x35d8949372d46b7a3d5a56006ae77b215fc69bc0',
        decimals: 18,
      },
    },
  },
};

export class UsualBond extends Usual {
  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(Config);

  usd0ppIface: Interface;

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
  ) {
    super(network, dexKey, dexHelper, Config[dexKey][network]);
    this.usd0ppIface = new Interface(USD0PP_ABI as JsonFragment[]);
  }

  async getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: UsualBondData,
    side: SwapSide,
  ): Promise<DexExchangeParam> {
    if (this.isFromToken(srcToken) && this.isToToken(destToken)) {
      const exchangeData = this.usd0ppIface.encodeFunctionData('mint', [
        side === SwapSide.SELL ? srcAmount : destAmount,
      ]);

      return {
        needWrapNative: false,
        dexFuncHasRecipient: false,
        exchangeData,
        targetExchange: this.config.toToken.address,
        returnAmountPos: undefined,
      };
    }
    throw new Error('LOGIC ERROR');
  }
}

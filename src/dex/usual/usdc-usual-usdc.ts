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
import USUAL_USDC_ABI from '../../abi/usual-usual-usdc/abi.json';

const Config: DexConfigMap<DexParams> = {
  UsdcUsualUSDC: {
    [Network.MAINNET]: {
      fromToken: {
        address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
        decimals: 6,
      },
      toToken: {
        address: '0xb672B3976bAa3952bFb2eCE8eeFB784f8daB1424', // Usual USDC
        decimals: 6,
      },
    },
  },
};

export class UsdcUsualUSDC extends Usual {
  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(Config);

  usualUsdcIface: Interface;

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
  ) {
    super(network, dexKey, dexHelper, Config[dexKey][network]);
    this.usualUsdcIface = new Interface(USUAL_USDC_ABI as JsonFragment[]);
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
      const fn =
        srcToken.toLowerCase() === this.config.fromToken.address.toLowerCase()
          ? 'wrap(address, uint256)'
          : 'unwrap(address, uint256)';

      const exchangeData = this.usualUsdcIface.encodeFunctionData(fn, [
        recipient,
        side === SwapSide.SELL ? srcAmount : destAmount,
      ]);

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

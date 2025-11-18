import {
  Address,
  NumberAsString,
  DexExchangeParam,
  DexConfigMap,
} from '../../types';
import { SwapSide, Network } from '../../constants';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { DexParams } from './types';
import { Interface, JsonFragment } from '@ethersproject/abi';
import { Usual } from './usual';
import { getDexKeysWithNetwork } from '../../utils';
import USUAL_DAO_COLLATERAL_ABI from '../../abi/usual-m-usd0/usualCollateralDao.abi.json';

type UsualUSDCUsd0Config = DexParams & {
  usualDaoCollateralAddress: Address;
};

const Config: DexConfigMap<UsualUSDCUsd0Config> = {
  UsualUSDCUsd0: {
    [Network.MAINNET]: {
      usualDaoCollateralAddress: '0xde6e1F680C4816446C8D515989E2358636A38b04',
      fromToken: {
        address: '0xb672B3976bAa3952bFb2eCE8eeFB784f8daB1424', // Usual USDC
        decimals: 6,
      },
      toToken: {
        address: '0x73a15fed60bf67631dc6cd7bc5b6e8da8190acf5', // USD0
        decimals: 18,
      },
    },
  },
};

export class UsualUSDCUsd0 extends Usual {
  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(Config);

  usualDaoCollateralIface: Interface;

  declare readonly config: UsualUSDCUsd0Config;

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
  ) {
    super(network, dexKey, dexHelper, Config[dexKey][network]);
    this.usualDaoCollateralIface = new Interface(
      USUAL_DAO_COLLATERAL_ABI as JsonFragment[],
    );
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
      const exchangeData = this.usualDaoCollateralIface.encodeFunctionData(
        'swap',
        [srcToken, srcAmount, '1'],
      );

      return {
        needWrapNative: false,
        dexFuncHasRecipient: false,
        exchangeData,
        targetExchange: this.config.usualDaoCollateralAddress,
      };
    }

    throw new Error('LOGIC ERROR');
  }
}

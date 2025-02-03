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

const Config: DexConfigMap<DexParams & { usualDaoCollateralAddress: Address }> =
  {
    UsualMUsd0: {
      [Network.MAINNET]: {
        usualDaoCollateralAddress: '0xde6e1F680C4816446C8D515989E2358636A38b04',
        fromToken: {
          address: '0x4cbc25559dbbd1272ec5b64c7b5f48a2405e6470',
          decimals: 6,
        },
        toToken: {
          address: '0x73a15fed60bf67631dc6cd7bc5b6e8da8190acf5',
          decimals: 18,
        },
      },
    },
  };

export class UsualMUsd0 extends Usual {
  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(Config);

  usualDaoCollateralIface: Interface;

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
        [srcToken, srcAmount, destAmount],
      );

      return {
        needWrapNative: false,
        dexFuncHasRecipient: false,
        exchangeData,
        targetExchange:
          Config[this.dexKey][this.network].usualDaoCollateralAddress,
        returnAmountPos: undefined,
      };
    }

    throw new Error('LOGIC ERROR');
  }
}

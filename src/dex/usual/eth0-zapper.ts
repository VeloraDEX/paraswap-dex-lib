import {
  Address,
  NumberAsString,
  DexExchangeParam,
  DexConfigMap,
} from '../../types';
import { SwapSide, Network } from '../../constants';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { DexParams, MultiTokenDexParams } from './types';
import { Interface, JsonFragment } from '@ethersproject/abi';
import { MultiTokenUsual } from './multi-token-usual';
import { getDexKeysWithNetwork } from '../../utils';
import IETH0_MINT_ZAP_ABI from '../../abi/eth0/IEth0MintZap.abi.json';

const Config: DexConfigMap<MultiTokenDexParams & { eth0MintZapAddress: Address }> =
  {
    Eth0MintZap: {
      [Network.MAINNET]: {
        eth0MintZapAddress: '0xF4e791120f7791f42fedf61F8d77C12Efb387aA4',
        fromTokens: [
          {
            address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', //WETH
            decimals: 18,
            swapFunction: 'swapWETH',
          },
          {
            address: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84', //stETH
            decimals: 18,
            swapFunction: 'swapStETH',
          },
          {
            address: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0', //wstETH
            decimals: 18,
            swapFunction: 'swapWstETH',
          },
        ],
        toToken: {
          address: '0x734eec7930bc84eC5732022B9EB949A81fB89AbE', //ETH0
          decimals: 18,
        },
      },
    },
  };

export class Eth0MintZap extends MultiTokenUsual {
  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(Config);

  eth0MintZapIface: Interface;

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
  ) {
    super(network, dexKey, dexHelper, Config[dexKey][network]);
    this.eth0MintZapIface = new Interface(
      IETH0_MINT_ZAP_ABI as JsonFragment[],
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
        const exchangeData = this.eth0MintZapIface.encodeFunctionData(
        this.config.fromTokens.find(token => token.address.toLowerCase() === srcToken.toLowerCase())?.swapFunction as string,
        [srcAmount, recipient, destAmount],
      );

      return {
        needWrapNative: false,
        dexFuncHasRecipient: true,
        exchangeData,
        targetExchange:
          Config[this.dexKey][this.network].eth0MintZapAddress,
        returnAmountPos: undefined,
      };
    }

    throw new Error('LOGIC ERROR');
  }
}

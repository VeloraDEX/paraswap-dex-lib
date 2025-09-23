import { Interface, JsonFragment } from '@ethersproject/abi';
import { isHexString, hexConcat } from '@ethersproject/bytes';
import { AdapterExchangeParam, Address, SimpleExchangeParam } from '../types';
import { SwapSide, Network } from '../constants';
import { IDexTxBuilder } from './idex';
import { SimpleExchange } from './simple-exchange';
import AugustusRFQABI from '../abi/paraswap-limit-orders/AugustusRFQ.abi.json';
import PermitABI from '../abi/permit/IERC20Permit.json';
import PermitLegacyABI from '../abi/permit/IERC20PermitLegacy.json';
import { IDexHelper } from '../dex-helper';

const PERMIT_SIGHASH = new Interface(PermitABI).getSighash('permit');
const PERMIT_LEGACY_SIGHASH = new Interface(PermitLegacyABI).getSighash(
  'permit',
);

export type AugustusRFQOrderData = {
  nonceAndMeta: string;
  expiry: number;
  makerAsset: string; // For non-NFT order this is an Address
  makerAssetId?: string; // NFT orders only
  takerAsset: string; // For non-NFT order this is an Address
  takerAssetId?: string; // NFT orders only
  maker: Address;
  taker: Address;
  makerAmount: string;
  takerAmount: string;
  signature: string;
  permitMakerAsset?: string;
};

type AugustusRFQOrderParam = {
  nonceAndMeta: string;
  expiry: number;
  makerAsset: Address;
  takerAsset: Address;
  maker: Address;
  taker: Address;
  makerAmount: string;
  takerAmount: string;
};

type AugustusRFQOrderNFTParam = {
  nonceAndMeta: string;
  expiry: number;
  makerAsset: string;
  makerAssetId: string;
  takerAsset: string;
  takerAssetId: string;
  maker: Address;
  taker: Address;
  makerAmount: string;
  takerAmount: string;
};

type FillOrderParam = [order: AugustusRFQOrderParam, signature: string];
type FillOrderNFTParam = [order: AugustusRFQOrderNFTParam, signature: string];

type AugustusRFQParam = FillOrderParam | FillOrderNFTParam;

enum AugustusRFQFunctions {
  fillOrder = 'fillOrder',
  fillOrderNFT = 'fillOrderNFT',
}

const AUGUSTUS_RFQ_ADDRESS: { [network: number]: Address } = {
  [Network.MAINNET]: '0xe92b586627ccA7a83dC919cc7127196d70f55a06',
  [Network.OPTIMISM]: '0x0927FD43a7a87E3E8b81Df2c44B03C4756849F6D',
  [Network.BSC]: '0x8DcDfe88EF0351f27437284D0710cD65b20288bb',
  [Network.GNOSIS]: '0x92EaD5bACf6F0E995FA46Ad8215A9b11f67ca241',
  [Network.UNICHAIN]: '0x92EaD5bACf6F0E995FA46Ad8215A9b11f67ca241',
  [Network.POLYGON]: '0xF3CD476C3C4D3Ac5cA2724767f269070CA09A043',
  [Network.SONIC]: '0x92EaD5bACf6F0E995FA46Ad8215A9b11f67ca241',
  [Network.BASE]: '0xa003dFBA51C9e1e56C67ae445b852bdEd7aC5EEd',
  [Network.AVALANCHE]: '0x34302c4267d0dA0A8c65510282Cc22E9e39df51f',
  [Network.ARBITRUM]: '0x0927FD43a7a87E3E8b81Df2c44B03C4756849F6D',
};

export class AugustusRFQOrder
  extends SimpleExchange
  implements IDexTxBuilder<AugustusRFQOrderData, AugustusRFQParam>
{
  static dexKeys = ['augustusrfqorder'];
  rfqInterface: Interface;
  needWrapNative = true;

  constructor(dexHelper: IDexHelper) {
    super(dexHelper, 'augustusrfqorder');
    this.rfqInterface = new Interface(AugustusRFQABI as JsonFragment[]);
  }

  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: AugustusRFQOrderData,
    side: SwapSide,
  ): AdapterExchangeParam {
    throw new Error('AugustusRFQOrder: getAdapterParam not implemented!');
  }

  async getSimpleParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: AugustusRFQOrderData,
    side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    const isNFTOrder = !!data.makerAssetId || !!data.takerAssetId;

    const swapFunction = isNFTOrder
      ? AugustusRFQFunctions.fillOrderNFT
      : AugustusRFQFunctions.fillOrder;

    const swapFunctionParams: AugustusRFQParam = isNFTOrder
      ? [
          {
            nonceAndMeta: data.nonceAndMeta,
            expiry: data.expiry,
            makerAsset: data.makerAsset,
            makerAssetId: data.makerAssetId!,
            takerAsset: data.takerAsset,
            takerAssetId: data.takerAssetId!,
            maker: data.maker,
            taker: data.taker,
            makerAmount: data.makerAmount,
            takerAmount: data.takerAmount,
          },
          data.signature,
        ]
      : [
          {
            nonceAndMeta: data.nonceAndMeta,
            expiry: data.expiry,
            makerAsset: data.makerAsset,
            takerAsset: data.takerAsset,
            maker: data.maker,
            taker: data.taker,
            makerAmount: data.makerAmount,
            takerAmount: data.takerAmount,
          },
          data.signature,
        ];

    const swapData = this.rfqInterface.encodeFunctionData(
      swapFunction,
      swapFunctionParams,
    );

    const simpleParam = await this.buildSimpleParamWithoutWETHConversion(
      srcToken,
      srcAmount,
      destToken,
      destAmount,
      swapData,
      AUGUSTUS_RFQ_ADDRESS[this.network],
    );

    if (data.permitMakerAsset) {
      if (isNFTOrder) throw new Error('Permit not supported for NFTs');

      let permitCalldata: string;
      if (isHexString(data.permitMakerAsset, 7 * 32)) {
        permitCalldata = hexConcat([PERMIT_SIGHASH, data.permitMakerAsset]);
      } else if (isHexString(data.permitMakerAsset, 8 * 32)) {
        permitCalldata = hexConcat([
          PERMIT_LEGACY_SIGHASH,
          data.permitMakerAsset,
        ]);
      } else {
        throw new Error('Invalid permitMakerAsset');
      }

      simpleParam.callees.unshift(data.makerAsset);
      simpleParam.calldata.unshift(permitCalldata);
      simpleParam.values.unshift('0');
    }

    return simpleParam;
  }
}

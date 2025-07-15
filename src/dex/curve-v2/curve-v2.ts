import { Interface, JsonFragment } from '@ethersproject/abi';
import { SwapSide } from '../../constants';
import {
  AdapterExchangeParam,
  Address,
  DexExchangeParam,
  ExchangeTxInfo,
  NumberAsString,
  PreprocessTransactionOptions,
  SimpleExchangeParam,
  Token,
  TxInfo,
} from '../../types';
import { IDexTxBuilder } from '../idex';
import {
  getLocalDeadlineAsFriendlyPlaceholder,
  SimpleExchange,
} from '../simple-exchange';
import GenericFactoryZapABI from '../../abi/curve-v2/GenericFactoryZap.json';
import DirectSwapABI from '../../abi/DirectSwap.json';
import CurveV2ABI from '../../abi/CurveV2.json';
import { IDexHelper } from '../../dex-helper';
import { assert } from 'ts-essentials';
import { Logger } from 'log4js';
import { OptimalSwapExchange } from '@paraswap/core';
import { isETHAddress, uuidToBytes16 } from '../../utils';
import { DIRECT_METHOD_NAME_V6 } from './constants';
import {
  CurveV2DirectSwap,
  CurveV2DirectSwapParam,
  CurveV2SwapType,
} from './types';
import { packCurveData } from '../../lib/curve/encoder';
import { hexConcat, hexZeroPad, hexlify } from 'ethers/lib/utils';

const DIRECT_METHOD_NAME = 'directCurveV2Swap';

type CurveV2Data = {
  i: number;
  j: number;
  exchange: string;
  originalPoolAddress: Address;
  swapType: CurveV2SwapType;
  isApproved?: boolean;
};

type CurveV2Param = [
  i: NumberAsString,
  j: NumberAsString,
  dx: NumberAsString,
  min_dy: NumberAsString,
  ethDeposit?: boolean,
];

type CurveV2ParamsForGenericFactoryZap = [
  _pool: Address,
  i: NumberAsString,
  j: NumberAsString,
  dx: NumberAsString,
  min_dy: NumberAsString,
];

export type DirectCurveV2Param = [
  fromToken: Address,
  toToken: Address,
  exchange: Address,
  poolAddress: Address,
  fromAmount: NumberAsString,
  toAmount: NumberAsString,
  expectedAmount: NumberAsString,
  feePercent: NumberAsString,
  i: NumberAsString,
  j: NumberAsString,
  partner: Address,
  isApproved: boolean,
  swapType: CurveV2SwapType,
  beneficiary: Address,
  needWrapNative: boolean,
  permit: string,
  uuid: string,
];

enum CurveV2SwapFunctions {
  exchange = 'exchange(uint256 i, uint256 j, uint256 dx, uint256 minDy)',
  exchange_underlying = 'exchange_underlying(uint256 i, uint256 j, uint256 dx, uint256 minDy)',
  exchange_in_generic_factory_zap = 'exchange(address _pool, uint256 i, uint256 j, uint256 _dx, uint256 _min_dy)',
}

export class CurveV2
  extends SimpleExchange
  implements IDexTxBuilder<CurveV2Data, DirectCurveV2Param | CurveV2DirectSwap>
{
  static dexKeys = ['curvev2'];
  exchangeRouterInterface: Interface;
  genericFactoryZapIface: Interface;
  minConversionRate = '1';
  // the dex supports native ETH and WETH pools and handles wrapping/unwrapping on their smart contract level, we can always send WETH even for native ETH pools
  needWrapNative = true;
  logger: Logger;

  readonly directSwapIface = new Interface(DirectSwapABI);

  constructor(readonly dexHelper: IDexHelper) {
    super(dexHelper, 'curvev2');
    this.exchangeRouterInterface = new Interface(CurveV2ABI as JsonFragment[]);
    this.genericFactoryZapIface = new Interface(GenericFactoryZapABI);
    this.logger = dexHelper.getLogger(
      `CurveV2_${dexHelper.config.data.network}`,
    );
  }

  getAdapterParam(
    _0: string,
    _1: string,
    _2: string,
    _3: string,
    data: CurveV2Data,
    side: SwapSide,
  ): AdapterExchangeParam {
    if (side === SwapSide.BUY) throw new Error(`Buy not supported`);

    const { i, j, originalPoolAddress, swapType } = data;
    const payload = this.abiCoder.encodeParameter(
      {
        ParentStruct: {
          i: 'uint256',
          j: 'uint256',
          originalPoolAddress: 'address',
          swapType: 'uint8',
        },
      },
      {
        i,
        j,
        originalPoolAddress,
        swapType,
      },
    );

    return {
      targetExchange: data.exchange,
      payload,
      networkFee: '0',
    };
  }

  getTokenFromAddress(address: Address): Token {
    // In this Dex decimals are not used
    return { address, decimals: 0 };
  }

  async preProcessTransaction(
    optimalSwapExchange: OptimalSwapExchange<CurveV2Data>,
    srcToken: Token,
    _0: Token,
    _1: SwapSide,
    options: PreprocessTransactionOptions,
  ): Promise<[OptimalSwapExchange<CurveV2Data>, ExchangeTxInfo]> {
    if (!options.isDirectMethod) {
      return [
        optimalSwapExchange,
        {
          deadline: BigInt(getLocalDeadlineAsFriendlyPlaceholder()),
        },
      ];
    }

    assert(
      optimalSwapExchange.data !== undefined,
      `preProcessTransaction: data field is missing`,
    );

    let isApproved: boolean | undefined;

    try {
      isApproved = await this.dexHelper.augustusApprovals.hasApproval(
        options.executionContractAddress,
        this.dexHelper.config.wrapETH(srcToken).address,
        optimalSwapExchange.data.exchange,
      );
    } catch (e) {
      this.logger.error(
        `preProcessTransaction failed to retrieve allowance info: `,
        e,
      );
    }

    return [
      {
        ...optimalSwapExchange,
        data: {
          ...optimalSwapExchange.data,
          isApproved,
        },
      },
      {
        deadline: BigInt(getLocalDeadlineAsFriendlyPlaceholder()),
      },
    ];
  }

  getDirectParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    expectedAmount: NumberAsString,
    data: CurveV2Data,
    side: SwapSide,
    permit: string,
    uuid: string,
    feePercent: NumberAsString,
    _0: NumberAsString,
    partner: string,
    beneficiary: string,
    contractMethod: string,
  ): TxInfo<DirectCurveV2Param> {
    if (contractMethod !== DIRECT_METHOD_NAME) {
      throw new Error(`Invalid contract method ${contractMethod}`);
    }
    assert(side === SwapSide.SELL, 'Buy not supported');

    let isApproved: boolean = !!data.isApproved;
    if (data.isApproved === undefined) {
      this.logger.warn(`isApproved is undefined, defaulting to false`);
    }

    const swapParams: DirectCurveV2Param = [
      srcToken,
      destToken,
      data.exchange,
      data.originalPoolAddress,
      srcAmount,
      destAmount,
      expectedAmount,
      feePercent,
      data.i.toString(),
      data.j.toString(),
      partner,
      isApproved,
      data.swapType,
      beneficiary,
      // For now we always wrap native. We don't support non native trade
      true,
      permit,
      uuidToBytes16(uuid),
    ];

    const encoder = (...params: DirectCurveV2Param) => {
      return this.directSwapIface.encodeFunctionData(DIRECT_METHOD_NAME, [
        params,
      ]);
    };

    return {
      params: swapParams,
      encoder,
      networkFee: '0',
    };
  }

  getDirectParamV6(
    srcToken: Address,
    destToken: Address,
    fromAmount: NumberAsString,
    toAmount: NumberAsString,
    quotedAmount: NumberAsString,
    data: CurveV2Data,
    side: SwapSide,
    permit: string,
    uuid: string,
    partnerAndFee: string,
    beneficiary: string,
    blockNumber: number,
    contractMethod: string,
  ) {
    if (contractMethod !== DIRECT_METHOD_NAME_V6) {
      throw new Error(`Invalid contract method ${contractMethod}`);
    }

    assert(side === SwapSide.SELL, 'Buy not supported');

    const metadata = hexConcat([
      hexZeroPad(uuidToBytes16(uuid), 16),
      hexZeroPad(hexlify(blockNumber), 16),
    ]);

    const swapParams: CurveV2DirectSwapParam = [
      packCurveData(
        data.exchange,
        !data.isApproved, // approve flag, if not approved then set to true
        isETHAddress(destToken) ? 2 : isETHAddress(srcToken) ? 1 : 0,
        data.swapType,
      ).toString(),
      data.i,
      data.j,
      data.originalPoolAddress,
      srcToken,
      destToken,
      fromAmount,
      toAmount,
      quotedAmount,
      metadata,
      beneficiary,
    ];

    const encodeParams: CurveV2DirectSwap = [swapParams, partnerAndFee, permit];

    const encoder = (...params: CurveV2DirectSwap) => {
      return this.augustusV6Interface.encodeFunctionData(
        DIRECT_METHOD_NAME_V6,
        [...params],
      );
    };

    return {
      params: encodeParams,
      encoder,
      networkFee: '0',
    };
  }

  static getDirectFunctionNameV6(): string[] {
    return [DIRECT_METHOD_NAME_V6];
  }

  static getDirectFunctionName(): string[] {
    return [DIRECT_METHOD_NAME];
  }

  async getSimpleParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: CurveV2Data,
    side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    if (side === SwapSide.BUY) throw new Error(`Buy not supported`);

    const { exchange, i, j, originalPoolAddress, swapType } = data;

    const args: CurveV2Param | CurveV2ParamsForGenericFactoryZap =
      swapType === CurveV2SwapType.EXCHANGE_GENERIC_FACTORY_ZAP
        ? [
            originalPoolAddress,
            i.toString(),
            j.toString(),
            srcAmount,
            this.minConversionRate,
          ]
        : [i.toString(), j.toString(), srcAmount, this.minConversionRate];

    let swapMethod: string;
    switch (swapType) {
      case CurveV2SwapType.EXCHANGE:
        swapMethod = CurveV2SwapFunctions.exchange;
        break;
      case CurveV2SwapType.EXCHANGE_UNDERLYING:
        swapMethod = CurveV2SwapFunctions.exchange_underlying;
        break;
      case CurveV2SwapType.EXCHANGE_GENERIC_FACTORY_ZAP:
        swapMethod = CurveV2SwapFunctions.exchange_in_generic_factory_zap;
        break;
      default:
        throw new Error(
          `getSimpleParam: not all cases covered for CurveV2SwapTypes`,
        );
    }

    const swapData =
      swapMethod === CurveV2SwapFunctions.exchange_in_generic_factory_zap
        ? this.genericFactoryZapIface.encodeFunctionData(swapMethod, args)
        : this.exchangeRouterInterface.encodeFunctionData(swapMethod, args);

    return this.buildSimpleParamWithoutWETHConversion(
      srcToken,
      srcAmount,
      destToken,
      destAmount,
      swapData,
      exchange,
    );
  }

  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: CurveV2Data,
    side: SwapSide,
  ): DexExchangeParam {
    if (side === SwapSide.BUY) throw new Error(`Buy not supported`);

    const { exchange, i, j, originalPoolAddress, swapType } = data;

    const args: CurveV2Param | CurveV2ParamsForGenericFactoryZap =
      swapType === CurveV2SwapType.EXCHANGE_GENERIC_FACTORY_ZAP
        ? [
            originalPoolAddress,
            i.toString(),
            j.toString(),
            srcAmount,
            this.minConversionRate,
          ]
        : [i.toString(), j.toString(), srcAmount, this.minConversionRate];

    let swapMethod: string;
    switch (swapType) {
      case CurveV2SwapType.EXCHANGE:
        swapMethod = CurveV2SwapFunctions.exchange;
        break;
      case CurveV2SwapType.EXCHANGE_UNDERLYING:
        swapMethod = CurveV2SwapFunctions.exchange_underlying;
        break;
      case CurveV2SwapType.EXCHANGE_GENERIC_FACTORY_ZAP:
        swapMethod = CurveV2SwapFunctions.exchange_in_generic_factory_zap;
        break;
      default:
        throw new Error(
          `getSimpleParam: not all cases covered for CurveV2SwapTypes`,
        );
    }

    const swapData =
      swapMethod === CurveV2SwapFunctions.exchange_in_generic_factory_zap
        ? this.genericFactoryZapIface.encodeFunctionData(swapMethod, args)
        : this.exchangeRouterInterface.encodeFunctionData(swapMethod, args);

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: false,
      exchangeData: swapData,
      targetExchange: exchange,
      returnAmountPos: undefined,
    };
  }
}

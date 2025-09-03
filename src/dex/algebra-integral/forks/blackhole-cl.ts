import _ from 'lodash';
import { Token, ExchangePrices, TransferFeeParams } from '../../../types';
import {
  SwapSide,
  Network,
  DEST_TOKEN_DEX_TRANSFERS,
  SRC_TOKEN_DEX_TRANSFERS,
} from '../../../constants';
import { BytesLike, Interface } from 'ethers/lib/utils';
import { BigNumber } from 'ethers';
import {
  BalanceRequest,
  getBalances,
} from '../../../lib/tokens/balancer-fetcher';
import SwapRouter from '../../../abi/algebra-integral/SwapRouter.abi.json';
import BlackholeClQuoterABI from '../../../abi/algebra-integral/blackhole-cl/Quoter.abi.json';
import {
  _require,
  getBigIntPow,
  getDexKeysWithNetwork,
  interpolate,
  isDestTokenTransferFeeToBeExchanged,
  isSrcTokenTransferFeeToBeExchanged,
} from '../../../utils';
import { IDexHelper } from '../../../dex-helper/idex-helper';
import { AlgebraIntegralData, Pool } from '../types';
import { applyTransferFee } from '../../../lib/token-transfer-fee';
import { AlgebraIntegralConfig } from '../config';
import {
  AssetType,
  DEFAULT_ID_ERC20,
  DEFAULT_ID_ERC20_AS_STRING,
} from '../../../lib/tokens/types';
import { AlgebraIntegral } from '../algebra-integral';
import { ALGEBRA_GAS_COST, ALGEBRA_QUOTE_GASLIMIT } from '../constants';
import { MultiResult } from '../../../lib/multi-wrapper';
import { generalDecoder } from '../../../lib/decoders';

export class BlackholeCL extends AlgebraIntegral {
  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
    readonly routerIface = new Interface(SwapRouter),
    readonly quoterIface = new Interface(BlackholeClQuoterABI),
    readonly config = AlgebraIntegralConfig[dexKey][network],
  ) {
    super(network, dexKey, dexHelper, routerIface, quoterIface, config);
  }

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(_.pick(AlgebraIntegralConfig, ['BlackholeCL']));

  getMultiCallData(
    from: string,
    to: string,
    deployer: string,
    amount: bigint,
    isSELL = true,
  ) {
    return {
      target: this.config.quoter,
      gasLimit: ALGEBRA_QUOTE_GASLIMIT,
      callData: this.quoterIface.encodeFunctionData(
        isSELL ? 'quoteExactInputSingle' : 'quoteExactOutputSingle',
        [[from, to, deployer, amount.toString(), 0]],
      ),
      decodeFunction: (result: MultiResult<BytesLike> | BytesLike) => {
        const parsed = generalDecoder(
          result,
          ['uint256', 'uint256'], // amountOut, amountIn
          [0n, 0n],
          result => result.map((amount: BigNumber) => amount.toBigInt()),
        );

        return isSELL ? parsed[0] : parsed[1];
      },
    };
  }
}

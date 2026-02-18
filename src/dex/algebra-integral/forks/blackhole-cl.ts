import _ from 'lodash';
import { Network } from '../../../constants';
import { BytesLike, Interface } from 'ethers/lib/utils';
import { BigNumber } from 'ethers';
import SwapRouter from '../../../abi/algebra-integral/SwapRouter.abi.json';
import BlackholeClQuoterABI from '../../../abi/algebra-integral/blackhole-cl/Quoter.abi.json';
import { _require, getDexKeysWithNetwork } from '../../../utils';
import { IDexHelper } from '../../../dex-helper/idex-helper';
import { AlgebraIntegralConfig } from '../config';
import { AlgebraIntegral } from '../algebra-integral';
import { ALGEBRA_QUOTE_GASLIMIT } from '../constants';
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

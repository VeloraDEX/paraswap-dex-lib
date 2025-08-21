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

  async getPricingFromRpc(
    from: Token,
    to: Token,
    amounts: bigint[],
    side: SwapSide,
    pools: Pool[],
    transferFees: TransferFeeParams = {
      srcFee: 0,
      destFee: 0,
      srcDexFee: 0,
      destDexFee: 0,
    },
  ): Promise<ExchangePrices<AlgebraIntegralData> | null> {
    if (pools.length === 0) {
      return null;
    }

    this.logger.warn(`fallback to rpc for ${pools.length} pool(s)`);

    const isSELL = side === SwapSide.SELL;

    const requests = pools.map<BalanceRequest>(pool => ({
      owner: pool.poolAddress,
      asset: isSELL ? from.address : to.address,
      assetType: AssetType.ERC20,
      ids: [{ id: DEFAULT_ID_ERC20, spenders: [] }],
    }));

    const balances = await getBalances(this.dexHelper.multiWrapper, requests);

    const _isSrcTokenTransferFeeToBeExchanged =
      isSrcTokenTransferFeeToBeExchanged(transferFees);
    const _isDestTokenTransferFeeToBeExchanged =
      isDestTokenTransferFeeToBeExchanged(transferFees);

    const unitVolume = getBigIntPow((isSELL ? from : to).decimals);

    const chunks = amounts.length - 1;
    const _width = Math.floor(chunks / this.config.chunksCount);
    const chunkedAmounts = [unitVolume].concat(
      Array.from(Array(this.config.chunksCount).keys()).map(
        i => amounts[(i + 1) * _width],
      ),
    );

    const availableAmountsPerPool = pools.map((pool, index) => {
      const balance = balances[index].amounts[DEFAULT_ID_ERC20_AS_STRING];
      return chunkedAmounts.map(amount => (balance >= amount ? amount : 0n));
    });

    const amountsWithFeePerPool = availableAmountsPerPool.map(poolAmounts =>
      _isSrcTokenTransferFeeToBeExchanged
        ? applyTransferFee(
            poolAmounts,
            side,
            transferFees.srcDexFee,
            SRC_TOKEN_DEX_TRANSFERS,
          )
        : poolAmounts,
    );

    const calldata = pools.flatMap((pool, poolIndex) => {
      const amountsForPool = amountsWithFeePerPool[poolIndex];

      return amountsForPool
        .filter(amount => amount !== 0n)
        .map(amount => ({
          target: this.config.quoter,
          gasLimit: ALGEBRA_QUOTE_GASLIMIT,
          callData: this.quoterIface.encodeFunctionData(
            isSELL ? 'quoteExactInputSingle' : 'quoteExactOutputSingle',
            [[from.address, to.address, pool.deployer, amount.toString(), 0]],
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
        }));
    });

    const data = await this.dexHelper.multiWrapper.tryAggregate(
      false,
      calldata,
    );

    let i = 0;
    const result = pools.map((pool, poolIndex) => {
      const amountsForPool = amountsWithFeePerPool[poolIndex];
      const _rates = amountsForPool.map(a =>
        a === 0n ? 0n : (data[i++].returnData as bigint),
      );

      const _ratesWithFee = _isDestTokenTransferFeeToBeExchanged
        ? applyTransferFee(
            _rates,
            side,
            transferFees.destDexFee,
            DEST_TOKEN_DEX_TRANSFERS,
          )
        : _rates;

      const unit: bigint = _ratesWithFee[0];

      const prices = interpolate(
        chunkedAmounts.slice(1),
        _ratesWithFee.slice(1),
        amounts,
        side,
      );

      return {
        prices,
        unit,
        data: {
          feeOnTransfer: _isSrcTokenTransferFeeToBeExchanged,
          path: [
            {
              tokenIn: from.address,
              tokenOut: to.address,
              deployer: pool.deployer,
            },
          ],
        },
        poolIdentifier: this.getPoolIdentifier(
          pool.token0,
          pool.token1,
          pool.deployer,
        ),
        exchange: this.dexKey,
        gasCost: ALGEBRA_GAS_COST,
        poolAddresses: [pool.poolAddress],
      };
    });

    return result;
  }
}

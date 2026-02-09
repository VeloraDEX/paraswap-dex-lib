import { pack } from '@ethersproject/solidity';
import _ from 'lodash';
import {
  Token,
  Address,
  ExchangePrices,
  PoolPrices,
  AdapterExchangeParam,
  PoolLiquidity,
  TransferFeeParams,
  Logger,
  DexExchangeParam,
  NumberAsString,
} from '../../types';
import {
  SwapSide,
  Network,
  DEST_TOKEN_DEX_TRANSFERS,
  SRC_TOKEN_DEX_TRANSFERS,
} from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { Interface } from 'ethers/lib/utils';
import SwapRouter from '../../abi/algebra-integral/SwapRouter.abi.json';
import AlgebraQuoterABI from '../../abi/algebra-integral/Quoter.abi.json';
import {
  _require,
  getBigIntPow,
  getDexKeysWithNetwork,
  interpolate,
  isDestTokenTransferFeeToBeExchanged,
  isSrcTokenTransferFeeToBeExchanged,
} from '../../utils';
import { IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { AlgebraIntegralData, Pool, AlgebraIntegralFunctions } from './types';
import {
  SimpleExchange,
  getLocalDeadlineAsFriendlyPlaceholder,
} from '../simple-exchange';
import { applyTransferFee } from '../../lib/token-transfer-fee';
import { AlgebraIntegralConfig } from './config';
import { extractReturnAmountPosition } from '../../executor/utils';
import { AlgebraIntegralFactory } from './algebra-integral-factory';
import {
  ALGEBRA_GAS_COST,
  ALGEBRA_QUOTE_GASLIMIT,
  ALGEBRA_EFFICIENCY_FACTOR,
  POOL_TVL_UPDATE_INTERVAL,
  MIN_USD_TVL_FOR_PRICING,
} from './constants';
import { uint256ToBigInt } from '../../lib/decoders';

export class AlgebraIntegral
  extends SimpleExchange
  implements IDex<AlgebraIntegralData>
{
  readonly hasConstantPriceLargeAmounts = false;
  readonly needWrapNative = true;
  readonly isFeeOnTransferSupported = true;

  private readonly factory: AlgebraIntegralFactory;
  private updatePoolsTvlTimer?: NodeJS.Timeout;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(AlgebraIntegralConfig);

  logger: Logger;

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
    readonly routerIface = new Interface(SwapRouter),
    readonly quoterIface = new Interface(AlgebraQuoterABI),
    readonly config = AlgebraIntegralConfig[dexKey][network],
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey);

    this.factory = new AlgebraIntegralFactory(
      dexKey,
      this.network,
      dexHelper,
      this.logger,
      this.config.factory,
      this.config.subgraphURL,
    );
  }

  async initializePricing(blockNumber: number) {
    await this.factory.initialize(blockNumber);

    // Set up TVL update timer (slave only)
    if (!this.updatePoolsTvlTimer && this.dexHelper.config.isSlave) {
      try {
        await this.factory.updatePoolsTvl();
      } catch (error) {
        this.logger.error(
          `${this.dexKey}: Failed to update pool TVL on initialize:`,
          error,
        );
      }

      this.updatePoolsTvlTimer = setInterval(async () => {
        try {
          await this.factory.updatePoolsTvl();
        } catch (error) {
          this.logger.error(
            `${this.dexKey}: Failed to update pool TVL:`,
            error,
          );
        }
      }, POOL_TVL_UPDATE_INTERVAL * 1000);
    }
  }

  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return null;
  }

  getPoolIdentifier(
    srcAddress: Address,
    destAddress: Address,
    deployerAddress: Address,
  ) {
    const tokenAddresses = this._sortTokens(srcAddress, destAddress).join('_');
    return `${this.dexKey}_${tokenAddresses}_${deployerAddress}`;
  }

  // Returns list of pool identifiers that can be used
  // for a given swap. poolIdentifiers must be unique
  // across DEXes. It is recommended to use
  // ${dexKey}_${poolAddress} as a poolIdentifier
  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    const _srcToken = this.dexHelper.config.wrapETH(srcToken);
    const _destToken = this.dexHelper.config.wrapETH(destToken);

    const [_srcAddress, _destAddress] = this._getLoweredAddresses(
      _srcToken,
      _destToken,
    );

    if (_srcAddress === _destAddress) return [];

    const pools = this.factory.getAvailablePoolsForPair(
      _srcAddress,
      _destAddress,
    );

    if (pools.length === 0) return [];

    return pools.map(pool =>
      this.getPoolIdentifier(_srcAddress, _destAddress, pool.deployer),
    );
  }

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
        [from, to, deployer, amount.toString(), 0],
      ),
      decodeFunction: uint256ToBigInt,
    };
  }

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

    const amountsForQuote = _isSrcTokenTransferFeeToBeExchanged
      ? applyTransferFee(
          chunkedAmounts,
          side,
          transferFees.srcDexFee,
          SRC_TOKEN_DEX_TRANSFERS,
        )
      : chunkedAmounts;

    const calldata = pools.flatMap(pool =>
      amountsForQuote.map(amount =>
        this.getMultiCallData(
          from.address,
          to.address,
          pool.deployer,
          amount,
          isSELL,
        ),
      ),
    );

    const results = await this.dexHelper.multiWrapper.tryAggregate(
      false,
      calldata,
    );

    const result = pools.map((pool, poolIndex) => {
      const offset = poolIndex * amountsForQuote.length;

      const _rates = chunkedAmounts.map((_, i) => {
        const res = results[offset + i];
        return res.success ? res.returnData : 0n;
      });

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
        poolIdentifiers: [
          this.getPoolIdentifier(pool.token0, pool.token1, pool.deployer),
        ],
        exchange: this.dexKey,
        gasCost: ALGEBRA_GAS_COST,
        poolAddresses: [pool.poolAddress],
      };
    });

    return result;
  }

  // Returns pool prices for amounts.
  // If limitPools is defined only pools in limitPools
  // should be used. If limitPools is undefined then
  // any pools can be used.
  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
    transferFees: TransferFeeParams = {
      srcFee: 0,
      destFee: 0,
      srcDexFee: 0,
      destDexFee: 0,
    },
  ): Promise<null | ExchangePrices<AlgebraIntegralData>> {
    try {
      const _isSrcTokenTransferFeeToBeExchanged =
        isSrcTokenTransferFeeToBeExchanged(transferFees);

      if (_isSrcTokenTransferFeeToBeExchanged && side == SwapSide.BUY) {
        return null;
      }

      const _srcToken = this.dexHelper.config.wrapETH(srcToken);
      const _destToken = this.dexHelper.config.wrapETH(destToken);

      const [_srcAddress, _destAddress] = this._getLoweredAddresses(
        _srcToken,
        _destToken,
      );

      if (_srcAddress === _destAddress) return null;

      let pools = this.factory.getAvailablePoolsForPair(
        _srcAddress,
        _destAddress,
      );

      if (limitPools && limitPools.length > 0) {
        const limitPoolsSet = new Set(limitPools);
        pools = pools.filter(pool => {
          const poolIdentifier = this.getPoolIdentifier(
            _srcAddress,
            _destAddress,
            pool.deployer,
          );
          return limitPoolsSet.has(poolIdentifier);
        });
      }

      const rpcPrice = await this.getPricingFromRpc(
        _srcToken,
        _destToken,
        amounts,
        side,
        pools,
        transferFees,
      );

      return rpcPrice;
    } catch (e) {
      this.logger.error(
        `Error_getPricesVolume ${srcToken.symbol || srcToken.address}, ${
          destToken.symbol || destToken.address
        }, ${side}:`,
        e,
      );
      return null;
    }
  }

  // Returns estimated gas cost of calldata for this DEX in multiSwap
  getCalldataGasCost(
    poolPrices: PoolPrices<AlgebraIntegralData>,
  ): number | number[] {
    return (
      CALLDATA_GAS_COST.FUNCTION_SELECTOR +
      // path offset
      CALLDATA_GAS_COST.OFFSET_SMALL +
      // receipient
      CALLDATA_GAS_COST.ADDRESS +
      // deadline
      CALLDATA_GAS_COST.TIMESTAMP +
      // amountIn
      CALLDATA_GAS_COST.AMOUNT +
      // amountOut
      CALLDATA_GAS_COST.AMOUNT +
      // path bytes (tokenIn, tokenOut, and deployer)
      60 * CALLDATA_GAS_COST.NONZERO_BYTE +
      // path padding
      4 * CALLDATA_GAS_COST.ZERO_BYTE
    );
  }

  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: AlgebraIntegralData,
    side: SwapSide,
  ): DexExchangeParam {
    let swapFunction;
    let swapFunctionParams;

    if (data.feeOnTransfer) {
      _require(
        data.path.length === 1,
        `LOGIC ERROR: multihop is not supported for feeOnTransfer token, passed: ${data.path
          .map(p => `${p?.tokenIn}->${p?.tokenOut}`)
          .join(' ')}`,
      );
      swapFunction = AlgebraIntegralFunctions.exactInputWithFeeToken;
      swapFunctionParams = {
        limitSqrtPrice: '0',
        recipient: recipient,
        deadline: getLocalDeadlineAsFriendlyPlaceholder(),
        amountIn: srcAmount,
        amountOutMinimum: destAmount,
        tokenIn: data.path[0].tokenIn,
        tokenOut: data.path[0].tokenOut,
        deployer: data.path[0].deployer,
      };
    } else {
      swapFunction =
        side === SwapSide.SELL
          ? AlgebraIntegralFunctions.exactInput
          : AlgebraIntegralFunctions.exactOutput;
      const path = this._encodePath(data.path, side);
      swapFunctionParams =
        side === SwapSide.SELL
          ? {
              recipient: recipient,
              deadline: getLocalDeadlineAsFriendlyPlaceholder(),
              amountIn: srcAmount,
              amountOutMinimum: destAmount,
              path,
            }
          : {
              recipient: recipient,
              deadline: getLocalDeadlineAsFriendlyPlaceholder(),
              amountOut: destAmount,
              amountInMaximum: srcAmount,
              path,
            };
    }

    const exchangeData = this.routerIface.encodeFunctionData(swapFunction, [
      swapFunctionParams,
    ]);

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: true,
      exchangeData,
      targetExchange: this.config.router,
      returnAmountPos:
        side === SwapSide.SELL
          ? extractReturnAmountPosition(
              this.routerIface,
              swapFunction,
              'amountOut',
            )
          : undefined,
    };
  }

  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: AlgebraIntegralData,
    side: SwapSide,
  ): AdapterExchangeParam {
    // Encode here the payload for adapter
    const payload = '';

    return {
      targetExchange: this.config.router,
      payload,
      networkFee: '0',
    };
  }

  // Returns list of top pools based on liquidity. Max
  // limit number pools should be returned.
  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    const _tokenAddress = tokenAddress.toLowerCase();

    const res = await this._querySubgraph(
      `query ($token: Bytes!, $count: Int) {
                pools0: pools(first: $count, orderBy: totalValueLockedUSD, orderDirection: desc, where: {token0: $token}) {
                id
                deployer
                token0 {
                  id
                  decimals
                }
                token1 {
                  id
                  decimals
                }
                totalValueLockedUSD
              }
              pools1: pools(first: $count, orderBy: totalValueLockedUSD, orderDirection: desc, where: {token1: $token}) {
                id
                deployer
                token0 {
                  id
                  decimals
                }
                token1 {
                  id
                  decimals
                }
                totalValueLockedUSD
              }
            }`,
      {
        token: _tokenAddress,
        count: limit,
      },
    );

    if (!(res && res.pools0 && res.pools1)) {
      this.logger.error(
        `Error_${this.dexKey}_Subgraph: couldn't fetch the pools from the subgraph`,
      );
      return [];
    }

    const pools0: PoolLiquidity[] = _.map(res.pools0, pool => ({
      exchange: this.dexKey,
      address: pool.id.toLowerCase(),
      connectorTokens: [
        {
          address: pool.token1.id.toLowerCase(),
          decimals: parseInt(pool.token1.decimals),
        },
      ],
      liquidityUSD:
        parseFloat(pool.totalValueLockedUSD) * ALGEBRA_EFFICIENCY_FACTOR,
    }));

    const pools1: PoolLiquidity[] = _.map(res.pools1, pool => ({
      exchange: this.dexKey,
      address: pool.id.toLowerCase(),
      connectorTokens: [
        {
          address: pool.token0.id.toLowerCase(),
          decimals: parseInt(pool.token0.decimals),
        },
      ],
      liquidityUSD:
        parseFloat(pool.totalValueLockedUSD) * ALGEBRA_EFFICIENCY_FACTOR,
    }));

    const allPools = pools0.concat(pools1);

    if (allPools.length === 0) return [];

    // Get on-chain balances
    const poolBalances = await this._getPoolBalances(
      allPools.map(p => [
        p.address,
        _tokenAddress,
        p.connectorTokens[0].address,
      ]),
    );

    // Build token amounts for USD conversion
    const tokensAmounts = allPools
      .map((p, i) => {
        return [
          [_tokenAddress, poolBalances[i][0]],
          [p.connectorTokens[0].address, poolBalances[i][1]],
        ] as [string, bigint | null][];
      })
      .flat();

    // Get USD values
    const poolUsdBalances = await this.dexHelper.getUsdTokenAmounts(
      tokensAmounts,
    );

    // Calculate liquidity per pool
    const pools = allPools.map((pool, i) => {
      const tokenUsdBalance = poolUsdBalances[i * 2];
      const connectorTokenUsdBalance = poolUsdBalances[i * 2 + 1];

      let tokenUsdLiquidity = null;
      if (tokenUsdBalance) {
        tokenUsdLiquidity = tokenUsdBalance * ALGEBRA_EFFICIENCY_FACTOR;
      }

      let connectorTokenUsdLiquidity = null;
      if (connectorTokenUsdBalance) {
        connectorTokenUsdLiquidity =
          connectorTokenUsdBalance * ALGEBRA_EFFICIENCY_FACTOR;
      }

      // Update connector token liquidity for directional swaps
      if (tokenUsdLiquidity) {
        pool.connectorTokens[0] = {
          ...pool.connectorTokens[0],
          liquidityUSD: tokenUsdLiquidity,
        };
      }

      // Use connector token liquidity as primary, fallback to token liquidity
      const liquidityUSD = connectorTokenUsdLiquidity || tokenUsdLiquidity || 0;

      return {
        ...pool,
        liquidityUSD,
      };
    });

    // Filter by minimum TVL and sort
    return pools
      .filter(
        pool =>
          (pool.liquidityUSD + (pool.connectorTokens[0]?.liquidityUSD ?? 0)) /
            ALGEBRA_EFFICIENCY_FACTOR >=
          MIN_USD_TVL_FOR_PRICING,
      )
      .sort((a, b) => b.liquidityUSD - a.liquidityUSD)
      .slice(0, limit);
  }

  private async _getPoolBalances(
    pools: [pool: string, token0: string, token1: string][],
  ): Promise<[balanceToken0: bigint | null, balanceToken1: bigint | null][]> {
    const callData = pools
      .map(pool => [
        {
          target: pool[1],
          callData: this.erc20Interface.encodeFunctionData('balanceOf', [
            pool[0],
          ]),
          decodeFunction: uint256ToBigInt,
        },
        {
          target: pool[2],
          callData: this.erc20Interface.encodeFunctionData('balanceOf', [
            pool[0],
          ]),
          decodeFunction: uint256ToBigInt,
        },
      ])
      .flat();

    const balanceOfCalls =
      await this.dexHelper.multiWrapper.tryAggregate<bigint>(false, callData);

    const balances: [bigint | null, bigint | null][] = [];
    for (let i = 0; i < balanceOfCalls.length; i += 2) {
      const balanceToken0 = balanceOfCalls[i];
      const balanceToken1 = balanceOfCalls[i + 1];
      balances.push([
        balanceToken0.success ? balanceToken0.returnData : null,
        balanceToken1.success ? balanceToken1.returnData : null,
      ]);
    }
    return balances;
  }

  private async _querySubgraph(
    query: string,
    variables: Object,
    timeout = 30000,
  ) {
    try {
      const res = await this.dexHelper.httpRequest.querySubgraph(
        this.config.subgraphURL,
        { query, variables },
        { timeout },
      );
      return res.data;
    } catch (e) {
      this.logger.error(`${this.dexKey}: can not query subgraph: `, e);
      return {};
    }
  }

  private _encodePath(
    path: {
      tokenIn: Address;
      tokenOut: Address;
      deployer: Address;
    }[],
    side: SwapSide,
  ): string {
    if (path.length === 0) {
      return '0x';
    }

    const { _path, types } = path.reduce(
      (
        { _path, types }: { _path: string[]; types: string[] },
        curr,
        index,
      ): { _path: string[]; types: string[] } => {
        if (index === 0) {
          return {
            types: ['address', 'address', 'address'],
            _path: [curr.tokenIn, curr.deployer, curr.tokenOut],
          };
        } else {
          return {
            types: [...types, 'address', 'address'],
            _path: [..._path, curr.deployer, curr.tokenOut],
          };
        }
      },
      { _path: [], types: [] },
    );

    return side === SwapSide.BUY
      ? pack(types.reverse(), _path.reverse())
      : pack(types, _path);
  }

  private _sortTokens(srcAddress: Address, destAddress: Address) {
    return [srcAddress, destAddress].sort((a, b) => (a < b ? -1 : 1));
  }

  private _getLoweredAddresses(srcToken: Token, destToken: Token) {
    return [srcToken.address.toLowerCase(), destToken.address.toLowerCase()];
  }

  releaseResources(): void {
    if (this.updatePoolsTvlTimer) {
      clearInterval(this.updatePoolsTvlTimer);
      this.updatePoolsTvlTimer = undefined;
      this.logger.info(`${this.dexKey}: cleared updatePoolsTvlTimer`);
    }
  }
}

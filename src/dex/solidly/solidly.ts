import { UniswapV2 } from '../uniswap-v2/uniswap-v2';
import {
  Network,
  NULL_ADDRESS,
  SUBGRAPH_TIMEOUT,
  DEST_TOKEN_PARASWAP_TRANSFERS,
  SRC_TOKEN_PARASWAP_TRANSFERS,
} from '../../constants';
import {
  AdapterExchangeParam,
  Address,
  DexExchangeParam,
  ExchangePrices,
  PoolLiquidity,
  SimpleExchangeParam,
  Token,
  TransferFeeParams,
} from '../../types';
import { IDexHelper } from '../../dex-helper';
import erc20ABI from '../../abi/erc20.json';
import { UniswapData, UniswapV2Data } from '../uniswap-v2/types';
import { getBigIntPow, getDexKeysWithNetwork } from '../../utils';
import solidlyFactoryABI from '../../abi/solidly/SolidlyFactory.json';
import solidlyPair from '../../abi/solidly/SolidlyPair.json';
import _ from 'lodash';
import { NumberAsString, SwapSide } from '@paraswap/core';
import { Interface, AbiCoder } from '@ethersproject/abi';
import { SolidlyStablePool } from './solidly-stable-pool';
import { Uniswapv2ConstantProductPool } from '../uniswap-v2/uniswap-v2-constant-product-pool';
import {
  PoolState,
  SolidlyData,
  SolidlyPair,
  SolidlyPool,
  SolidlyPoolOrderedParams,
} from './types';
import { SolidlyConfig, Adapters } from './config';
import { applyTransferFee } from '../../lib/token-transfer-fee';
import {
  hexDataLength,
  hexZeroPad,
  hexlify,
  id,
  solidityPack,
} from 'ethers/lib/utils';
import { BigNumber } from 'ethers';
import { Flag, SpecialDex } from '../../executor/types';

const erc20Iface = new Interface(erc20ABI);
const solidlyPairIface = new Interface(solidlyPair);
const defaultAbiCoder = new AbiCoder();

function encodePools(
  pools: SolidlyPool[],
  feeFactor: number,
): NumberAsString[] {
  return pools.map(({ fee, direction, address }) => {
    return (
      (BigInt(feeFactor - fee) << 161n) +
      ((direction ? 0n : 1n) << 160n) +
      BigInt(address)
    ).toString();
  });
}

export class Solidly extends UniswapV2 {
  pairs: { [key: string]: SolidlyPair } = {};
  stableFee?: number;
  volatileFee?: number;

  readonly isFeeOnTransferSupported: boolean = true;
  readonly SRC_TOKEN_DEX_TRANSFERS = 1;
  readonly DEST_TOKEN_DEX_TRANSFERS = 1;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(
      _.omit(SolidlyConfig, [
        'Velodrome',
        'VelodromeV2',
        'Aerodrome',
        'SpiritSwapV2',
        'SolidlyV2',
        'Thena',
        'Chronos',
        'Ramses',
        'Equalizer',
        'Velocimeter',
        'Usdfi',
        'PharaohV1',
      ]),
    );

  constructor(
    protected network: Network,
    dexKey: string,
    protected dexHelper: IDexHelper,
    isDynamicFees = false,
    factoryAddress?: Address,
    subgraphURL?: string,
    initCode?: string,
    feeCode?: number,
    poolGasCost?: number,
    routerAddress?: Address,
  ) {
    super(
      network,
      dexKey,
      dexHelper,
      isDynamicFees,
      factoryAddress !== undefined
        ? factoryAddress
        : SolidlyConfig[dexKey][network].factoryAddress,
      subgraphURL === ''
        ? undefined
        : subgraphURL !== undefined
        ? subgraphURL
        : SolidlyConfig[dexKey][network].subgraphURL,
      initCode !== undefined
        ? initCode
        : SolidlyConfig[dexKey][network].initCode,
      feeCode !== undefined ? feeCode : SolidlyConfig[dexKey][network].feeCode,
      poolGasCost !== undefined
        ? poolGasCost
        : SolidlyConfig[dexKey][network].poolGasCost,
      solidlyPairIface,
      Adapters[network] || undefined,
    );

    this.stableFee = SolidlyConfig[dexKey][network].stableFee;
    this.volatileFee = SolidlyConfig[dexKey][network].volatileFee;

    this.factory = new dexHelper.web3Provider.eth.Contract(
      solidlyFactoryABI as any,
      factoryAddress !== undefined
        ? factoryAddress
        : SolidlyConfig[dexKey][network].factoryAddress,
    );

    this.router =
      routerAddress !== undefined
        ? routerAddress
        : SolidlyConfig[dexKey][network].router || '';

    this.feeFactor = SolidlyConfig[dexKey][network].feeFactor || this.feeFactor;
  }

  async findSolidlyPair(from: Token, to: Token, stable: boolean) {
    if (from.address.toLowerCase() === to.address.toLowerCase()) return null;
    const [token0, token1] =
      from.address.toLowerCase() < to.address.toLowerCase()
        ? [from, to]
        : [to, from];

    const typePostfix = this.poolPostfix(stable);
    const key = `${token0.address.toLowerCase()}-${token1.address.toLowerCase()}-${typePostfix}`;
    let pair = this.pairs[key];
    if (pair) return pair;

    let exchange = await this.factory.methods
      // Solidly has additional boolean parameter "StablePool"
      // At first we look for uniswap-like volatile pool
      .getPair(token0.address, token1.address, stable)
      .call();

    if (exchange === NULL_ADDRESS) {
      pair = { token0, token1, stable };
    } else {
      pair = { token0, token1, exchange, stable };
    }
    this.pairs[key] = pair;
    return pair;
  }

  async batchCatchUpPairs(pairs: [Token, Token][], blockNumber: number) {
    if (!blockNumber) return;
    const pairsToFetch: SolidlyPair[] = [];
    for (const _pair of pairs) {
      for (const stable of [false, true]) {
        const pair = await this.findSolidlyPair(_pair[0], _pair[1], stable);
        if (!(pair && pair.exchange)) continue;
        if (!pair.pool) {
          pairsToFetch.push(pair);
        } else if (!pair.pool.getState(blockNumber)) {
          pairsToFetch.push(pair);
        }
      }
    }

    if (!pairsToFetch.length) return;

    const reserves = await this.getManyPoolReserves(pairsToFetch, blockNumber);

    if (reserves.length !== pairsToFetch.length) {
      this.logger.error(
        `Error_getManyPoolReserves didn't get any pool reserves`,
      );
    }

    for (let i = 0; i < pairsToFetch.length; i++) {
      const pairState = reserves[i];
      const pair = pairsToFetch[i];
      if (!pair.pool) {
        await this.addPool(
          pair,
          pairState.reserves0,
          pairState.reserves1,
          pairState.feeCode,
          blockNumber,
        );
      } else pair.pool.setState(pairState, blockNumber);
    }
  }

  async getManyPoolReserves(
    pairs: SolidlyPair[],
    blockNumber: number,
  ): Promise<PoolState[]> {
    try {
      const multiCallFeeData = pairs.map(pair =>
        this.getFeesMultiCallData(pair),
      );
      const calldata = pairs
        .map((pair, i) => {
          let calldata = [
            {
              target: pair.token0.address,
              callData: erc20Iface.encodeFunctionData('balanceOf', [
                pair.exchange!,
              ]),
            },
            {
              target: pair.token1.address,
              callData: erc20Iface.encodeFunctionData('balanceOf', [
                pair.exchange!,
              ]),
            },
          ];
          if (this.isDynamicFees) calldata.push(multiCallFeeData[i]!.callEntry);
          return calldata;
        })
        .flat();

      const data: { returnData: any[] } =
        await this.dexHelper.multiContract.methods
          .aggregate(calldata)
          .call({}, blockNumber);

      const returnData = _.chunk(data.returnData, this.isDynamicFees ? 3 : 2);

      return pairs.map((pair, i) => ({
        reserves0: defaultAbiCoder
          .decode(['uint256'], returnData[i][0])[0]
          .toString(),
        reserves1: defaultAbiCoder
          .decode(['uint256'], returnData[i][1])[0]
          .toString(),
        feeCode: this.isDynamicFees
          ? multiCallFeeData[i]!.callDecoder(returnData[i][2])
          : (pair.stable ? this.stableFee : this.volatileFee) || this.feeCode,
      }));
    } catch (e) {
      this.logger.error(
        `Error_getManyPoolReserves could not get reserves with error:`,
        e,
      );
      return [];
    }
  }

  async getSellPrice(
    priceParams: SolidlyPoolOrderedParams,
    srcAmount: bigint,
  ): Promise<bigint> {
    return priceParams.stable
      ? SolidlyStablePool.getSellPrice(priceParams, srcAmount, this.feeFactor)
      : Uniswapv2ConstantProductPool.getSellPrice(
          priceParams,
          srcAmount,
          this.feeFactor,
        );
  }

  async getBuyPrice(
    priceParams: SolidlyPoolOrderedParams,
    srcAmount: bigint,
  ): Promise<bigint> {
    if (priceParams.stable) throw new Error(`Buy not supported`);
    return Uniswapv2ConstantProductPool.getBuyPrice(
      priceParams,
      srcAmount,
      this.feeFactor,
    );
  }

  async getPricesVolume(
    _from: Token,
    _to: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    // list of pool identifiers to use for pricing, if undefined use all pools
    limitPools?: string[],
    transferFees: TransferFeeParams = {
      srcFee: 0,
      destFee: 0,
      srcDexFee: 0,
      destDexFee: 0,
    },
  ): Promise<ExchangePrices<UniswapV2Data> | null> {
    try {
      if (side === SwapSide.BUY) return null; // Buy side not implemented yet
      const from = this.dexHelper.config.wrapETH(_from);
      const to = this.dexHelper.config.wrapETH(_to);

      if (from.address.toLowerCase() === to.address.toLowerCase()) {
        return null;
      }

      const tokenAddress = [
        from.address.toLowerCase(),
        to.address.toLowerCase(),
      ]
        .sort((a, b) => (a > b ? 1 : -1))
        .join('_');

      await this.batchCatchUpPairs([[from, to]], blockNumber);

      const resultPromises = [false, true].map(async stable => {
        // We don't support fee on transfer for stable pools yet
        if (
          stable &&
          (transferFees.srcFee !== 0 || transferFees.srcDexFee !== 0)
        ) {
          return null;
        }

        const poolIdentifier =
          `${this.dexKey}_${tokenAddress}` + this.poolPostfix(stable);

        if (limitPools && limitPools.every(p => p !== poolIdentifier))
          return null;

        const isSell = side === SwapSide.SELL;
        const pairParam = await this.getSolidlyPairOrderedParams(
          from,
          to,
          blockNumber,
          stable,
          transferFees.srcDexFee,
        );

        if (!pairParam) return null;

        const unitAmount = getBigIntPow(
          // @ts-expect-error Buy side is not implemented yet
          side === SwapSide.BUY ? to.decimals : from.decimals,
        );

        const [unitVolumeWithFee, ...amountsWithFee] = applyTransferFee(
          [unitAmount, ...amounts],
          side,
          isSell ? transferFees.srcFee : transferFees.destFee,
          isSell ? SRC_TOKEN_PARASWAP_TRANSFERS : DEST_TOKEN_PARASWAP_TRANSFERS,
        );

        const unit =
          // @ts-expect-error Buy side is not implemented yet
          side === SwapSide.BUY
            ? await this.getBuyPricePath(unitVolumeWithFee, [pairParam])
            : await this.getSellPricePath(unitVolumeWithFee, [pairParam]);

        const prices =
          // @ts-expect-error Buy side is not implemented yet
          side === SwapSide.BUY
            ? await Promise.all(
                amountsWithFee.map(amount =>
                  amount === 0n
                    ? 0n
                    : this.getBuyPricePath(amount, [pairParam]),
                ),
              )
            : await Promise.all(
                amountsWithFee.map(amount =>
                  amount === 0n
                    ? 0n
                    : this.getSellPricePath(amount, [pairParam]),
                ),
              );

        const [unitOutWithFee, ...outputsWithFee] = applyTransferFee(
          [unit, ...prices],
          side,
          // This part is confusing, because we treat differently SELL and BUY fees
          // If Buy, we should apply transfer fee on srcToken on top of dexFee applied earlier
          // But for Sell we should apply only one dexFee
          isSell ? transferFees.destDexFee : transferFees.srcFee,
          isSell ? this.DEST_TOKEN_DEX_TRANSFERS : SRC_TOKEN_PARASWAP_TRANSFERS,
        );

        return {
          prices: outputsWithFee,
          unit: unitOutWithFee,
          data: {
            router: this.router,
            path: [from.address.toLowerCase(), to.address.toLowerCase()],
            factory: this.factoryAddress,
            initCode: this.initCode,
            feeFactor: this.feeFactor,
            isFeeTokenInRoute: Object.values(transferFees).some(f => f !== 0),
            pools: [
              {
                stable: pairParam.stable,
                address: pairParam.exchange,
                fee: parseInt(pairParam.fee),
                direction: pairParam.direction,
              },
            ],
          },
          exchange: this.dexKey,
          poolIdentifiers: [poolIdentifier],
          gasCost: this.poolGasCost,
          poolAddresses: [pairParam.exchange],
        };
      });

      const resultPools = (await Promise.all(
        resultPromises,
      )) as ExchangePrices<UniswapV2Data>;
      const resultPoolsFiltered = resultPools.filter(item => !!item); // filter null elements
      return resultPoolsFiltered.length > 0 ? resultPoolsFiltered : null;
    } catch (e) {
      if (blockNumber === 0)
        this.logger.error(
          `Error_getPricesVolume: Aurelius block manager not yet instantiated`,
        );
      this.logger.error(`Error_getPrices:`, e);
      return null;
    }
  }

  async getTopPoolsForToken(
    tokenAddress: Address,
    count: number,
  ): Promise<PoolLiquidity[]> {
    if (!this.subgraphURL) return [];

    let stableFieldKey = '';
    let skipReserveCheck = false;

    if (this.dexKey.toLowerCase() === 'solidly') {
      stableFieldKey = 'stable';
    } else if (this.dexKey.toLowerCase() !== 'solidlyv2') {
      stableFieldKey = 'isStable';
    }

    // aerodrome subgraph has broken reserve and other volume fields with all 0s
    if (this.dexKey.toLowerCase() === 'aerodrome') {
      skipReserveCheck = true;
    }

    const query = `query ($token: Bytes!, $count: Int) {
      pools0: pairs(first: $count, orderBy: reserveUSD, orderDirection: desc, where: {token0: $token ${
        skipReserveCheck ? '' : ', reserve0_gt: 0.1, reserve1_gt: 0.1'
      }}) {
        id
        ${stableFieldKey}
        token0 {
          id
          decimals
        }
        token1 {
          id
          decimals
        }
        reserveUSD
      }
      pools1: pairs(first: $count, orderBy: reserveUSD, orderDirection: desc, where: {token1: $token ${
        skipReserveCheck ? '' : ', reserve0_gt: 0.1, reserve1_gt: 0.1'
      }}) {
        id
        ${stableFieldKey}
        token0 {
          id
          decimals
        }
        token1 {
          id
          decimals
        }
        reserveUSD
      }
    }`;

    const { data } = await this.dexHelper.httpRequest.querySubgraph(
      this.subgraphURL,
      {
        query,
        variables: { token: tokenAddress.toLowerCase(), count },
      },
      { timeout: SUBGRAPH_TIMEOUT },
    );

    if (!(data && data.pools0 && data.pools1))
      throw new Error("Couldn't fetch the pools from the subgraph");
    const pools0 = _.map(data.pools0, pool => ({
      exchange: this.dexKey,
      stable: pool[stableFieldKey],
      address: pool.id.toLowerCase(),
      connectorTokens: [
        {
          address: pool.token1.id.toLowerCase(),
          decimals: parseInt(pool.token1.decimals),
        },
      ],
      liquidityUSD: parseFloat(pool.reserveUSD),
    }));

    const pools1 = _.map(data.pools1, pool => ({
      exchange: this.dexKey,
      stable: pool[stableFieldKey],
      address: pool.id.toLowerCase(),
      connectorTokens: [
        {
          address: pool.token0.id.toLowerCase(),
          decimals: parseInt(pool.token0.decimals),
        },
      ],
      liquidityUSD: parseFloat(pool.reserveUSD),
    }));

    return _.slice(
      _.sortBy(_.concat(pools0, pools1), [pool => -1 * pool.liquidityUSD]),
      0,
      count,
    );
  }

  // Same as at uniswap-v2-pool.json, but extended with decimals and stable
  async getSolidlyPairOrderedParams(
    from: Token,
    to: Token,
    blockNumber: number,
    stable: boolean,
    tokenDexTransferFee: number,
  ): Promise<SolidlyPoolOrderedParams | null> {
    const pair = await this.findSolidlyPair(from, to, stable);
    if (!(pair && pair.pool && pair.exchange)) return null;
    const pairState = pair.pool.getState(blockNumber);

    if (!pairState) {
      this.logger.error(
        `Error_orderPairParams expected reserves, got none (maybe the pool doesn't exist) ${
          from.symbol || from.address
        } ${to.symbol || to.address}`,
      );
      return null;
    }

    const fee = (pairState.feeCode + tokenDexTransferFee).toString();
    const pairReversed =
      pair.token1.address.toLowerCase() === from.address.toLowerCase();
    if (pairReversed) {
      return {
        tokenIn: from.address,
        tokenOut: to.address,
        reservesIn: pairState.reserves1,
        reservesOut: pairState.reserves0,
        fee,
        direction: false,
        exchange: pair.exchange,
        decimalsIn: from.decimals,
        decimalsOut: to.decimals,
        stable,
      };
    }
    return {
      tokenIn: from.address,
      tokenOut: to.address,
      reservesIn: pairState.reserves0,
      reservesOut: pairState.reserves1,
      fee,
      direction: true,
      exchange: pair.exchange,
      decimalsIn: from.decimals,
      decimalsOut: to.decimals,
      stable,
    };
  }

  async getPoolIdentifiers(
    _from: Token,
    _to: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    if (side === SwapSide.BUY) return [];

    const from = this.dexHelper.config.wrapETH(_from);
    const to = this.dexHelper.config.wrapETH(_to);

    if (from.address.toLowerCase() === to.address.toLowerCase()) {
      return [];
    }

    const tokenAddress = [from.address.toLowerCase(), to.address.toLowerCase()]
      .sort((a, b) => (a > b ? 1 : -1))
      .join('_');

    const poolIdentifier = `${this.dexKey}_${tokenAddress}`;
    const poolIdentifierUniswap = poolIdentifier + this.poolPostfix(false);
    const poolIdentifierStable = poolIdentifier + this.poolPostfix(true);
    return [poolIdentifierUniswap, poolIdentifierStable];
  }

  poolPostfix(stable: boolean) {
    return stable ? 'S' : 'U';
  }

  async getSimpleParam(
    src: Address,
    dest: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    data: UniswapData,
    side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    if (side === SwapSide.BUY) throw new Error(`Buy not supported`);
    return super.getSimpleParam(src, dest, srcAmount, destAmount, data, side);
  }

  getAdapterParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    toAmount: NumberAsString, // required for buy case
    data: SolidlyData,
    side: SwapSide,
  ): AdapterExchangeParam {
    if (side === SwapSide.BUY) throw new Error(`Buy not supported`);
    const pools = encodePools(data.pools, this.feeFactor);
    const weth = this.getWETHAddress(srcToken, destToken, data.wethAddress);
    const payload = this.abiCoder.encodeParameter(
      {
        ParentStruct: {
          weth: 'address',
          pools: 'uint256[]',
          isFeeTokenInRoute: 'bool',
        },
      },
      { weth, pools, isFeeTokenInRoute: data.isFeeTokenInRoute },
    );
    return {
      targetExchange: data.router,
      payload,
      networkFee: '0',
    };
  }

  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: SolidlyData,
    side: SwapSide,
  ): DexExchangeParam {
    if (side === SwapSide.BUY) throw new Error(`Buy not supported`);
    let exchangeDataTypes = ['bytes4', 'bytes32'];

    const isStable = data.pools.some(pool => !!pool.stable);
    const isStablePoolAndPoolCount = isStable
      ? BigNumber.from(1)
          .shl(255)
          .or(BigNumber.from(data.pools.length))
          .toHexString()
      : hexZeroPad(hexlify(data.pools.length), 32);

    let exchangeDataToPack = [
      hexZeroPad(hexlify(0), 4),
      isStablePoolAndPoolCount,
    ];

    const pools = encodePools(data.pools, this.feeFactor);
    pools.forEach(pool => {
      exchangeDataTypes.push('bytes32');
      exchangeDataToPack.push(hexZeroPad(hexlify(BigNumber.from(pool)), 32));
    });

    const exchangeData = solidityPack(exchangeDataTypes, exchangeDataToPack);

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: true,
      exchangeData,
      targetExchange: recipient,
      specialDexFlag: data.isFeeTokenInRoute
        ? SpecialDex.SWAP_ON_DYSTOPIA_UNISWAP_V2_FORK_WITH_FEE
        : SpecialDex.SWAP_ON_DYSTOPIA_UNISWAP_V2_FORK,
      transferSrcTokenBeforeSwap: data.isFeeTokenInRoute
        ? undefined
        : data.pools[0].address,
      returnAmountPos: undefined,
    };
  }
}

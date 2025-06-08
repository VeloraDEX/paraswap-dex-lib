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
  Token,
  TransferFeeParams,
} from '../../types';
import { IDexHelper } from '../../dex-helper';
import erc20ABI from '../../abi/erc20.json';
import { getBigIntPow, getDexKeysWithNetwork, isETHAddress } from '../../utils';
import infusionFactoryABI from '../../abi/infusion/InfusionFactory.json';
import infusionPairABI from '../../abi/infusion/InfusionPair.json';
import infusionRouterABI from '../../abi/infusion/InfusionRouter.json';
import _ from 'lodash';
import { NumberAsString, SwapSide } from '@paraswap/core';
import { Interface, AbiCoder, BytesLike } from 'ethers';
import { InfusionStablePool } from './infusion-stable-pool';
import { Uniswapv2ConstantProductPool } from '../uniswap-v2/uniswap-v2-constant-product-pool';
import {
  PoolState,
  InfusionData,
  InfusionPair,
  InfusionPoolOrderedParams,
  InfusionParam,
} from './types';
import { InfusionConfig } from './config';
import { applyTransferFee } from '../../lib/token-transfer-fee';
import { isStablePair } from './utils/isStablePair';

export enum InfusionRouterFunctions {
  sellExactEth = 'swapExactETHForTokens',
  sellExactToken = 'swapExactTokensForETH',
  swapExactIn = 'swapExactTokensForTokens',
}

const VelodromeFactoryABI = [
  {
    inputs: [{ internalType: 'bool', name: '_stable', type: 'bool' }],
    name: 'getFee',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
];

const velodromeFactoryIface = new Interface(VelodromeFactoryABI);
const erc20Iface = new Interface(erc20ABI);
const infusionPairIface = new Interface(infusionPairABI);
const defaultAbiCoder = new AbiCoder();

export class Infusion extends UniswapV2 {
  pairs: { [key: string]: InfusionPair } = {};
  stableFee?: number;
  volatileFee?: number;

  readonly isFeeOnTransferSupported: boolean = true;
  readonly SRC_TOKEN_DEX_TRANSFERS = 1;
  readonly DEST_TOKEN_DEX_TRANSFERS = 1;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(_.pick(InfusionConfig, ['Infusion']));

  constructor(
    protected network: Network,
    dexKey: string,
    protected dexHelper: IDexHelper,
    isDynamicFees = true,
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
        : InfusionConfig[dexKey][network].factoryAddress,
      subgraphURL === ''
        ? undefined
        : subgraphURL !== undefined
        ? subgraphURL
        : InfusionConfig[dexKey][network].subgraphURL,
      initCode !== undefined
        ? initCode
        : InfusionConfig[dexKey][network].initCode,
      feeCode !== undefined ? feeCode : InfusionConfig[dexKey][network].feeCode,
      poolGasCost !== undefined
        ? poolGasCost
        : InfusionConfig[dexKey][network].poolGasCost,
      infusionPairIface,
    );

    this.stableFee = InfusionConfig[dexKey][network].stableFee;
    this.volatileFee = InfusionConfig[dexKey][network].volatileFee;

    this.factory = new dexHelper.web3Provider.eth.Contract(
      infusionFactoryABI as any,
      factoryAddress !== undefined
        ? factoryAddress
        : InfusionConfig[dexKey][network].factoryAddress,
    );

    this.router =
      routerAddress !== undefined
        ? routerAddress
        : InfusionConfig[dexKey][network].router || '';

    this.feeFactor =
      InfusionConfig[dexKey][network].feeFactor || this.feeFactor;
  }

  async findInfusionPair(from: Token, to: Token, stable: boolean) {
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
      // Infusion has additional boolean parameter "StablePool"
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
    const pairsToFetch: InfusionPair[] = [];
    for (const _pair of pairs) {
      const pairs = await Promise.all([
        this.findInfusionPair(_pair[0], _pair[1], true),
        this.findInfusionPair(_pair[0], _pair[1], false),
      ]);
      for (const pair of pairs) {
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
    pairs: InfusionPair[],
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
    priceParams: InfusionPoolOrderedParams,
    srcAmount: bigint,
  ): Promise<bigint> {
    return priceParams.stable
      ? InfusionStablePool.getSellPrice(priceParams, srcAmount, this.feeFactor)
      : Uniswapv2ConstantProductPool.getSellPrice(
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
  ): Promise<ExchangePrices<InfusionData> | null> {
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
        const pairParam = await this.getInfusionPairOrderedParams(
          from,
          to,
          blockNumber,
          stable,
          transferFees.srcDexFee,
        );

        if (!pairParam) return null;

        const unitAmount = getBigIntPow(from.decimals);

        const [unitVolumeWithFee, ...amountsWithFee] = applyTransferFee(
          [unitAmount, ...amounts],
          side,
          isSell ? transferFees.srcFee : transferFees.destFee,
          isSell ? SRC_TOKEN_PARASWAP_TRANSFERS : DEST_TOKEN_PARASWAP_TRANSFERS,
        );

        const unit = await this.getSellPricePath(unitVolumeWithFee, [
          pairParam,
        ]);

        const prices = await Promise.all(
          amountsWithFee.map(amount =>
            amount === 0n ? 0n : this.getSellPricePath(amount, [pairParam]),
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
                address: pairParam.exchange,
                fee: parseInt(pairParam.fee),
                direction: pairParam.direction,
              },
            ],
          },
          exchange: this.dexKey,
          poolIdentifier,
          gasCost: this.poolGasCost,
          poolAddresses: [pairParam.exchange],
        };
      });

      const resultPools = (await Promise.all(
        resultPromises,
      )) as ExchangePrices<InfusionData>;
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

    let stableFieldKey = 'isStable';

    const query = `query ($token: Bytes!, $count: Int) {
      pools0: pairs(first: $count, orderBy: reserveUSD, orderDirection: desc, where: {token0: $token, reserve0_gt: 1, reserve1_gt: 1}) {
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
      pools1: pairs(first: $count, orderBy: reserveUSD, orderDirection: desc, where: {token1: $token, reserve0_gt: 1, reserve1_gt: 1}) {
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

    const { data } = await this.dexHelper.httpRequest.post(
      this.subgraphURL,
      {
        query,
        variables: { token: tokenAddress.toLowerCase(), count },
      },
      SUBGRAPH_TIMEOUT,
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
  async getInfusionPairOrderedParams(
    from: Token,
    to: Token,
    blockNumber: number,
    stable: boolean,
    tokenDexTransferFee: number,
  ): Promise<InfusionPoolOrderedParams | null> {
    const pair = await this.findInfusionPair(from, to, stable);
    if (!(pair && pair.pool && pair.exchange)) return null;
    const pairState = pair?.pool.getState(blockNumber);

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
    return stable ? 'S' : 'V';
  }

  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return null;
  }

  getAdapterParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    toAmount: NumberAsString, // required for buy case
    data: InfusionData,
    side: SwapSide,
  ): AdapterExchangeParam {
    return {
      targetExchange: data.router,
      payload: '',
      networkFee: '0',
    };
  }

  getDexParam(
    src: Address,
    dest: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: InfusionData,
    side: SwapSide,
  ): DexExchangeParam {
    if (side === SwapSide.BUY) throw new Error(`Buy not supported`);

    let routerMethod: any;
    let routerArgs: InfusionParam;
    const stable = isStablePair(this.network, src, dest);

    const from = isETHAddress(src)
      ? this.dexHelper.config.data.wrappedNativeTokenAddress
      : src;
    const to = isETHAddress(dest)
      ? this.dexHelper.config.data.wrappedNativeTokenAddress
      : dest;

    routerMethod = isETHAddress(src)
      ? InfusionRouterFunctions.sellExactEth
      : InfusionRouterFunctions.swapExactIn;
    routerMethod = isETHAddress(dest)
      ? InfusionRouterFunctions.sellExactToken
      : routerMethod;

    routerArgs = isETHAddress(src)
      ? [
          destAmount,
          [{ from, to, stable }],
          recipient,
          Math.floor(new Date().getTime() / 1000) + 120,
        ]
      : [
          srcAmount,
          destAmount,
          [{ from, to, stable }],
          recipient,
          Math.floor(new Date().getTime() / 1000) + 120,
        ];

    const exchangeData = new Interface(infusionRouterABI).encodeFunctionData(
      routerMethod,
      routerArgs as InfusionParam,
    );

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: true,
      exchangeData,
      targetExchange: data.router,
      returnAmountPos: undefined,
    };
  }

  protected getFeesMultiCallData(pair: InfusionPair) {
    const callEntry = {
      target: this.factoryAddress,
      callData: velodromeFactoryIface.encodeFunctionData('getFee', [
        pair.stable,
      ]),
    };
    const callDecoder = (values: BytesLike) =>
      parseInt(
        velodromeFactoryIface
          .decodeFunctionResult('getFee', values)[0]
          .toString(),
      );

    return {
      callEntry,
      callDecoder,
    };
  }
}

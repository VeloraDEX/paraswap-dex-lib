import {
  DEST_TOKEN_PARASWAP_TRANSFERS,
  Network,
  NULL_ADDRESS,
  SRC_TOKEN_PARASWAP_TRANSFERS,
  SUBGRAPH_TIMEOUT,
} from '../../constants';
import {
  AdapterExchangeParam,
  Address,
  DexExchangeParam,
  ExchangePrices,
  Log,
  Logger,
  PoolLiquidity,
  PoolPrices,
  SimpleExchangeParam,
  Token,
  TransferFeeParams,
} from '../../types';
import { IDexHelper } from '../../dex-helper';
import {
  UniswapParam,
  UniswapV2Functions,
  UniswapV2Data,
  UniswapPool,
} from '../uniswap-v2/types';
import { getBigIntPow, getDexKeysWithNetwork, isETHAddress } from '../../utils';
import camelotFactoryABI from '../../abi/camelot/CamelotFactory.json';
import camelotPairABI from '../../abi/camelot/CamelotPair.json';
import _ from 'lodash';
import { AsyncOrSync, DeepReadonly } from 'ts-essentials';
import { NumberAsString, SwapSide } from '@paraswap/core';
import { SolidlyStablePool } from '../solidly/solidly-stable-pool';
import { Uniswapv2ConstantProductPool } from '../uniswap-v2/uniswap-v2-constant-product-pool';
import { CamelotPoolState, CamelotPoolOrderedParams } from './types';
import { CamelotConfig, Adapters } from './config';
import { Contract } from 'web3-eth-contract';
import { IDex } from '../idex';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import ParaSwapABI from '../../abi/IParaswap.json';
import UniswapV2ExchangeRouterABI from '../../abi/UniswapV2ExchangeRouter.json';
import { SimpleExchange } from '../simple-exchange';
import { applyTransferFee } from '../../lib/token-transfer-fee';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { SolidlyData } from '../solidly/types';
import {
  OnPoolCreatedCallback,
  UniswapV2Factory,
} from '../uniswap-v2/uniswap-v2-factory';
import {
  toBeHex,
  Interface,
  AbiCoder,
  solidityPacked,
  zeroPadValue,
} from 'ethers';
import { SpecialDex } from '../../executor/types';

const DefaultCamelotPoolGasCost = 90 * 1000;

const camelotPairIface = new Interface(camelotPairABI);

const LogCallTopics = [
  '0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1', // event Sync(uint112 reserve0, uint112 reserve1) // uni-V2 and most forks
  'a4877b8ecb5a00ba277e4bceeeb187a669e7113649774dfbea05c259ce27f17b', // event FeePercentUpdated(uint16 token0FeePercent, uint16 token1FeePercent)
  'b6a86710bde53aa7fb1b3856279e2af5b476d53e2dd0902cf17a0911b5a43a8b', // event SetStableSwap(bool prevStableSwap, bool stableSwap)
];

function encodePools(
  pools: UniswapPool[],
  feeFactor: number,
): NumberAsString[] {
  return pools.map(({ fee, direction, address }) => {
    return (
      (BigInt(Math.ceil((feeFactor - fee) / 10)) << 161n) +
      ((direction ? 0n : 1n) << 160n) +
      BigInt(address)
    ).toString();
  });
}

export interface CamelotPair {
  token0: Token;
  token1: Token;
  exchange?: Address;
  pool?: CamelotEventPool;
}

export class CamelotEventPool extends StatefulEventSubscriber<CamelotPoolState> {
  decoder = (log: Log) => this.iface.parseLog(log);

  constructor(
    parentName: string,
    protected dexHelper: IDexHelper,
    private poolAddress: Address,
    private token0: Token,
    private token1: Token,
    logger: Logger,
    private iface: Interface = camelotPairIface,
    private callEntries: any[],
    private callDecoder: (data: any[]) => {
      reserve0: string;
      reserve1: string;
      token0FeeCode: number;
      token1FeeCode: number;
      stable: boolean;
    },
  ) {
    super(
      parentName,
      (token0.symbol || token0.address) +
        '-' +
        (token1.symbol || token1.address) +
        ' pool',
      dexHelper,
      logger,
    );
  }

  protected processLog(
    state: DeepReadonly<CamelotPoolState>,
    log: Readonly<Log>,
  ): AsyncOrSync<DeepReadonly<CamelotPoolState> | null> {
    if (!LogCallTopics.includes(log.topics[0])) return null;

    const event = this.decoder(log);

    if (!event) return null;

    switch (event.name) {
      case 'SetStableSwap':
        return {
          reserve0: state.reserve0,
          reserve1: state.reserve1,
          token0FeeCode: state.token0FeeCode,
          token1FeeCode: state.token1FeeCode,
          stable: event.args.stableSwap,
        };
      case 'FeePercentUpdated':
        return {
          reserve0: state.reserve0,
          reserve1: state.reserve1,
          token0FeeCode: parseInt(event.args.token0FeePercent.toString()),
          token1FeeCode: parseInt(event.args.token1FeePercent.toString()),
          stable: state.stable,
        };
      case 'Sync':
        return {
          reserve0: event.args.reserve0.toString(),
          reserve1: event.args.reserve1.toString(),
          token0FeeCode: state.token0FeeCode,
          token1FeeCode: state.token1FeeCode,
          stable: state.stable,
        };
    }
    return null;
  }

  async generateState(
    blockNumber: number | 'latest' = 'latest',
  ): Promise<DeepReadonly<CamelotPoolState>> {
    const data: { returnData: any[] } =
      await this.dexHelper.multiContract.methods
        .aggregate(this.callEntries)
        .call({}, blockNumber);

    return this.callDecoder(data.returnData);
  }
}

export class Camelot
  extends SimpleExchange
  implements IDex<SolidlyData, UniswapParam>
{
  pairs: { [key: string]: CamelotPair } = {};
  feeFactor = 100000;
  factory: Contract;

  needWrapNative = true;
  routerInterface: Interface;
  exchangeRouterInterface: Interface;

  readonly hasConstantPriceLargeAmounts: boolean = false;
  readonly isFeeOnTransferSupported: boolean = true;
  readonly DEST_TOKEN_DEX_TRANSFERS = 1;
  logger: Logger;

  private readonly factoryInst: UniswapV2Factory;

  private newlyCreatedPoolKeys: Set<string> = new Set();

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(CamelotConfig);

  constructor(
    protected network: Network,
    dexKey: string,
    protected dexHelper: IDexHelper,
    protected factoryAddress: Address = CamelotConfig[dexKey][network]
      .factoryAddress,
    protected subgraphURL: string | undefined = CamelotConfig[dexKey] &&
      CamelotConfig[dexKey][network].subgraphURL,
    protected initCode: string = CamelotConfig[dexKey][network].initCode,
    protected poolGasCost: number = (CamelotConfig[dexKey] &&
      CamelotConfig[dexKey][network].poolGasCost) ??
      DefaultCamelotPoolGasCost,
    protected decoderIface: Interface = camelotPairIface,
    protected adapters = (CamelotConfig[dexKey] &&
      CamelotConfig[dexKey][network].adapters) ??
      Adapters[network],
    protected routerAddress = (CamelotConfig[dexKey] &&
      CamelotConfig[dexKey][network].router) ??
      dexHelper.config.data.uniswapV2ExchangeRouterAddress,
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey);

    this.factory = new dexHelper.web3Provider.eth.Contract(
      camelotFactoryABI as any,
      factoryAddress,
    );
    this.routerAddress = routerAddress;

    this.routerInterface = new Interface(ParaSwapABI);
    this.exchangeRouterInterface = new Interface(UniswapV2ExchangeRouterABI);

    this.factoryInst = new UniswapV2Factory(
      dexHelper,
      dexKey,
      factoryAddress,
      this.logger,
      this.onPoolCreatedDeleteFromNonExistingSet,
    );
  }

  async initializePricing(blockNumber: number) {
    // Init listening to new pools creation
    await this.factoryInst.initialize(blockNumber);
  }

  private getPoolIdentifier(token0: string, token1: string) {
    const [_token0, _token1] =
      token0.toLowerCase() < token1.toLowerCase()
        ? [token0, token1]
        : [token1, token0];

    const poolKey = `${this.dexKey}_${_token0}_${_token1}`.toLowerCase();

    return poolKey;
  }

  /*
   * When a non existing pool is queried, it's blacklisted for an arbitrary long period in order to prevent issuing too many rpc calls
   * Once the pool is created, it gets immediately flagged
   */
  onPoolCreatedDeleteFromNonExistingSet: OnPoolCreatedCallback = async ({
    token0,
    token1,
  }) => {
    const logPrefix = '[onPoolCreatedDeleteFromNonExistingSet]';

    try {
      const poolKey = this.getPoolIdentifier(token0, token1);

      this.newlyCreatedPoolKeys.add(poolKey);

      // delete entry locally to let local instance discover the pool
      delete this.pairs[poolKey];

      this.logger.info(`${logPrefix} discovered new pool ${poolKey}`);
    } catch (e) {
      this.logger.error(
        `${logPrefix} LOGIC ERROR on ack new pool (token0=${token0},token1=${token1})`,
        e,
      );
    }
  };

  getPoolStatesMultiCallData(pair: CamelotPair): {
    callEntries: any[];
    callDecoder: (data: any[]) => {
      reserve0: string;
      reserve1: string;
      token0FeeCode: number;
      token1FeeCode: number;
      stable: boolean;
    };
  } {
    const callEntries = [
      {
        target: pair.exchange,
        callData: camelotPairIface.encodeFunctionData('getReserves', []),
      },
      {
        target: pair.exchange,
        callData: camelotPairIface.encodeFunctionData('stableSwap', []),
      },
    ];

    const callDecoder = (data: any[]) => {
      const info = AbiCoder.defaultAbiCoder().decode(
        ['uint112', 'uint112', 'uint16', 'uint16'],
        data[0],
      );
      const reserve0: string = info[0].toString();
      const reserve1: string = info[1].toString();
      const token0FeeCode: number = parseInt(info[2].toString());
      const token1FeeCode: number = parseInt(info[3].toString());
      const stable: boolean = AbiCoder.defaultAbiCoder().decode(
        ['bool'],
        data[1],
      )[0];

      return { reserve0, reserve1, token0FeeCode, token1FeeCode, stable };
    };
    return { callEntries, callDecoder };
  }

  protected async addPool(
    pair: CamelotPair,
    reserve0: string,
    reserve1: string,
    token0FeeCode: number,
    token1FeeCode: number,
    stable: boolean,
    blockNumber: number,
  ) {
    const { callEntries, callDecoder } =
      this.getPoolStatesMultiCallData(pair) || {};
    pair.pool = new CamelotEventPool(
      this.dexKey,
      this.dexHelper,
      pair.exchange!,
      pair.token0,
      pair.token1,
      this.logger,
      this.decoderIface,
      callEntries,
      callDecoder,
    );
    pair.pool.addressesSubscribed.push(pair.exchange!);

    await pair.pool.initialize(blockNumber, {
      state: { reserve0, reserve1, token0FeeCode, token1FeeCode, stable },
    });
  }

  async getBuyPrice(
    priceParams: CamelotPoolOrderedParams,
    srcAmount: bigint,
  ): Promise<bigint> {
    if (priceParams.stable) throw new Error('Buy not supported');

    return Uniswapv2ConstantProductPool.getBuyPrice(
      priceParams,
      srcAmount,
      this.feeFactor,
    );
  }

  async getSellPrice(
    priceParams: CamelotPoolOrderedParams,
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

  async getBuyPricePath(
    amount: bigint,
    params: CamelotPoolOrderedParams[],
  ): Promise<bigint> {
    let price = amount;
    for (const param of params.reverse()) {
      price = await this.getBuyPrice(param, price);
    }
    return price;
  }

  async getSellPricePath(
    amount: bigint,
    params: CamelotPoolOrderedParams[],
  ): Promise<bigint> {
    let price = amount;
    for (const param of params) {
      price = await this.getSellPrice(param, price);
    }
    return price;
  }

  async findPair(from: Token, to: Token) {
    if (from.address.toLowerCase() === to.address.toLowerCase()) return null;
    const [token0, token1] =
      from.address.toLowerCase() < to.address.toLowerCase()
        ? [from, to]
        : [to, from];

    const key = this.getPoolIdentifier(token0.address, token1.address);
    let pair = this.pairs[key];
    if (pair) return pair;
    const exchange = await this.factory.methods
      .getPair(token0.address, token1.address)
      .call();
    if (exchange === NULL_ADDRESS) {
      // if the pool has been newly created to not allow this op as we can run into race condition between pool discovery and concurrent pricing request touching this pool
      if (!this.newlyCreatedPoolKeys.has(key)) {
        pair = { token0, token1 };
      }
    } else {
      pair = { token0, token1, exchange };
    }
    this.pairs[key] = pair;
    return pair;
  }

  async getManyPoolStates(
    pairs: CamelotPair[],
    blockNumber: number,
  ): Promise<CamelotPoolState[]> {
    try {
      const callData = pairs
        .map((pair, i) => {
          return this.getPoolStatesMultiCallData(pair).callEntries;
        })
        .flat();

      const data: { returnData: any[] } =
        await this.dexHelper.multiContract.methods
          .aggregate(callData)
          .call({}, blockNumber);

      const returnData = _.chunk(data.returnData, 2);

      return pairs.map((pair, i) => {
        return this.getPoolStatesMultiCallData(pair).callDecoder(returnData[i]);
      });
    } catch (e) {
      this.logger.error(
        `Error_getManyPoolReserves could not get reserves with error:`,
        e,
      );
      return [];
    }
  }

  async batchCatchUpPairs(pairs: [Token, Token][], blockNumber: number) {
    if (!blockNumber) return;
    const pairsToFetch: CamelotPair[] = [];
    for (const _pair of pairs) {
      const pair = await this.findPair(_pair[0], _pair[1]);
      if (!(pair && pair.exchange)) continue;
      if (!pair.pool) {
        pairsToFetch.push(pair);
      } else if (!pair.pool.getState(blockNumber)) {
        pairsToFetch.push(pair);
      }
    }

    if (!pairsToFetch.length) return;

    const pairsStates = await this.getManyPoolStates(pairsToFetch, blockNumber);

    if (pairsStates.length !== pairsToFetch.length) {
      this.logger.error(
        `Error_getManyPoolReserves didn't get any pool reserves`,
      );
    }

    for (let i = 0; i < pairsToFetch.length; i++) {
      const pairState = pairsStates[i];
      const pair = pairsToFetch[i];
      if (!pair.pool) {
        await this.addPool(
          pair,
          pairState.reserve0,
          pairState.reserve1,
          pairState.token0FeeCode,
          pairState.token1FeeCode,
          pairState.stable,
          blockNumber,
        );
      } else pair.pool.setState(pairState, blockNumber);
    }
  }

  async getPairOrderedParams(
    from: Token,
    to: Token,
    blockNumber: number,
    tokenDexTransferFee: number,
  ): Promise<CamelotPoolOrderedParams | null> {
    const pair = await this.findPair(from, to);
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

    const pairReversed =
      pair.token1.address.toLowerCase() === from.address.toLowerCase();
    if (pairReversed) {
      return {
        tokenIn: from.address,
        tokenOut: to.address,
        reservesIn: pairState.reserve1,
        reservesOut: pairState.reserve0,
        decimalsIn: from.decimals,
        decimalsOut: to.decimals,
        fee: (pairState.token1FeeCode + tokenDexTransferFee).toString(),
        direction: false,
        exchange: pair.exchange,
        stable: pairState.stable,
      };
    }
    return {
      tokenIn: from.address,
      tokenOut: to.address,
      decimalsIn: from.decimals,
      decimalsOut: to.decimals,
      reservesIn: pairState.reserve0,
      reservesOut: pairState.reserve1,
      fee: (pairState.token0FeeCode + tokenDexTransferFee).toString(),
      direction: true,
      exchange: pair.exchange,
      stable: pairState.stable,
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

    const poolKey = this.getPoolIdentifier(from.address, to.address);

    return [poolKey];
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
  ): Promise<ExchangePrices<SolidlyData> | null> {
    try {
      const from = this.dexHelper.config.wrapETH(_from);
      const to = this.dexHelper.config.wrapETH(_to);

      if (from.address.toLowerCase() === to.address.toLowerCase()) {
        return null;
      }

      const poolIdentifier = this.getPoolIdentifier(from.address, to.address);

      if (limitPools && limitPools.every(p => p !== poolIdentifier))
        return null;

      await this.batchCatchUpPairs([[from, to]], blockNumber);
      const isSell = side === SwapSide.SELL;
      const pairParam = await this.getPairOrderedParams(
        from,
        to,
        blockNumber,
        transferFees.srcDexFee,
      );

      if (!pairParam || (side === SwapSide.BUY && pairParam.stable))
        return null;

      const unitAmount = getBigIntPow(isSell ? from.decimals : to.decimals);

      const [unitVolumeWithFee, ...amountsWithFee] = applyTransferFee(
        [unitAmount, ...amounts],
        side,
        isSell ? transferFees.srcFee : transferFees.destFee,
        isSell ? SRC_TOKEN_PARASWAP_TRANSFERS : DEST_TOKEN_PARASWAP_TRANSFERS,
      );

      const unit = isSell
        ? await this.getSellPricePath(unitVolumeWithFee, [pairParam])
        : await this.getBuyPricePath(unitVolumeWithFee, [pairParam]);

      const prices = isSell
        ? await Promise.all(
            amountsWithFee.map(amount =>
              this.getSellPricePath(amount, [pairParam]),
            ),
          )
        : await Promise.all(
            amountsWithFee.map(amount =>
              this.getBuyPricePath(amount, [pairParam]),
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

      // As camelot just has one pool per token pair
      return [
        {
          prices: outputsWithFee,
          unit: unitOutWithFee,
          data: {
            router:
              side === SwapSide.SELL
                ? this.routerAddress
                : this.dexHelper.config.data.uniswapV2ExchangeRouterAddress,
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
          poolIdentifier,
          gasCost: this.poolGasCost,
          poolAddresses: [pairParam.exchange],
        },
      ];
    } catch (e) {
      if (blockNumber === 0)
        this.logger.error(
          `Error_getPricesVolume: Aurelius block manager not yet instantiated`,
        );
      this.logger.error(`Error_getPrices:`, e);
      return null;
    }
  }

  // Returns estimated gas cost of calldata for this DEX in multiSwap
  getCalldataGasCost(poolPrices: PoolPrices<UniswapV2Data>): number | number[] {
    return (
      CALLDATA_GAS_COST.DEX_OVERHEAD +
      CALLDATA_GAS_COST.LENGTH_SMALL +
      // ParentStruct header
      CALLDATA_GAS_COST.OFFSET_SMALL +
      // ParentStruct -> weth
      CALLDATA_GAS_COST.ADDRESS +
      // ParentStruct -> pools[] header
      CALLDATA_GAS_COST.OFFSET_SMALL +
      // ParentStruct -> pools[]
      CALLDATA_GAS_COST.LENGTH_SMALL +
      // ParentStruct -> pools[0]
      CALLDATA_GAS_COST.wordNonZeroBytes(22)
    );
  }

  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return this.adapters[side];
  }

  async getTopPoolsForToken(
    tokenAddress: Address,
    count: number,
  ): Promise<PoolLiquidity[]> {
    if (!this.subgraphURL) return [];

    const query = `query ($token: Bytes!, $count: Int) {
      pools0: pairs(first: $count, orderBy: reserveUSD, orderDirection: desc, where: {token0: $token, reserve0_gt: 1, reserve1_gt: 1}) {
        id
        isStable
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
        isStable
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
      stable: pool.isStable,
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
      stable: pool.isStable,
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

  getWETHAddress(srcToken: Address, destToken: Address, weth?: Address) {
    if (!isETHAddress(srcToken) && !isETHAddress(destToken))
      return NULL_ADDRESS;
    return weth || this.dexHelper.config.data.wrappedNativeTokenAddress;
  }

  getAdapterParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    toAmount: NumberAsString, // required for buy case
    data: SolidlyData,
    side: SwapSide,
  ): AdapterExchangeParam {
    if (side === SwapSide.BUY) throw new Error('Buy not supported');

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
      { pools, weth, isFeeTokenInRoute: data.isFeeTokenInRoute },
    );
    return {
      targetExchange: data.router,
      payload,
      networkFee: '0',
    };
  }

  async getSimpleParam(
    src: Address,
    dest: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    data: SolidlyData,
    side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    if (side === SwapSide.BUY) throw new Error('Buy not supported');

    const pools = encodePools(data.pools, this.feeFactor);
    const weth = this.getWETHAddress(src, dest, data.wethAddress);
    const swapData = this.exchangeRouterInterface.encodeFunctionData(
      side === SwapSide.SELL ? UniswapV2Functions.swap : UniswapV2Functions.buy,
      [src, srcAmount, destAmount, weth, pools],
    );

    return this.buildSimpleParamWithoutWETHConversion(
      src,
      srcAmount,
      dest,
      destAmount,
      swapData,
      data.router,
    );
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
    if (side === SwapSide.BUY) throw new Error('Buy not supported');
    let exchangeDataTypes = ['bytes4', 'bytes32'];

    const isStable = data.pools.some(pool => pool.stable);
    const isStablePoolAndPoolCount = isStable
      ? ((1n << 255n) | BigInt(data.pools.length)).toString()
      : zeroPadValue(toBeHex(data.pools.length), 32);

    let exchangeDataToPack = [
      zeroPadValue(toBeHex(0), 4),
      isStablePoolAndPoolCount,
    ];

    const pools = encodePools(data.pools, this.feeFactor);
    pools.forEach(pool => {
      exchangeDataTypes.push('bytes32');
      exchangeDataToPack.push(zeroPadValue(pool, 32));
    });

    const exchangeData = solidityPacked(exchangeDataTypes, exchangeDataToPack);

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

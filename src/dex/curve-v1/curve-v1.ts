import { Interface, AbiCoder, JsonFragment } from '@ethersproject/abi';
import _ from 'lodash';
import { NumberAsString, OptimalSwapExchange } from '@paraswap/core';
import { assert } from 'ts-essentials';
import BigNumber from 'bignumber.js';
import CurveABI from '../../abi/Curve.json';
import DirectSwapABI from '../../abi/DirectSwap.json';
import { Adapters, CurveV1Config } from './config';

import {
  AdapterExchangeParam,
  Address,
  DexExchangeParam,
  ExchangePrices,
  ExchangeTxInfo,
  PoolLiquidity,
  PoolPrices,
  PreprocessTransactionOptions,
  SimpleExchangeParam,
  Token,
  TransferFeeParams,
  TxInfo,
} from '../../types';
import {
  Network,
  NULL_ADDRESS,
  SRC_TOKEN_PARASWAP_TRANSFERS,
  ETHER_ADDRESS,
  SwapSide,
} from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import StableSwapBBTC from '../../abi/curve-v1/StableSwapBBTC.json';
import { CurvePool } from './pools/curve-pool';
import { CurveMetapool } from './pools/curve-metapool';
import { ThreePool, address as ThreePoolAddress } from './pools/3pool';
import { SUSDPool, address as SUSDPoolAddress } from './pools/sUSDpool';
import { HBTCPool, address as HBTCPoolAddress } from './pools/hBTCpool';
import { RenPool, address as RenPoolAddress } from './pools/renpool';
import { SBTCPool, address as SBTCPoolAddress } from './pools/sBTCpool';
import { SETHPool, address as SETHPoolAddress } from './pools/sETHpool';
import { STETHPool, address as STETHPoolAddress } from './pools/stETHpool';
import { EURSPool, address as EURSPoolAddress } from './pools/EURSpool';
import { DUSDPool, address as DUSDPoolAddress } from './pools/DUSDpool';
import { BBTCPool, address as BBTCPoolAddress } from './pools/bBTCpool';
import { GUSDPool, address as GUSDPoolAddress } from './pools/GUSDpool';
import { HUSDPool, address as HUSDPoolAddress } from './pools/HUSDpool';
import {
  LinkUSDPool,
  address as LinkUSDPoolAddress,
} from './pools/LinkUSDpool';
import { MUSDPool, address as MUSDPoolAddress } from './pools/MUSDpool';
import { OBTCPool, address as OBTCPoolAddress } from './pools/oBTCpool';
import { PBTCPool, address as PBTCPoolAddress } from './pools/pBTCpool';
import { RSVPool, address as RSVPoolAddress } from './pools/rsvpool';
import { TBTCPool, address as TBTCPoolAddress } from './pools/tBTCpool';
import { USDKPool, address as USDKPoolAddress } from './pools/usdkpool';
import { USTPool, address as USTPoolAddress } from './pools/ustpool';
import { SLINKPool, address as SLINKPoolAddress } from './pools/sLinkpool';
import {
  getBigIntPow,
  getDexKeysWithNetwork,
  interpolate,
  isDestTokenTransferFeeToBeExchanged,
  isETHAddress,
  isSrcTokenTransferFeeToBeExchanged,
  Utils,
  uuidToBytes16,
} from '../../utils';
import { BN_0 } from '../../bignumber-constants';
import {
  getLocalDeadlineAsFriendlyPlaceholder,
  SimpleExchange,
} from '../simple-exchange';
import { IDex } from '../idex';
import { IDexHelper } from '../../dex-helper';
import { Logger } from 'log4js';
import { uin128DecodeToInt, uin256DecodeToFloat } from '../../lib/decoders';
import { getManyPoolStates } from './pools/getstate-multicall';
import { MultiCallParams, MultiResult } from '../../lib/multi-wrapper';
import {
  PoolConfig,
  CurveV1Data,
  TokenWithReasonableVolume,
  CurveSwapFunctions,
  CurveV1SwapType,
  DirectCurveV1Param,
  DirectCurveV1ParamV6,
  CurveV1DirectSwap,
} from './types';
import { erc20Iface } from '../../lib/utils-interfaces';
import { applyTransferFee } from '../../lib/token-transfer-fee';
import { DIRECT_METHOD_NAME, DIRECT_METHOD_NAME_V6 } from './constants';
import { packCurveData } from '../../lib/curve/encoder';
import { encodeCurveAssets } from './packer';
import { hexConcat, hexZeroPad, hexlify } from 'ethers/lib/utils';

const CURVE_DEFAULT_CHUNKS = 10;

const CURVE_LENDING_POOl_GAS = 340 * 1000;
const CURVE_POOL_GAS = 200 * 1000;

const coder = new AbiCoder();

export class CurveV1
  extends SimpleExchange
  implements IDex<CurveV1Data, DirectCurveV1Param | CurveV1DirectSwap>
{
  exchangeRouterInterface: Interface;
  minConversionRate = '1';

  eventPools = new Array<CurvePool | CurveMetapool>();
  public poolInterface: Interface;

  private logger: Logger;

  readonly hasConstantPriceLargeAmounts = false;
  readonly isFeeOnTransferSupported = true;

  private decimalsCoinsAndUnderlying: Record<string, number> = {};

  protected pools: Record<string, PoolConfig>;
  protected eventSupportedPools: string[];
  protected baseTokens: Record<string, TokenWithReasonableVolume>;

  protected disableFeeOnTransferTokenAddresses: Set<string>;

  readonly directSwapIface = new Interface(DirectSwapABI);

  readonly SRC_TOKEN_DEX_TRANSFERS = 1;
  readonly DEST_TOKEN_DEX_TRANSFERS = 1;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(CurveV1Config);

  constructor(
    protected network: Network,
    dexKey: string,
    protected dexHelper: IDexHelper,
    dexConfig = CurveV1Config[dexKey][network],

    protected adapters = Adapters[network],
  ) {
    super(dexHelper, dexKey);
    this.pools = Object.keys(dexConfig.pools).reduce<
      Record<string, PoolConfig>
    >((acc, key) => {
      const poolConf = dexConfig.pools[key];

      acc[key] = {
        underlying: poolConf.underlying.map(t => t.toLowerCase()),
        coins: poolConf.coins.map(t => t.toLowerCase()),
        address: poolConf.address.toLowerCase(),
        name: poolConf.name,
        type: poolConf.type,
        version: poolConf.version,
        isLending: poolConf.isLending,
        isMetapool: poolConf.isMetapool,
        baseToken: poolConf.baseToken
          ? poolConf.baseToken.toLowerCase()
          : poolConf.baseToken,
        liquidityUSD: poolConf.liquidityUSD,
        trackCoins: poolConf.trackCoins,
        useLending: poolConf.useLending,
        precisionMul: poolConf.precisionMul,
        tokenAddress: poolConf.tokenAddress
          ? poolConf.tokenAddress.toLowerCase()
          : undefined,
        isFeeOnTransferSupported: poolConf.isFeeOnTransferSupported,
      };

      return acc;
    }, {});

    this.eventSupportedPools = dexConfig.eventSupportedPools.map(addr =>
      addr.toLowerCase(),
    );

    this.baseTokens = Object.keys(dexConfig.baseTokens).reduce<
      Record<string, TokenWithReasonableVolume>
    >((acc, key) => {
      const baseToken = dexConfig.baseTokens[key];
      acc[key.toLowerCase()] = {
        address: baseToken.address.toLowerCase(),
        decimals: baseToken.decimals,
        reasonableVolume: baseToken.reasonableVolume,
      };
      return acc;
    }, {});

    this.disableFeeOnTransferTokenAddresses =
      dexConfig.disableFeeOnTransferTokenAddresses
        ? new Set<string>(
            Array.from(
              dexConfig.disableFeeOnTransferTokenAddresses.values(),
            ).map(addr => addr.toLowerCase()),
          )
        : new Set<string>();

    this.exchangeRouterInterface = new Interface(CurveABI as JsonFragment[]);

    this.logger = dexHelper.getLogger(dexKey);

    this.poolInterface = new Interface(StableSwapBBTC as any);
  }

  protected getPoolByAddress(address: Address) {
    return (
      this.eventPools.find(
        p => p.address.toLowerCase() == address.toLowerCase(),
      ) || null
    );
  }

  protected getPoolConfigByAddress(address: Address) {
    return Object.values(this.pools).find(p => p.address == address);
  }

  getPoolConfig(from: Token, to: Token): PoolConfig | undefined {
    return this.getPoolConfigs(from, to)[0];
  }

  getPoolConfigs(from: Token, to: Token) {
    const fromAddress = from.address.toLowerCase();
    const toAddress = to.address.toLowerCase();
    return Object.values(this.pools).filter(config => {
      const underlying = config.underlying.map((add: string) =>
        add.toLowerCase(),
      );
      const coins = config.coins.map((add: string) => add.toLowerCase());

      // Case 0: If the swap is between the underlying first token and any underlying token
      if (
        underlying.length &&
        ((underlying[0] === fromAddress && underlying.includes(toAddress)) ||
          (underlying[0] === toAddress && underlying.includes(fromAddress)))
      )
        return true;
      // Case 1: If it not a metapool and the swap is between any underlying tokens
      if (
        config.isLending &&
        underlying.includes(toAddress) &&
        underlying.includes(fromAddress)
      )
        return true;

      // Case 2: If it a swap between any direct tokens
      if (coins.includes(toAddress) && coins.includes(fromAddress)) return true;

      return false;
    });
  }

  async getPoolIdentifiers(
    _from: Token,
    _to: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    const pools = this.getPoolConfigs(_from, _to);
    return pools.map(pool => this.getPoolIdentifier(pool.name));
  }

  getContractAddress(srcToken: Token, to: Token) {
    const pool = this.getPoolConfig(srcToken, to);
    return pool && pool.address;
  }

  poolConfigsByAddress() {
    return Object.keys(this.pools).reduce((acc: any, poolName: string) => {
      acc[this.pools[poolName].address.toLowerCase()] = this.pools[poolName];
      return acc;
    }, {});
  }

  // TODO: revisit to verify the chunks for BTC pools vs USD pools
  getOnChainChunks(
    from: Token,
    to: Token,
    srcAmount: bigint,
    defaultChunks: number,
  ) {
    return CURVE_DEFAULT_CHUNKS;
    //return srcAmount >= 10000n * getBigIntPow(from.decimals)
    //  ? defaultChunks
    //  : CURVE_DEFAULT_CHUNKS;
  }

  getEventPoolInstance(poolAddress: Address): CurvePool | CurveMetapool | null {
    switch (poolAddress.toLowerCase()) {
      case ThreePoolAddress:
        return new ThreePool(this.dexKey, this.dexHelper);
      case SUSDPoolAddress:
        return new SUSDPool(this.dexKey, this.dexHelper);
      case HBTCPoolAddress:
        return new HBTCPool(this.dexKey, this.dexHelper);
      case RenPoolAddress:
        return new RenPool(this.dexKey, this.dexHelper);
      case SBTCPoolAddress:
        return new SBTCPool(this.dexKey, this.dexHelper);
      case SETHPoolAddress:
        return new SETHPool(this.dexKey, this.dexHelper);
      case STETHPoolAddress:
        return new STETHPool(this.dexKey, this.dexHelper);
      case EURSPoolAddress:
        return new EURSPool(this.dexKey, this.dexHelper);
      case DUSDPoolAddress:
        return new DUSDPool(this.dexKey, this.dexHelper);
      case BBTCPoolAddress:
        return new BBTCPool(this.dexKey, this.dexHelper);
      case GUSDPoolAddress:
        return new GUSDPool(this.dexKey, this.dexHelper);
      case HUSDPoolAddress:
        return new HUSDPool(this.dexKey, this.dexHelper);
      case LinkUSDPoolAddress:
        return new LinkUSDPool(this.dexKey, this.dexHelper);
      case MUSDPoolAddress:
        return new MUSDPool(this.dexKey, this.dexHelper);
      case OBTCPoolAddress:
        return new OBTCPool(this.dexKey, this.dexHelper);
      case PBTCPoolAddress:
        return new PBTCPool(this.dexKey, this.dexHelper);
      case RSVPoolAddress:
        return new RSVPool(this.dexKey, this.dexHelper);
      case TBTCPoolAddress:
        return new TBTCPool(this.dexKey, this.dexHelper);
      case USDKPoolAddress:
        return new USDKPool(this.dexKey, this.dexHelper);
      case USTPoolAddress:
        return new USTPool(this.dexKey, this.dexHelper);
      case SLINKPoolAddress:
        return new SLINKPool(this.dexKey, this.dexHelper);
      default:
        return null;
    }
  }

  // Makes sure all the pools from poolAddress are being tracked. If a pool in not tracked yet
  // fetch the state and setup the pool, if they are being watched but don't have a valid state
  // add it to the list of unavailable pools. Return the list of unavailable pools.
  async batchCatchUpPools(
    poolAddresses: string[],
    blockNumber: number,
  ): Promise<string[]> {
    const unavailablePools = new Array<string>();
    if (!blockNumber) return unavailablePools;
    let poolsToFetch: (CurvePool | CurveMetapool)[] = [];
    for (const poolAddress of poolAddresses) {
      // Check if the pool is already tracked
      let pool = this.getPoolByAddress(poolAddress);
      // If the pool is not stracked add it to the list of pools to fetch
      if (!pool) {
        let newPool = this.getEventPoolInstance(poolAddress);
        if (!newPool)
          throw new Error(
            `Error_${this.dexKey} requested unsupported event pool with address ${poolAddress}`,
          );

        const addressesSubscribed = newPool.addressesSubscribed.map(address =>
          address.toLowerCase(),
        );
        if (!addressesSubscribed.includes(poolAddress)) {
          newPool.addressesSubscribed.push(poolAddress);
        }

        await newPool.initialize(blockNumber);
        poolsToFetch.push(newPool);
      } else if (!pool.getState(blockNumber)) {
        unavailablePools.push(poolAddress);
      }
    }

    if (!poolsToFetch.length) return unavailablePools;

    try {
      const poolStates = await getManyPoolStates(
        poolsToFetch,
        this.dexHelper.multiContract,
        blockNumber,
      );

      for (let i = 0; i < poolsToFetch.length; i++) {
        await poolsToFetch[i].setup(blockNumber, poolStates[i] as any);
        this.eventPools.push(poolsToFetch[i]);
      }
      return unavailablePools;
    } catch (e) {
      this.logger.error(`Error_batchCatchUpPools`, e);
      throw e;
    }
  }

  async getRatesEventPools(
    fromToken: Token,
    toToken: Token,
    amounts: BigNumber[],
    fromBigNumbers: number,
    pools: string[],
    indexes: [number, number, number][],
    blockNumber: number,
  ) {
    const unavailablePools = await this.batchCatchUpPools(pools, blockNumber);

    if (unavailablePools.length) {
      this.logger.error(
        `Couldn't use events for ${unavailablePools.length} ${this.dexKey} pools!`,
      );
      pools = pools.filter(p => !unavailablePools.includes(p));
    }

    let rates = new Array(pools.length);
    for (let i = 0; i < pools.length; i++) {
      rates[i] = {
        exchange: pools[i],
        rates: this.getRatesEventPool(
          pools[i],
          indexes[i],
          amounts,
          fromBigNumbers,
          blockNumber,
        ),
      };
    }
    return rates;
  }

  async getRatesOnChain(
    fromToken: Token,
    toToken: Token,
    amounts: bigint[],
    pools: string[],
    indexes: [number, number, number][],
    blockNumber: number,
  ) {
    const chunks = amounts.length - 1;
    const srcAmount = amounts[chunks]!;

    // The number of chunks used onchain to minimize the full node calls
    const onChainChunks = this.getOnChainChunks(
      fromToken,
      toToken,
      srcAmount,
      chunks,
    );

    const _width = Math.floor(chunks / onChainChunks);

    const unitVolume = amounts[0];
    amounts[0] = 0n;

    const _amounts = [unitVolume].concat(
      Array.from(Array(onChainChunks).keys()).map(
        i => amounts[(i + 1) * _width],
      ),
    );

    const calldata = pools.map((p, i) =>
      _amounts.map(_amount => ({
        target: p,
        callData: this.poolInterface.encodeFunctionData(
          indexes[i][2] === 1 ? 'get_dy_underlying' : 'get_dy',
          [indexes[i][0], indexes[i][1], _amount],
        ),
      })),
    );

    //const data = await this.multi.methods
    //  .tryAggregate(false, calldata.flat())
    //  .call({}, 'latest');
    const data = (
      await Promise.all(
        calldata.map(async poolCalldata => {
          try {
            const result = await Utils.timeoutPromise<MultiResult<any>[]>(
              this.dexHelper.multiContract.methods
                .tryAggregate(false, poolCalldata)
                .call({}, 'latest'),
              2000,
              `Timed out multicall for curve pool ${poolCalldata[0].target}`,
            );
            return result;
          } catch (e) {
            this.logger.error(e);
            return Array<MultiResult<any>>(poolCalldata.length).fill({
              success: false,
              returnData: '0x',
            });
          }
        }),
      )
    ).flat();

    // Convert the on chain rates to the requested chunks, using simple interpolation
    const correctChunks = (_r: bigint[]): bigint[] => [
      _r[0],
      ...interpolate(
        _amounts.slice(1),
        _r.slice(1),
        amounts.slice(1),
        SwapSide.SELL,
      ),
    ];

    const decode = (j: number) => {
      if (!data[j].success) return 0n;
      const decoded = coder.decode(['uint256'], data[j].returnData);
      return BigInt(decoded[0].toString());
    };

    let i = 0;
    // chunks !== onChainChunks || !isAmountsLinear
    const ratesAllPools = pools.map(p => {
      const rates = _amounts.map(a => decode(i++));
      return {
        rates: correctChunks(rates),
        exchange: p,
      };
    });

    return ratesAllPools;
  }

  protected noMorePrice(prices: BigNumber[], index: number): boolean {
    return index > 1 && prices[index - 1].eq(BN_0);
  }

  getRatesEventPool(
    exchange: string,
    curveIndexes: number[],
    amounts: BigNumber[],
    fromBigNumbers: number,
    blockNumber: number,
  ) {
    let rates = new Array<BigNumber>(amounts.length).fill(BN_0);

    let fromIndex = curveIndexes[0];
    let toIndex = curveIndexes[1];
    let isTokenSwap = curveIndexes[2] === 1;

    let pool = this.getPoolByAddress(exchange);
    if (!pool) {
      throw new Error(
        `Error_${this.dexKey}_getRatesEvent pool is not initialised`,
      );
    }

    const state = pool.getState(blockNumber);
    if (!state)
      throw new Error(
        `Error_${this.dexKey}_${pool.name} expected state at blocknumber ${blockNumber}, got none`,
      );

    if (isTokenSwap) {
      rates[0] = pool.get_dy_underlying(
        fromIndex,
        toIndex,
        amounts[0],
        state as any,
      );

      for (let i = 1; i < amounts.length; i++) {
        rates[i] = this.noMorePrice(rates, i)
          ? BN_0
          : pool.get_dy_underlying(
              fromIndex,
              toIndex,
              amounts[i],
              state as any,
            );
      }
    } else {
      rates[0] = pool.get_dy(fromIndex, toIndex, amounts[0], state as any);

      for (let i = 1; i < amounts.length; i++) {
        rates[i] = this.noMorePrice(rates, i)
          ? BN_0
          : pool.get_dy(fromIndex, toIndex, amounts[i], state as any);
      }
    }

    let floatRates = rates.map(rate => BigInt(rate.toFixed(0)));
    return floatRates;
  }

  isEventPoolSupported(poolAddress: Address): Boolean {
    return this.eventSupportedPools.some(p => p === poolAddress.toLowerCase());
  }

  allocPools(
    from: Token,
    to: Token,
    side: SwapSide,
    routeID: number,
    usedPools: { [poolIdentifier: string]: number },
    isFirstSwap: boolean,
  ) {
    if (side === SwapSide.BUY) {
      return;
    }

    this.getPoolConfigs(from, to).forEach(p => {
      const poolIdentifier = this.getPoolIdentifier(p.name);
      if (!(poolIdentifier in usedPools)) {
        usedPools[poolIdentifier] = routeID;
      }
    });
  }

  public getPoolIdentifier(name: string) {
    return `${this.dexKey}_${name.toLowerCase()}`;
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
  ): Promise<ExchangePrices<CurveV1Data> | null> {
    try {
      if (side === SwapSide.BUY) {
        return null;
      }

      _from.address = _from.address.toLowerCase();
      _to.address = _to.address.toLowerCase();

      const _isSrcTokenTransferFeeToBeExchanged =
        this.disableFeeOnTransferTokenAddresses.has(_from.address)
          ? false
          : isSrcTokenTransferFeeToBeExchanged(transferFees);

      const _isDestTokenTransferFeeToBeExchanged =
        this.disableFeeOnTransferTokenAddresses.has(_to.address)
          ? false
          : isDestTokenTransferFeeToBeExchanged(transferFees);

      // We first filter out pools which were explicitly excluded and pools which are already used
      // then for the good pools we set the boolean to be true for used pools
      // and for each pool we take the address.
      const goodPoolConfigs = this.getPoolConfigs(_from, _to).filter(p => {
        if (limitPools !== undefined) {
          const id = this.getPoolIdentifier(p.name);
          if (!limitPools.includes(id)) {
            return false;
          }
        }

        if (_isSrcTokenTransferFeeToBeExchanged) {
          // Fee on transfers supported only when flag is specified
          return !!p.isFeeOnTransferSupported;
        }
        return true;
      });

      const goodPoolAddress = goodPoolConfigs.map(p => p.address);
      const indexesByAddress = goodPoolConfigs.reduce(
        (acc: { [address: string]: [number, number, number] }, pc) => {
          acc[pc.address] = this.getSwapIndexes(_from, _to, pc);
          return acc;
        },
        {},
      );

      if (goodPoolAddress.length === 0) {
        return null;
      }

      const amountsWithUnit = [
        getBigIntPow(_from.decimals),
        ...amounts.slice(1),
      ];
      const amountsWithUnitAndFee = _isSrcTokenTransferFeeToBeExchanged
        ? applyTransferFee(
            applyTransferFee(
              amountsWithUnit,
              side,
              transferFees.srcFee,
              SRC_TOKEN_PARASWAP_TRANSFERS,
            ),
            side,
            transferFees.srcDexFee,
            this.SRC_TOKEN_DEX_TRANSFERS,
          )
        : amountsWithUnit;

      let _prices = new Array();

      const eventPools = goodPoolAddress.filter(p =>
        this.isEventPoolSupported(p),
      );
      const eventPoolIndexes = eventPools.map(ep => indexesByAddress[ep]);
      if (eventPools) {
        const pricesEvents = await this.getRatesEventPools(
          _from,
          _to,
          amountsWithUnitAndFee.map(a => new BigNumber(a.toString())),
          _from.decimals,
          eventPools,
          eventPoolIndexes,
          blockNumber,
        );
        _prices = _prices.concat(pricesEvents);
      }

      // if the pool rates was not available in the event pool then fallback to the onchain pool query
      const isPoolNotInPrices = (poolAddress: Address) =>
        !_prices.find(
          existingPrice =>
            existingPrice.exchange.toLowerCase() === poolAddress.toLowerCase(),
        );
      const onChainPools = goodPoolAddress.filter(isPoolNotInPrices);

      const onChainPoolIndexes = onChainPools.map(op => indexesByAddress[op]);

      // onChainPools are only supported for pools with linear price chunks
      if (onChainPools.length) {
        const pricesOnChain = await this.getRatesOnChain(
          _from,
          _to,
          amountsWithUnitAndFee,
          onChainPools,
          onChainPoolIndexes,
          blockNumber,
        );
        _prices = _prices.concat(pricesOnChain);
      }

      const poolConfigsByAddress = this.poolConfigsByAddress();

      const poolPrices = _prices.reduce(
        (acc: PoolPrices<CurveV1Data>[], _price: any, idx: number) => {
          if (
            _price.exchange === NULL_ADDRESS ||
            !(_price.exchange.toLowerCase() in poolConfigsByAddress)
          )
            return acc;

          const poolConfig =
            poolConfigsByAddress[_price.exchange.toLowerCase()];
          const indexes = this.getSwapIndexes(_from, _to, poolConfig);
          const [i, j, swapType] = indexes;

          if (_isDestTokenTransferFeeToBeExchanged) {
            _price.rates = applyTransferFee(
              _price.rates,
              side,
              transferFees.destDexFee,
              this.DEST_TOKEN_DEX_TRANSFERS,
            );
          }

          acc.push({
            prices: [0n, ..._price.rates.slice(1)],
            unit: _price.rates[0],
            data: {
              exchange: _price.exchange,
              i,
              j,
              underlyingSwap: swapType === 1,
              deadline: 0,
            },
            exchange: this.dexKey,
            poolIdentifier: `${this.dexKey}_${poolConfig.name.toLowerCase()}`,
            gasCost: poolConfig.isLending
              ? CURVE_LENDING_POOl_GAS
              : CURVE_POOL_GAS,
            poolAddresses: [_price.exchange],
          });
          return acc;
        },
        [],
      );
      return poolPrices;
    } catch (e) {
      if (blockNumber === 0)
        this.logger.error(
          `Error_${this.dexKey}_getPrices: Aurelius block manager not yet instantiated`,
        );
      this.logger.error(`Error_${this.dexKey}_getPrices`, e);
      return null;
    }
  }

  getSwapIndexes(
    from: Token,
    to: Token,
    pool?: PoolConfig,
  ): [number, number, number] {
    pool = pool || this.getPoolConfig(from, to);
    if (!pool) {
      return [-1, -1, -1];
    }

    const fromAddress = from.address.toLowerCase();
    const toAddress = to.address.toLowerCase();
    const isUnderlyingSwap =
      pool.underlying.length &&
      pool.underlying.some(t => t.toLowerCase() === fromAddress) &&
      pool.underlying.some(t => t.toLowerCase() === toAddress);

    const fromIndex = isUnderlyingSwap
      ? pool.underlying.findIndex(t => t.toLowerCase() === fromAddress)
      : pool.coins.findIndex(t => t.toLowerCase() === fromAddress);

    const toIndex = isUnderlyingSwap
      ? pool.underlying.findIndex(t => t.toLowerCase() === toAddress)
      : pool.coins.findIndex(t => t.toLowerCase() === toAddress);

    const swapType = isUnderlyingSwap ? 1 : 2;

    return [fromIndex, toIndex, swapType];
  }

  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: CurveV1Data,
    side: SwapSide,
  ): AdapterExchangeParam {
    if (side === SwapSide.BUY) throw new Error(`Buy not supported`);

    const { i, j, deadline, underlyingSwap } = data;
    const payload = this.abiCoder.encodeParameter(
      {
        ParentStruct: {
          i: 'int128',
          j: 'int128',
          deadline: 'uint256',
          underlyingSwap: 'bool',
        },
      },
      { i, j, deadline, underlyingSwap },
    );

    return {
      targetExchange: data.exchange,
      payload,
      networkFee: '0',
    };
  }

  getCalldataGasCost(poolPrices: PoolPrices<CurveV1Data>): number | number[] {
    return (
      CALLDATA_GAS_COST.DEX_OVERHEAD +
      CALLDATA_GAS_COST.LENGTH_SMALL +
      CALLDATA_GAS_COST.INDEX +
      CALLDATA_GAS_COST.INDEX +
      CALLDATA_GAS_COST.TIMESTAMP +
      CALLDATA_GAS_COST.BOOL
    );
  }

  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return this.adapters?.[side] ?? null;
  }

  static getDirectFunctionName(): string[] {
    return [DIRECT_METHOD_NAME];
  }

  getTokenFromAddress(address: Address): Token {
    // In this Dex decimals are not used
    return { address, decimals: 0 };
  }

  async preProcessTransaction(
    optimalSwapExchange: OptimalSwapExchange<CurveV1Data>,
    srcToken: Token,
    _0: Token,
    _1: SwapSide,
    options: PreprocessTransactionOptions,
  ): Promise<[OptimalSwapExchange<CurveV1Data>, ExchangeTxInfo]> {
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
    data: CurveV1Data,
    side: SwapSide,
    permit: string,
    uuid: string,
    feePercent: NumberAsString,
    deadline: NumberAsString,
    partner: string,
    beneficiary: string,
    contractMethod: string,
  ): TxInfo<DirectCurveV1Param> {
    if (contractMethod !== DIRECT_METHOD_NAME) {
      throw new Error(`Invalid contract method ${contractMethod}`);
    }
    assert(side === SwapSide.SELL, 'Buy not supported');

    let isApproved: boolean = !!data.isApproved;
    if (data.isApproved === undefined) {
      this.logger.warn(`isApproved is undefined, defaulting to false`);
    }

    const swapParams: DirectCurveV1Param = [
      srcToken,
      destToken,
      data.exchange,
      srcAmount,
      destAmount,
      expectedAmount,
      feePercent,
      data.i.toString(),
      data.j.toString(),
      partner,
      isApproved,
      data.underlyingSwap
        ? CurveV1SwapType.EXCHANGE_UNDERLYING
        : CurveV1SwapType.EXCHANGE,
      beneficiary,
      // For CurveV1 we work as it is, without wrapping and unwrapping
      false,
      permit,
      uuidToBytes16(uuid),
    ];

    const encoder = (...params: DirectCurveV1Param) => {
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
    data: CurveV1Data,
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

    const swapParams: DirectCurveV1ParamV6 = [
      packCurveData(
        data.exchange,
        !data.isApproved, // approve flag, if not approved then set to true
        isETHAddress(destToken) ? 0 : isETHAddress(srcToken) ? 3 : 0,
        data.underlyingSwap
          ? CurveV1SwapType.EXCHANGE_UNDERLYING
          : CurveV1SwapType.EXCHANGE,
      ).toString(),
      encodeCurveAssets(data.i, data.j).toString(),
      srcToken,
      destToken,
      fromAmount,
      toAmount,
      quotedAmount,
      metadata,
      beneficiary,
    ];

    const encodeParams: CurveV1DirectSwap = [swapParams, partnerAndFee, permit];

    const encoder = (...params: CurveV1DirectSwap) => {
      return this.augustusV6Interface.encodeFunctionData(
        DIRECT_METHOD_NAME_V6,
        [...params],
      );
    };

    return {
      encoder,
      params: encodeParams,
      networkFee: '0',
    };
  }

  static getDirectFunctionNameV6(): string[] {
    return [DIRECT_METHOD_NAME_V6];
  }

  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: CurveV1Data,
    side: SwapSide,
  ): DexExchangeParam {
    if (side === SwapSide.BUY) throw new Error(`Buy not supported`);

    const { exchange, i, j, underlyingSwap } = data;
    const defaultArgs = [i, j, srcAmount, this.minConversionRate];
    const swapMethod = underlyingSwap
      ? CurveSwapFunctions.exchange_underlying
      : CurveSwapFunctions.exchange;
    const exchangeData = this.exchangeRouterInterface.encodeFunctionData(
      swapMethod,
      defaultArgs,
    );

    return {
      exchangeData,
      needWrapNative: this.needWrapNative,
      sendEthButSupportsInsertFromAmount: true,
      dexFuncHasRecipient: false,
      targetExchange: exchange,
      returnAmountPos: undefined,
    };
  }

  async getSimpleParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: CurveV1Data,
    side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    if (side === SwapSide.BUY) throw new Error(`Buy not supported`);

    const { exchange, i, j, underlyingSwap } = data;
    const defaultArgs = [i, j, srcAmount, this.minConversionRate];
    const swapMethod = underlyingSwap
      ? CurveSwapFunctions.exchange_underlying
      : CurveSwapFunctions.exchange;
    const swapData = this.exchangeRouterInterface.encodeFunctionData(
      swapMethod,
      defaultArgs,
    );

    return this.buildSimpleParamWithoutWETHConversion(
      srcToken,
      srcAmount,
      destToken,
      destAmount,
      swapData,
      exchange,
    );
  }

  async updateBaseTokenPrice() {
    for (let baseToken of Object.values(this.baseTokens)) {
      const usdPrice = await this.dexHelper.getTokenUSDPrice(
        baseToken,
        baseToken.reasonableVolume,
      );

      const denominator =
        Number(baseToken.reasonableVolume) / 10 ** baseToken.decimals;

      baseToken.tokenPrice = usdPrice / denominator;
    }
  }

  async fetchDecimals() {
    const calls = Object.values(this.pools).reduce<MultiCallParams<any>[]>(
      (acc, pool) => {
        const underlyingDecimalsCalls = pool.underlying.reduce<
          MultiCallParams<any>[]
        >((_acc, _token) => {
          const token = _token.toLowerCase();
          if (token === ETHER_ADDRESS) {
            this.decimalsCoinsAndUnderlying[token] = 18;
          } else {
            _acc.push({
              target: token,
              callData: erc20Iface.encodeFunctionData('decimals'),
              decodeFunction: uin128DecodeToInt,
              cb: (decimals: number) => {
                this.decimalsCoinsAndUnderlying[token.toLowerCase()] = decimals;
              },
            });
          }

          return _acc;
        }, []);

        const coinsDecimalsCalls = pool.coins.reduce<MultiCallParams<any>[]>(
          (_acc, _coin) => {
            const coin = _coin.toLowerCase();
            if (coin === ETHER_ADDRESS) {
              this.decimalsCoinsAndUnderlying[coin] = 18;
            } else {
              _acc.push({
                target: coin,
                callData: erc20Iface.encodeFunctionData('decimals'),
                decodeFunction: uin128DecodeToInt,
                cb: (decimals: number) => {
                  this.decimalsCoinsAndUnderlying[coin.toLowerCase()] =
                    decimals;
                },
              });
            }
            return _acc;
          },
          [],
        );

        acc.push(...underlyingDecimalsCalls, ...coinsDecimalsCalls);
        return acc;
      },
      [],
    );

    return this.dexHelper.multiWrapper!.tryAggregate(true, calls);
  }

  async fetchAllPools() {
    try {
      // Hack: We choose to check the balance of the token for the pool instead of calling
      // the balances array in the pool as it was a mess to have each curve abi
      // Some have balances[uint128] some have balances[uint256]
      // One of the consequence for such a hack is below for ETH Pools
      // TODO: below can be highly optimized
      // * we don't need to query token decimals every iteration
      // * we can use the decimals from the tokens list using the api

      const calls = Object.values(this.pools).reduce<MultiCallParams<number>[]>(
        (acc, pool) => {
          const coinCalls = pool.coins.map<MultiCallParams<number>>(coin => {
            const coinLowerCase = coin.toLowerCase();
            if (coinLowerCase === ETHER_ADDRESS) {
              return {
                target:
                  this.dexHelper.config.data.multicallV2Address.toLowerCase(),
                callData: this.dexHelper.multiContract.methods
                  .getEthBalance(pool.address.toLowerCase())
                  .encodeABI(),
                decodeFunction: uin256DecodeToFloat,
              };
            } else {
              return {
                target: coinLowerCase,
                callData: erc20Iface.encodeFunctionData('balanceOf', [
                  pool.address,
                ]),
                decodeFunction: uin256DecodeToFloat,
              };
            }
          });
          acc.push(...coinCalls);
          return acc;
        },
        [],
      );

      const results = await this.dexHelper.multiWrapper!.tryAggregate(
        true,
        calls,
      );

      let index = 0;
      Object.values(this.pools).forEach(pool => {
        const balances = results.slice(index, index + pool.coins.length);
        index += pool.coins.length;

        const sumLiquidity = balances.reduce((acc, balance, i) => {
          const coin = pool.coins[i].toLowerCase();
          const decimals = this.decimalsCoinsAndUnderlying[coin];

          return acc + balance.returnData / 10 ** decimals;
        }, 0);

        let liquidityUSD = 0;
        if (pool.baseToken) {
          if (!this.baseTokens[pool.baseToken]) {
            throw new Error(
              `missing base token ${pool.baseToken} for ${this.dexKey}`,
            );
          }
          liquidityUSD =
            sumLiquidity * Number(this.baseTokens[pool.baseToken].tokenPrice!);
        }

        pool.liquidityUSD = liquidityUSD;
      });
    } catch (e) {
      this.logger.error(`fetchAllPools ${this.dexKey}`, e);
      throw e;
    }
  }

  async updatePoolState(): Promise<void> {
    if (!Object.keys(this.decimalsCoinsAndUnderlying).length) {
      await this.fetchDecimals();
    }

    await this.updateBaseTokenPrice();
    await this.fetchAllPools();
  }

  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    const _tokenAddress = this.dexHelper.config.unwrapETH({
      address: tokenAddress,
      decimals: 18,
    }).address;
    // In general case a token can be in the coins or underlying
    // In case of the metapool the token might be in both at the same time
    // It is important to note that the connector tokens might not be
    // compatible for exchange among themselves.
    const selectedPool = Object.values(this.pools).reduce<PoolLiquidity[]>(
      (acc, pool) => {
        const inCoins = pool.coins.some(
          _token => _token.toLowerCase() === _tokenAddress.toLowerCase(),
        );
        const inUnderlying = pool.underlying.some(
          _token => _token.toLowerCase() === _tokenAddress.toLowerCase(),
        );
        let connectorTokens = inCoins ? pool.coins : [];
        connectorTokens = inUnderlying
          ? _.concat(connectorTokens, pool.underlying)
          : connectorTokens;

        if (connectorTokens.length) {
          acc.push({
            exchange: this.dexKey,
            address: pool.address,
            liquidityUSD: pool.liquidityUSD!,
            connectorTokens: _.uniq(connectorTokens)
              .filter(
                (_token: string) =>
                  _token.toLowerCase() !== _tokenAddress.toLowerCase(),
              )
              .map(tokenAddress => {
                const address = tokenAddress.toLowerCase();
                return {
                  address,
                  decimals: this.decimalsCoinsAndUnderlying[address],
                };
              }),
          });
        }
        return acc;
      },
      [],
    );
    return selectedPool
      .sort((a, b) => b.liquidityUSD - a.liquidityUSD)
      .slice(0, limit);
  }
}

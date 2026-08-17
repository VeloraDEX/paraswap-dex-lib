import { AsyncOrSync } from 'ts-essentials';
import { Interface } from '@ethersproject/abi';
import {
  Token,
  Address,
  ExchangePrices,
  PoolPrices,
  AdapterExchangeParam,
  PoolLiquidity,
  Logger,
  NumberAsString,
  DexExchangeParam,
} from '../../types';
import { SwapSide, Network, ETHER_ADDRESS } from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getDexKeysWithNetwork, getBigIntPow } from '../../utils';
import { IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { FairylaunchData, PoolState, DexParams, LaunchInfo } from './types';
import { SimpleExchange } from '../simple-exchange';
import { FairylaunchConfig, Adapters } from './config';
import { FairylaunchEventPool } from './fairylaunch-pool';
import LaunchFactoryABI from '../../abi/fairylaunch/LaunchFactory.json';
import BondingCurveABI from '../../abi/fairylaunch/BondingCurve.json';

const launchFactoryIface = new Interface(LaunchFactoryABI);
const bondingCurveIface = new Interface(BondingCurveABI);

const FAIRY_LAUNCH_GAS_COST = 150_000;
const BNB_ADDRESS = ETHER_ADDRESS.toLowerCase();
const BATCH_SIZE = 20;

export class Fairylaunch
  extends SimpleExchange
  implements IDex<FairylaunchData>
{
  protected eventPools: FairylaunchEventPool;

  readonly hasConstantPriceLargeAmounts = false;
  readonly needWrapNative = false;
  readonly isFeeOnTransferSupported = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(FairylaunchConfig);

  logger: Logger;

  private config: DexParams;

  private launchesCache: Map<number, LaunchInfo[]> = new Map();

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
    protected adapters = Adapters[network],
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey);
    this.config = FairylaunchConfig[dexKey][network];
    this.eventPools = new FairylaunchEventPool(
      dexKey,
      network,
      dexHelper,
      this.logger,
      this.config.launchFactoryAddress,
    );
  }

  async initializePricing(blockNumber: number) {
    // Inicialización lazy
  }

  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return null;
  }

  private async getActiveLaunches(blockNumber: number): Promise<LaunchInfo[]> {
    const cached = this.launchesCache.get(blockNumber);
    if (cached) return cached;

    try {
      const contract = new this.dexHelper.web3Provider.eth.Contract(
        LaunchFactoryABI as any,
        this.config.launchFactoryAddress,
      );

      const totalLaunches = Number(
        await contract.methods.totalLaunches().call({}, blockNumber),
      );

      if (totalLaunches === 0) {
        this.launchesCache.set(blockNumber, []);
        return [];
      }

      const launches: LaunchInfo[] = [];
      
      for (let start = 1; start <= totalLaunches; start += BATCH_SIZE) {
        const end = Math.min(start + BATCH_SIZE - 1, totalLaunches);
        const batchPromises = [];
        
        for (let i = start; i <= end; i++) {
          batchPromises.push(
            contract.methods.getLaunch(i).call({}, blockNumber)
              .catch((e: Error) => {
                this.logger.warn(`Error getting launch ${i}: ${e.message}`);
                return null;
              })
          );
        }
        
        const results = await Promise.all(batchPromises);
        
        for (const launchInfo of results) {
          if (launchInfo && !launchInfo.graduated) {
            launches.push({
              launchId: Number(launchInfo.launchId),
              creator: launchInfo.creator,
              treasury: launchInfo.treasury,
              token: launchInfo.token,
              bondingCurve: launchInfo.bondingCurve,
              graduated: launchInfo.graduated,
              createdAt: Number(launchInfo.createdAt),
              graduatedAt: Number(launchInfo.graduatedAt),
              name: launchInfo.name,
              symbol: launchInfo.symbol,
              metadataUri: launchInfo.metadataUri,
            });
          }
        }
      }
      
      this.launchesCache.set(blockNumber, launches);
      return launches;
    } catch (e) {
      this.logger.error('Error getting active launches', e);
      return [];
    }
  }

  private async getPoolState(
    bondingCurve: Address,
    blockNumber: number,
  ): Promise<PoolState | null> {
    try {
      const contract = new this.dexHelper.web3Provider.eth.Contract(
        BondingCurveABI as any,
        bondingCurve,
      );

      const [token, ethReserve, tokenReserve, totalTokensSold, graduated, launchId] = 
        await Promise.all([
          contract.methods.token().call({}, blockNumber),
          contract.methods.ethReserve().call({}, blockNumber),
          contract.methods.tokenReserve().call({}, blockNumber),
          contract.methods.totalTokensSold().call({}, blockNumber),
          contract.methods.graduated().call({}, blockNumber),
          contract.methods.launchId().call({}, blockNumber),
        ]);

      return {
        bondingCurve,
        token,
        ethReserve: BigInt(ethReserve.toString()),
        tokenReserve: BigInt(tokenReserve.toString()),
        totalTokensSold: BigInt(totalTokensSold.toString()),
        graduated,
        launchId: Number(launchId),
      };
    } catch (e) {
      this.logger.error(`Error getting pool state for ${bondingCurve}`, e);
      return null;
    }
  }

  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    const _srcToken = srcToken.address.toLowerCase();
    const _destToken = destToken.address.toLowerCase();

    const launches = await this.getActiveLaunches(blockNumber);
    
    const poolIdentifiers: string[] = [];

    for (const launch of launches) {
      const tokenAddress = launch.token.toLowerCase();
      const isTokenInvolved = tokenAddress === _srcToken || tokenAddress === _destToken;
      const isBNBInvolved = _srcToken === BNB_ADDRESS || _destToken === BNB_ADDRESS;

      if (isTokenInvolved && isBNBInvolved) {
        poolIdentifiers.push(launch.bondingCurve);
      }
    }

    return [...new Set(poolIdentifiers)];
  }

  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<FairylaunchData>> {
    try {
      let pools: string[];

      if (limitPools && limitPools.length > 0) {
        const validPools: string[] = [];
        for (const pool of limitPools) {
          const state = await this.getPoolState(pool, blockNumber);
          if (state && !state.graduated) {
            const tokenAddress = state.token.toLowerCase();
            const isTokenInvolved = 
              tokenAddress === srcToken.address.toLowerCase() ||
              tokenAddress === destToken.address.toLowerCase();
            const isBNBInvolved = 
              srcToken.address.toLowerCase() === BNB_ADDRESS ||
              destToken.address.toLowerCase() === BNB_ADDRESS;
            
            if (isTokenInvolved && isBNBInvolved) {
              validPools.push(pool);
            }
          }
        }
        pools = validPools;
      } else {
        pools = await this.getPoolIdentifiers(srcToken, destToken, side, blockNumber);
      }

      if (pools.length === 0) return null;

      // CORRECCIÓN BOT 1: Decidir quoteBuy vs quoteSell basado en srcToken
      // En ParaSwap: SwapSide.BUY = exact-output, SwapSide.SELL = exact-input
      // No significa "comprar con BNB" o "vender por BNB"
      const isBuyingTokens = srcToken.address.toLowerCase() === BNB_ADDRESS;
      const quoteFunction = isBuyingTokens ? 'quoteBuy' : 'quoteSell';

      const poolPrices = await Promise.all(
        pools.map(async (pool) => {
          const state = await this.getPoolState(pool, blockNumber);
          if (!state || state.graduated) return null;

          const contract = new this.dexHelper.web3Provider.eth.Contract(
            BondingCurveABI as any,
            pool,
          );

          const prices = await Promise.all(
            amounts.map(async (amount) => {
              if (amount === 0n) return 0n;
              
              try {
                const result = await contract.methods[quoteFunction](amount.toString()).call({}, blockNumber);
                return BigInt(result.toString());
              } catch (e) {
                this.logger.warn(`Quote failed for amount ${amount}: ${(e as Error).message}`);
                return 0n;
              }
            }),
          );

          const allZeroAmounts = amounts.every(a => a === 0n);
          const hasValidPrice = prices.some(p => p > 0n);
          if (!hasValidPrice && !allZeroAmounts) return null;

          return {
            prices,
            unit: getBigIntPow(18),
            data: {
              exchange: pool,
              token: state.token,
              ethReserve: state.ethReserve,
              tokenReserve: state.tokenReserve,
              totalTokensSold: state.totalTokensSold,
              graduated: state.graduated,
              launchId: state.launchId,
            },
            poolIdentifier: pool,
            exchange: this.dexKey,
            gasCost: FAIRY_LAUNCH_GAS_COST,
            poolAddresses: [pool],
          };
        }),
      );

      return poolPrices.filter((p): p is NonNullable<typeof p> => p !== null);
    } catch (e) {
      this.logger.error('Error getting prices', e);
      return null;
    }
  }

  getCalldataGasCost(
    poolPrices: PoolPrices<FairylaunchData>,
  ): number | number[] {
    return FAIRY_LAUNCH_GAS_COST;
  }

  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: FairylaunchData,
    side: SwapSide,
  ): AdapterExchangeParam {
    const { exchange } = data;
    
    // CORRECCIÓN BOT 1: Decidir buy vs sell basado en srcToken
    const isBuyingTokens = srcToken.toLowerCase() === BNB_ADDRESS;
    
    const deadline = Math.floor(Date.now() / 1000) + 1200;
    
    const swapData = isBuyingTokens
      ? bondingCurveIface.encodeFunctionData('buy', [destAmount, deadline])
      : bondingCurveIface.encodeFunctionData('sell', [srcAmount, destAmount, deadline]);

    const payload = this.abiCoder.encodeParameter(
      {
        ParentStruct: {
          target: 'address',
          callData: 'bytes',
          value: 'uint256',
        },
      },
      { 
        target: exchange, 
        callData: swapData, 
        value: isBuyingTokens ? srcAmount : '0' 
      },
    );

    return {
      targetExchange: exchange,
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
    data: FairylaunchData,
    side: SwapSide,
  ): DexExchangeParam {
    const { exchange } = data;
    
    // CORRECCIÓN BOT 1: Decidir buy vs sell basado en srcToken
    const isBuyingTokens = srcToken.toLowerCase() === BNB_ADDRESS;
    
    const deadline = Math.floor(Date.now() / 1000) + 1200;
    
    const exchangeData = isBuyingTokens
      ? bondingCurveIface.encodeFunctionData('buy', [destAmount, deadline])
      : bondingCurveIface.encodeFunctionData('sell', [srcAmount, destAmount, deadline]);

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: false,
      exchangeData,
      targetExchange: exchange,
      spender: exchange,
      returnAmountPos: 0,
    };
  }

  async updatePoolState(): Promise<void> {
    this.launchesCache.clear();
  }

  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    try {
      const latestBlock = await this.dexHelper.web3Provider.eth.getBlockNumber();
      const launches = await this.getActiveLaunches(latestBlock);
      
      const pools: PoolLiquidity[] = [];

      for (const launch of launches) {
        if (launch.token.toLowerCase() === tokenAddress.toLowerCase()) {
          const state = await this.getPoolState(launch.bondingCurve, latestBlock);
          if (!state || state.graduated) continue;

          const liquidityBNB = Number(state.ethReserve) / 1e18;
          const liquidityUSD = liquidityBNB * 300;

          pools.push({
            exchange: this.dexKey,
            address: launch.bondingCurve,
            connectorTokens: [
              {
                address: ETHER_ADDRESS,
                decimals: 18,
              },
            ],
            liquidityUSD,
          });

          if (pools.length >= limit) break;
        }
      }

      return pools;
    } catch (e) {
      this.logger.error('Error getting top pools', e);
      return [];
    }
  }

  releaseResources(): AsyncOrSync<void> {
    this.launchesCache.clear();
  }
}
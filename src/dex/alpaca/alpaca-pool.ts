import { Interface } from '@ethersproject/abi';
import { DeepReadonly } from 'ts-essentials';
import { Log, Logger } from '../../types';
import { catchParseLogError } from '../../utils';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { IDexHelper } from '../../dex-helper/idex-helper';
import {
  DexParams,
  IPriceFeedState,
  IInvestPoolProps,
  PoolState,
  PriceFeed,
  IVaultState,
  ICallData,
} from './types';
import { AlpacaConfig, FETCH_TIMEOUT, LatestPriceFeedsURL } from './config';
import LiquidityFacetABI from '../../abi/alpaca/LiquidityFacet.json';
import { BigNumber, constants } from 'ethers';
import { changeDecimalUnit, mulTruncateBN } from './utils';
import GETTERFACETABI from '../../abi/alpaca/GetterFacet.json';
import { InvestPoolEntities } from './investPoolEntities';
import { base64, hexlify } from 'ethers/lib/utils';

export class AlpacaEventPool extends StatefulEventSubscriber<PoolState> {
  public static getterFacetInterface = new Interface(GETTERFACETABI);

  handlers: {
    [event: string]: (
      event: any,
      state: DeepReadonly<PoolState>,
      log: Readonly<Log>,
    ) => DeepReadonly<PoolState> | null;
  } = {};

  logDecoder: (log: Log) => any;

  addressesSubscribed: string[];
  config: DexParams;

  constructor(
    readonly parentName: string,
    protected network: number,
    protected dexHelper: IDexHelper,
    logger: Logger,
    protected alpacaIface = new Interface(LiquidityFacetABI),
  ) {
    super(parentName, 'ALPACA_POOL', dexHelper, logger);

    // TODO: make logDecoder decode logs that
    this.logDecoder = (log: Log) => {
      return this.alpacaIface.parseLog(log);
    };
    this.config = AlpacaConfig[parentName][network];
    this.addressesSubscribed = [this.config.poolDiamond];

    // Add handlers
    this.handlers['Swap'] = this.handleSwap.bind(this);
  }

  /**
   * The function is called every time any of the subscribed
   * addresses release log. The function accepts the current
   * state, updates the state according to the log, and returns
   * the updated state.
   * @param state - Current state of event subscriber
   * @param log - Log released by one of the subscribed addresses
   * @returns Updates state of the event subscriber after the log
   */
  protected processLog(
    state: DeepReadonly<PoolState>,
    log: Readonly<Log>,
  ): DeepReadonly<PoolState> | null {
    try {
      const event = this.logDecoder(log);
      if (event.name in this.handlers) {
        return this.handlers[event.name](event, state, log);
      }
    } catch (e) {
      catchParseLogError(e, this.logger);
    }
    return null;
  }

  /**
   * The function generates state using on-chain calls. This
   * function is called to regenerate state if the event based
   * system fails to fetch events and the local state is no
   * more correct.
   * @param blockNumber - Blocknumber for which the state should
   * should be generated
   * @returns state of the event subscriber at blocknumber
   */
  async generateState(blockNumber: number): Promise<DeepReadonly<PoolState>> {
    const evenState = this.getState(blockNumber);
    if (evenState) return evenState;

    const investPools: IInvestPoolProps[] = await this.getInvestPools();

    const priceFeedState = this._getPriceFeedState(investPools);

    const vaultState = this._getVaultState(investPools);
    return {
      prices: priceFeedState,
      vault: vaultState,
      investPool: investPools,
    };
  }

  handleSwap(
    event: any,
    state: DeepReadonly<PoolState>,
    log: Log,
  ): DeepReadonly<PoolState> | null {
    if (!state) return state;
    return {
      ...state,
      log: {
        account: event.args['account'],
        tokenIn: event.args['tokenIn'],
        tokenOut: event.args['tokenIn'],
        amountIn: event.args['amountIn'].toBigInt(),
        amountOut: event.args['amountOut'].toBigInt(),
        amountOutAfterFee: event.args['amountOutAfterFee'].toBigInt(),
        swapFeeBps: event.args['swapFeeBps'].toBigInt(),
      },
    };
  }

  private _getPriceFeedState(investPools: IInvestPoolProps[]): IPriceFeedState {
    const now = Date.now();
    let priceFeedState: IPriceFeedState = {
      lastUpdatedAt: now,
      prices: {},
    };

    investPools.forEach(investPool => {
      priceFeedState.prices[investPool.tokenAddress] =
        investPool.maxPrice.toBigInt();
    });

    return priceFeedState;
  }

  private _getVaultState(investPools: IInvestPoolProps[]): IVaultState {
    let vaultState: IVaultState = {
      alpAmounts: {},
    };

    investPools.forEach(investPool => {
      vaultState.alpAmounts[investPool.tokenAddress] = mulTruncateBN(
        investPool.liquidity,
        investPool.maxPrice,
      ).toBigInt();
    });

    return vaultState;
  }

  private async _getInvestPoolCalldata(
    tokenAddress: string,
    params: DexParams,
  ): Promise<ICallData[]> {
    const calls: Array<ICallData> = [];
    calls.push({
      target: params.poolDiamond,
      callData:
        AlpacaEventPool.getterFacetInterface.encodeFunctionData(
          'stableSwapFeeBps',
        ),
    });
    calls.push({
      target: params.poolDiamond,
      callData:
        AlpacaEventPool.getterFacetInterface.encodeFunctionData('stableTaxBps'),
    });
    calls.push({
      target: params.poolDiamond,
      callData:
        AlpacaEventPool.getterFacetInterface.encodeFunctionData('swapFeeBps'),
    });
    calls.push({
      target: params.poolDiamond,
      callData:
        AlpacaEventPool.getterFacetInterface.encodeFunctionData('taxBps'),
    });
    calls.push({
      target: params.poolDiamond,
      callData: AlpacaEventPool.getterFacetInterface.encodeFunctionData(
        'liquidityOf',
        [tokenAddress],
      ),
    });
    calls.push({
      target: params.poolDiamond,
      callData: AlpacaEventPool.getterFacetInterface.encodeFunctionData(
        'getStrategyDeltaOf',
        [tokenAddress],
      ),
    });
    calls.push({
      target: params.poolDiamond,
      callData: AlpacaEventPool.getterFacetInterface.encodeFunctionData(
        'reservedOf',
        [tokenAddress],
      ),
    });
    calls.push({
      target: params.poolDiamond,
      callData: AlpacaEventPool.getterFacetInterface.encodeFunctionData(
        'guaranteedUsdOf',
        [tokenAddress],
      ),
    });
    calls.push({
      target: params.poolDiamond,
      callData: AlpacaEventPool.getterFacetInterface.encodeFunctionData(
        'shortSizeOf',
        [tokenAddress],
      ),
    });
    calls.push({
      target: params.poolDiamond,
      callData: AlpacaEventPool.getterFacetInterface.encodeFunctionData(
        'shortAveragePriceOf',
        [tokenAddress],
      ),
    });
    calls.push({
      target: params.poolDiamond,
      callData: AlpacaEventPool.getterFacetInterface.encodeFunctionData(
        'tokenMetas',
        [tokenAddress],
      ),
    });
    calls.push({
      target: params.poolDiamond,
      callData:
        AlpacaEventPool.getterFacetInterface.encodeFunctionData(
          'isDynamicFeeEnable',
        ),
    });
    calls.push({
      target: params.poolDiamond,
      callData:
        AlpacaEventPool.getterFacetInterface.encodeFunctionData(
          'additionalAum',
        ),
    });
    calls.push({
      target: params.poolDiamond,
      callData:
        AlpacaEventPool.getterFacetInterface.encodeFunctionData(
          'discountedAum',
        ),
    });
    calls.push({
      target: params.poolDiamond,
      callData: AlpacaEventPool.getterFacetInterface.encodeFunctionData(
        'getFundingFeeAccounting',
      ),
    });

    return calls;
  }

  private _genLatestPriceFeedsURL(): string {
    let url = LatestPriceFeedsURL + '?';
    let pythIds = '';
    for (const token of Object.values(this.config.alpacaPoolTokens)) {
      pythIds += 'ids[]=' + token.priceId + '&';
    }
    url += pythIds + 'verbose=false&binary=true';
    return url;
  }

  private async _getPrices(): Promise<PriceFeed[]> {
    const url = this._genLatestPriceFeedsURL();
    const priceFeeds = await this.dexHelper.httpRequest.get<PriceFeed[]>(
      url,
      FETCH_TIMEOUT,
    );
    return priceFeeds;
  }

  public async getInvestPools(): Promise<IInvestPoolProps[]> {
    const investPoolCallDatas: ICallData[] = [];
    let callLength = 0;
    for (const token of Object.values(this.config.alpacaPoolTokens)) {
      const investPoolCallData = await this._getInvestPoolCalldata(
        token.address,
        this.config,
      );

      investPoolCallDatas.push(...investPoolCallData);
      callLength = investPoolCallData.length;
    }

    const res = (
      await this.dexHelper.multiContract.methods
        .aggregate(investPoolCallDatas)
        .call()
    ).returnData;

    const prices = await this._getPrices();

    const investPools: IInvestPoolProps[] = [];

    for (const [i, poolToken] of Object.values(
      this.config.alpacaPoolTokens,
    ).entries()) {
      investPools.push({
        tokenAddress: poolToken.address,
        stableSwapFeeRate:
          AlpacaEventPool.getterFacetInterface.decodeFunctionResult(
            'stableSwapFeeBps',
            res[0 + i * callLength],
          )[0],
        stableTaxRate:
          AlpacaEventPool.getterFacetInterface.decodeFunctionResult(
            'stableTaxBps',
            res[1 + i * callLength],
          )[0],
        swapFeeRate: AlpacaEventPool.getterFacetInterface.decodeFunctionResult(
          'swapFeeBps',
          res[2 + i * callLength],
        )[0],
        taxRate: AlpacaEventPool.getterFacetInterface.decodeFunctionResult(
          'taxBps',
          res[3 + i * callLength],
        )[0],
        liquidity: AlpacaEventPool.getterFacetInterface.decodeFunctionResult(
          'liquidityOf',
          res[4 + i * callLength],
        )[0],
        isStrategyProfit:
          AlpacaEventPool.getterFacetInterface.decodeFunctionResult(
            'getStrategyDeltaOf',
            res[5 + i * callLength],
          )[0],
        strategyDelta:
          AlpacaEventPool.getterFacetInterface.decodeFunctionResult(
            'getStrategyDeltaOf',
            res[5 + i * callLength],
          )[1],
        reservedOf: AlpacaEventPool.getterFacetInterface.decodeFunctionResult(
          'reservedOf',
          res[6 + i * callLength],
        )[0],
        guaranteedUsdOfE30:
          AlpacaEventPool.getterFacetInterface.decodeFunctionResult(
            'guaranteedUsdOf',
            res[7 + i * callLength],
          )[0],
        shortSizeOfE30:
          AlpacaEventPool.getterFacetInterface.decodeFunctionResult(
            'shortSizeOf',
            res[8 + i * callLength],
          )[0],
        shortAveragePriceOfE30:
          AlpacaEventPool.getterFacetInterface.decodeFunctionResult(
            'shortAveragePriceOf',
            res[9 + i * callLength],
          )[0],
        tokenMetas: {
          accept: AlpacaEventPool.getterFacetInterface.decodeFunctionResult(
            'tokenMetas',
            res[10 + i * callLength],
          )[0][0],
          isStable: AlpacaEventPool.getterFacetInterface.decodeFunctionResult(
            'tokenMetas',
            res[10 + i * callLength],
          )[0][1],
          isShortable:
            AlpacaEventPool.getterFacetInterface.decodeFunctionResult(
              'tokenMetas',
              res[10 + i * callLength],
            )[0][2],
          decimals: AlpacaEventPool.getterFacetInterface.decodeFunctionResult(
            'tokenMetas',
            res[10 + i * callLength],
          )[0][3],
          weight: AlpacaEventPool.getterFacetInterface.decodeFunctionResult(
            'tokenMetas',
            res[10 + i * callLength],
          )[0][4],
          minProfitBps:
            AlpacaEventPool.getterFacetInterface.decodeFunctionResult(
              'tokenMetas',
              res[10 + i * callLength],
            )[0][5],
          usdDebtCeiling:
            AlpacaEventPool.getterFacetInterface.decodeFunctionResult(
              'tokenMetas',
              res[10 + i * callLength],
            )[0][6],
          shortCeiling:
            AlpacaEventPool.getterFacetInterface.decodeFunctionResult(
              'tokenMetas',
              res[10 + i * callLength],
            )[0][7],
          bufferLiquidity:
            AlpacaEventPool.getterFacetInterface.decodeFunctionResult(
              'tokenMetas',
              res[10 + i * callLength],
            )[0][8],
          openInterestLongCeiling:
            AlpacaEventPool.getterFacetInterface.decodeFunctionResult(
              'tokenMetas',
              res[10 + i * callLength],
            )[0][9],
        },
        maxPrice: changeDecimalUnit(
          BigNumber.from(prices[i].price.price),
          Math.abs(prices[i].ema_price.expo),
          18,
        ),
        minPrice: changeDecimalUnit(
          BigNumber.from(prices[i].price.price),
          Math.abs(prices[i].ema_price.expo),
          18,
        ),
        priceUpdateData: hexlify(base64.decode(prices[i].vaa)),
        isDynamicFeeEnable:
          AlpacaEventPool.getterFacetInterface.decodeFunctionResult(
            'isDynamicFeeEnable',
            res[11 + i * callLength],
          )[0],
        additionalAum:
          AlpacaEventPool.getterFacetInterface.decodeFunctionResult(
            'additionalAum',
            res[12 + i * callLength],
          )[0],
        discountedAum:
          AlpacaEventPool.getterFacetInterface.decodeFunctionResult(
            'discountedAum',
            res[13 + i * callLength],
          )[0],
        fundingFeePayableE30:
          AlpacaEventPool.getterFacetInterface.decodeFunctionResult(
            'getFundingFeeAccounting',
            res[14 + i * callLength],
          )[0],
        fundingFeeReceivableE30:
          AlpacaEventPool.getterFacetInterface.decodeFunctionResult(
            'getFundingFeeAccounting',
            res[14 + i * callLength],
          )[1],
      });
    }
    return investPools;
  }
}

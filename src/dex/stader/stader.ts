import { Interface, JsonFragment } from '@ethersproject/abi';
import { NumberAsString, SwapSide } from '@paraswap/core';
import {
  AdapterExchangeParam,
  Address,
  DexExchangeParam,
  ExchangePrices,
  Logger,
  PoolLiquidity,
  PoolPrices,
  Token,
} from '../../types';
import { IDexTxBuilder } from '../idex';
import SSPMAbi from '../../abi/SSPM.json';
import StadeOracleAbi from '../../abi/StaderOracle.json';
import {
  ETHER_ADDRESS,
  Network,
  NO_USD_LIQUIDITY,
  NULL_ADDRESS,
  UNLIMITED_USD_LIQUIDITY,
} from '../../constants';
import { IDexHelper } from '../../dex-helper';
import { SimpleExchange } from '../simple-exchange';
import { BI_POWS } from '../../bigint-constants';
import { AsyncOrSync } from 'ts-essentials';
import { ETHxEventPool } from './stader-pool';
import { StaderData, SSPMFunctions } from './types';
import { StaderConfig } from './config';
import { WethFunctions } from '../weth/types';
import ERC20ABI from '../../abi/erc20.json';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import _ from 'lodash';
import { extractReturnAmountPosition } from '../../executor/utils';
import { getDexKeysWithNetwork, isETHAddress } from '../../utils';

export class Stader
  extends SimpleExchange
  implements IDexTxBuilder<StaderData, any>
{
  static dexKeys = ['Stader'];
  ETHxAddress: string;
  SSPM_Address: string;
  SSPMInterface: Interface;
  StaderOracleAddress: string;
  StaderOracleInterface: Interface;
  erc20Interface: Interface;
  needWrapNative = false;
  ethxPool: ETHxEventPool;
  logger: Logger;
  hasConstantPriceLargeAmounts: boolean = true;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(_.pick(StaderConfig, ['Stader']));

  constructor(
    protected network: Network,
    dexKey: string,
    dexHelper: IDexHelper,
    protected config = StaderConfig[dexKey][network],
  ) {
    super(dexHelper, 'Stader');
    this.network = dexHelper.config.data.network;
    this.ETHxAddress = this.config.ETHx.toLowerCase();
    this.SSPM_Address = this.config.SSPM.toLowerCase();
    this.SSPMInterface = new Interface(SSPMAbi as JsonFragment[]);
    this.StaderOracleAddress = this.config.StaderOracle.toLowerCase();
    this.StaderOracleInterface = new Interface(
      StadeOracleAbi as JsonFragment[],
    );
    this.erc20Interface = new Interface(ERC20ABI);
    this.logger = dexHelper.getLogger(this.dexKey);
    this.ethxPool = new ETHxEventPool(
      this.dexKey,
      dexHelper,
      this.StaderOracleAddress,
      this.StaderOracleInterface,
      this.logger,
    );
  }

  getAdapterParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    data: StaderData,
    side: SwapSide,
  ): AdapterExchangeParam {
    return {
      targetExchange: NULL_ADDRESS,
      payload: '0x',
      networkFee: '0',
    };
  }

  async initializePricing(blockNumber: number) {
    await this.ethxPool.initialize(blockNumber);
  }

  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amountsIn: bigint[],
    side: SwapSide,
    blockNumber: number,
  ): Promise<ExchangePrices<StaderData> | null> {
    if (side === SwapSide.BUY) return null;
    if (!this.isEligibleSwap(srcToken, destToken)) return null;

    const pool = this.ethxPool;
    const state = await pool.getOrGenerateState(blockNumber);

    const unitIn = BI_POWS[18];
    const unitOut = pool.getPrice(state, unitIn);
    const amountsOut = amountsIn.map(amountIn =>
      pool.getPrice(state, amountIn),
    );

    return [
      {
        prices: amountsOut,
        unit: unitOut,
        data: {},
        exchange: this.dexKey,
        poolIdentifier: `${ETHER_ADDRESS}_${destToken.address}`.toLowerCase(),
        gasCost: 120_000,
        poolAddresses: [destToken.address],
      },
    ];
  }

  isEligibleSwap(srcToken: Token | string, destToken: Token | string): boolean {
    const srcTokenAddress = (
      typeof srcToken === 'string' ? srcToken : srcToken.address
    ).toLowerCase();
    const destTokenAddress = (
      typeof destToken === 'string' ? destToken : destToken.address
    ).toLowerCase();

    return (
      (isETHAddress(srcTokenAddress) || this.isWETH(srcTokenAddress)) &&
      destTokenAddress === this.ETHxAddress
    );
  }

  getDexParam(
    srcToken: Address,
    _destToken: Address,
    srcAmount: NumberAsString,
    _destAmount: NumberAsString,
    _recipient: Address,
    _data: StaderData,
    _side: SwapSide,
  ): DexExchangeParam {
    if (_side === SwapSide.BUY) throw new Error(`Buy not supported`);

    const swapData = this.SSPMInterface.encodeFunctionData(
      SSPMFunctions.deposit,
      [_recipient],
    );

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: true,
      exchangeData: swapData,
      targetExchange: this.config.SSPM.toLowerCase(),
      preSwapUnwrapCalldata: this.isWETH(srcToken)
        ? this.erc20Interface.encodeFunctionData(WethFunctions.withdraw, [
            srcAmount,
          ])
        : undefined,
      returnAmountPos:
        _side === SwapSide.SELL
          ? extractReturnAmountPosition(
              this.SSPMInterface,
              SSPMFunctions.deposit,
            )
          : undefined,
    };
  }

  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    if (side === SwapSide.BUY) return [];

    if (!this.isEligibleSwap(srcToken, destToken)) return [];

    return [`${ETHER_ADDRESS}_${destToken.address}`.toLowerCase()];
  }

  getCalldataGasCost(poolPrices: PoolPrices<StaderData>): number | number[] {
    return CALLDATA_GAS_COST.DEX_OVERHEAD + CALLDATA_GAS_COST.LENGTH_SMALL;
  }

  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return null;
  }

  getTopPoolsForToken(
    tokenAddress: string,
    limit: number,
  ): AsyncOrSync<PoolLiquidity[]> {
    // swaps available only for ETH/WETH to ETHx
    if (isETHAddress(tokenAddress) || this.isWETH(tokenAddress.toLowerCase())) {
      return [
        {
          exchange: this.dexKey,
          address: this.config.ETHx,
          connectorTokens: [
            {
              decimals: 18,
              address: this.config.ETHx,
              liquidityUSD: NO_USD_LIQUIDITY,
            },
          ],
          liquidityUSD: UNLIMITED_USD_LIQUIDITY,
        },
      ];
    }

    if (tokenAddress.toLowerCase() === this.ETHxAddress.toLowerCase()) {
      const eth = ETHER_ADDRESS;
      const weth = this.dexHelper.config.data.wrappedNativeTokenAddress;
      return [eth, weth].map(t => ({
        exchange: this.dexKey,
        address: this.config.ETHx,
        connectorTokens: [
          {
            decimals: 18,
            address: t,
            liquidityUSD: UNLIMITED_USD_LIQUIDITY,
          },
        ],
        liquidityUSD: NO_USD_LIQUIDITY,
      }));
    }

    return [];
  }
}

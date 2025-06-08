import { assert } from 'ts-essentials';
import { Interface } from 'ethers';
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
import { SwapSide, Network, NULL_ADDRESS } from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getDexKeysWithNetwork, getBigIntPow } from '../../utils';
import { Context, IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { IdleDaoData, Param, PoolFunctions, IdleToken } from './types';
import { SimpleExchange } from '../simple-exchange';
import { Config, Adapters } from './config';
import { fetchTokenList_api } from './utils';
import {
  getIdleTokenIfIdleDaoPair,
  setTokensOnNetwork,
  getPoolsByTokenAddress,
  getTokenFromIdleToken,
  getIdleTokenByAddress,
} from './tokens';
import FACTORY_ABI from '../../abi/idle-dao/idle-cdo-factory.json';
import CDO_ABI from '../../abi/idle-dao/idle-cdo.json';
import { extractReturnAmountPosition } from '../../executor/utils';

export const TOKEN_LIST_CACHE_KEY = 'token-list';
const TOKEN_LIST_TTL_SECONDS = 24 * 60 * 60;

export class IdleDao extends SimpleExchange implements IDex<IdleDaoData> {
  readonly hasConstantPriceLargeAmounts = false;
  readonly needWrapNative = true;

  readonly isFeeOnTransferSupported = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(Config);

  logger: Logger;

  private cdo: Interface;
  private factory: Interface;

  private tokenList: IdleToken[] = [];
  private idleDaoAuthToken: string;

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
    protected config = Config[dexKey][network],
    protected adapters = Adapters[network] || {},
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey);
    this.cdo = new Interface(CDO_ABI);
    this.factory = new Interface(FACTORY_ABI);

    const idleDaoAuthToken = dexHelper.config.data.idleDaoAuthToken;
    assert(
      idleDaoAuthToken !== undefined,
      'idleDaoAuthToken auth token is not specified with env variable',
    );

    this.idleDaoAuthToken = idleDaoAuthToken;
  }

  async getTokensList(blockNumber: number): Promise<Record<string, IdleToken>> {
    if (!this.tokenList) {
      this.tokenList = await fetchTokenList_api(
        this.network,
        this.dexHelper,
        this.cdo,
        this.erc20Interface,
        this.dexHelper.multiWrapper,
        this.idleDaoAuthToken,
      );
    }

    return this.tokenList.reduce(
      (acc: Record<string, IdleToken>, idleToken: IdleToken) => {
        return {
          ...acc,
          [idleToken.idleAddress]: idleToken,
        };
      },
      {},
    );
  }

  async initializePricing(blockNumber: number) {
    await this.initializeTokens(blockNumber);
  }

  async initializeTokens(blockNumber?: number) {
    let cachedTokenList = await this.dexHelper.cache.getAndCacheLocally(
      this.dexKey,
      this.network,
      TOKEN_LIST_CACHE_KEY,
      TOKEN_LIST_TTL_SECONDS,
    );

    if (cachedTokenList !== null) {
      const tokens: IdleToken[] = JSON.parse(cachedTokenList);
      setTokensOnNetwork(this.network, tokens, this.dexHelper);

      this.tokenList = tokens;
      return;
    }

    this.tokenList = await fetchTokenList_api(
      this.network,
      this.dexHelper,
      this.cdo,
      this.erc20Interface,
      this.dexHelper.multiWrapper,
      this.idleDaoAuthToken,
      blockNumber,
    );

    await this.dexHelper.cache.setexAndCacheLocally(
      this.dexKey,
      this.network,
      TOKEN_LIST_CACHE_KEY,
      TOKEN_LIST_TTL_SECONDS,
      JSON.stringify(this.tokenList),
    );

    setTokensOnNetwork(this.network, this.tokenList, this.dexHelper);
  }

  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return null;
  }

  private _getPoolIdentifier(srcToken: Token, destToken: Token): string {
    return (
      this.dexKey +
      '_' +
      [srcToken.address.toLowerCase(), destToken.address.toLowerCase()]
        .sort((a, b) => (a > b ? 1 : -1))
        .join('_')
    );
  }

  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
  ): Promise<string[]> {
    const idleToken = getIdleTokenIfIdleDaoPair(
      this.network,
      this.dexHelper.config.wrapETH(srcToken),
      this.dexHelper.config.wrapETH(destToken),
    );

    if (idleToken === null) return [];

    return [this._getPoolIdentifier(srcToken, destToken)];
  }

  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<IdleDaoData>> {
    try {
      const _src = this.dexHelper.config.wrapETH(srcToken);
      const _dst = this.dexHelper.config.wrapETH(destToken);

      // Look for idleToken
      const idleToken = getIdleTokenIfIdleDaoPair(this.network, _src, _dst);
      if (!idleToken) {
        return null;
      }

      const fromIdleToken =
        idleToken.idleAddress.toLowerCase() == _src.address.toLowerCase();

      const tokenPrice = await this.getTokenPrice(idleToken, blockNumber);

      if (!tokenPrice) {
        return null;
      }

      const unitVolume = getBigIntPow(
        (side === SwapSide.SELL ? srcToken : destToken).decimals,
      );

      const prices = [unitVolume, ...amounts].map((amount: bigint) => {
        let output = 0;
        if (side === SwapSide.SELL) {
          // SELL idleToken (amount = 1000000000000000000 AA_idle_cpPOR-USDC, output = 1000000000000000000*tokenPrice/1e18)
          if (fromIdleToken) {
            output = Math.round(
              (parseFloat('' + tokenPrice) * parseFloat('' + amount)) /
                parseFloat(`1e${idleToken.idleDecimals}`),
            );
            // SELL underlyingToken (amount = 1000000 USDC), output = 1000000/tokenPrice*1e18
          } else {
            output = Math.round(
              (parseFloat('' + amount) / parseFloat('' + tokenPrice)) *
                parseFloat(`1e${idleToken.idleDecimals}`),
            );
          }
        } else {
          // BUY idleToken (amount = 1000000 USDC, output = 1000000/tokenPrice*1e18)
          if (fromIdleToken) {
            output = Math.round(
              (parseFloat('' + amount) / parseFloat('' + tokenPrice)) *
                parseFloat(`1e${idleToken.idleDecimals}`),
            );
            // BUY underlyingToken (amount = 1000000000000000000 AA_idle_cpPOR-USDC, output = 1000000000000000000*tokenPrice/1e18)
          } else {
            output = Math.round(
              (parseFloat('' + tokenPrice) * parseFloat('' + amount)) /
                parseFloat(`1e${idleToken.idleDecimals}`),
            );
          }
        }
        return BigInt(output);
      });

      return [
        {
          unit: prices[0],
          prices: prices.slice(1),
          gasCost: this.config.lendingGasCost,
          exchange: this.dexKey,
          data: {
            idleToken: {
              cdoAddress: idleToken.cdoAddress,
              tokenType: idleToken.tokenType,
            },
            fromIdleToken,
          },
          poolAddresses: [fromIdleToken ? srcToken.address : destToken.address],
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

  // Cannot be implemented fully event-based.
  // Rate changes almost every block.
  // rpc-based pricing is only done for limited amount of tokens that are supported
  async getTokenPrice(
    idleToken: IdleToken,
    blockNumber: number,
  ): Promise<bigint | null> {
    if (!idleToken.cdoContract) {
      return null;
    }

    const tranchePrice = await idleToken.cdoContract.methods['virtualPrice'](
      idleToken.idleAddress,
    ).call({}, blockNumber);

    return BigInt(tranchePrice);
  }

  // Returns estimated gas cost of calldata for this DEX in multiSwap
  getCalldataGasCost(poolPrices: PoolPrices<IdleDaoData>): number | number[] {
    return CALLDATA_GAS_COST.DEX_NO_PAYLOAD;
  }

  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: IdleDaoData,
    side: SwapSide,
  ): AdapterExchangeParam {
    return {
      // target exchange is not used by the contract
      targetExchange: NULL_ADDRESS,
      payload: '0x',
      networkFee: '0',
    };
  }

  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: IdleDaoData,
    side: SwapSide,
    _: Context,
    executorAddress: Address,
  ): DexExchangeParam {
    let returnAmountPos = undefined;

    const [Interface, swapCallee, swapFunction, swapFunctionParams] = ((): [
      Interface,
      Address,
      PoolFunctions,
      Param,
    ] => {
      if (data.fromIdleToken) {
        returnAmountPos = extractReturnAmountPosition(
          this.cdo,
          PoolFunctions[`withdraw${data.idleToken.tokenType}`],
        );
        return [
          this.cdo,
          data.idleToken.cdoAddress,
          PoolFunctions[`withdraw${data.idleToken.tokenType}`],
          [srcAmount],
        ];
      }

      returnAmountPos = extractReturnAmountPosition(
        this.cdo,
        PoolFunctions[`deposit${data.idleToken.tokenType}`],
      );
      return [
        this.cdo,
        data.idleToken.cdoAddress,
        PoolFunctions[`deposit${data.idleToken.tokenType}`],
        [srcAmount, recipient],
      ];
    })();

    const exchangeData = Interface.encodeFunctionData(
      swapFunction,
      swapFunctionParams,
    );

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: false,
      exchangeData,
      targetExchange: swapCallee,
      returnAmountPos: side === SwapSide.SELL ? returnAmountPos : undefined,
      skipApproval: data.fromIdleToken,
    };
  }

  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    await this.initializeTokens();
    const idleTokens: IdleToken[] = getPoolsByTokenAddress(
      this.network,
      tokenAddress,
    );

    if (idleTokens.length > 0) {
      return idleTokens
        .map((idleToken: IdleToken) => ({
          // liquidity is infinite, tokens are minted when swapping for idle tokens
          liquidityUSD: 1e8,
          exchange: this.dexKey,
          address: idleToken.cdoAddress,
          connectorTokens: [getTokenFromIdleToken(idleToken)],
        }))
        .slice(0, limit);
    }

    const idleToken = getIdleTokenByAddress(
      this.network,
      tokenAddress.toLowerCase(),
    );

    if (idleToken) {
      return [
        {
          liquidityUSD: 1e9,
          exchange: this.dexKey,
          address: idleToken.cdoAddress,
          connectorTokens: [
            {
              address: idleToken.address,
              decimals: idleToken.decimals,
            },
          ],
        },
      ];
    }

    return [];
  }
}

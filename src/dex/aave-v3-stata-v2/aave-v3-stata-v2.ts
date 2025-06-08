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
import { SwapSide, Network } from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { Utils, getBigIntPow, getDexKeysWithNetwork } from '../../utils';
import { Context, IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import {
  AaveV3StataV2Data,
  Rounding,
  StataFunctions,
  StataToken,
  TokenType,
} from './types';
import { SimpleExchange } from '../simple-exchange';
import { AaveV3StataConfig } from './config';
import { fetchTokenList } from './utils';
import {
  Tokens,
  getTokenFromAddress,
  getTokenType,
  setTokensOnNetwork,
} from './tokens';
import { uint256ToBigInt } from '../../lib/decoders';
import TokenABI from '../../abi/aavev3statav2/Token.json';
import PoolABI from '../../abi/aavev3statav2/Pool.json';
import { extractReturnAmountPosition } from '../../executor/utils';
import { RETURN_AMOUNT_POS_32 } from '../../executor/constants';
import { Interface } from 'ethers';
// import { IStaticATokenLM_ABI } from '@bgd-labs/aave-address-book';
// slimmed down version of @bgd-labs/aave-address-book
// required as version of web3-utils used is buggy
//import IStaticATokenFactory_ABI from '../../abi/aave-v3-stata/StaticATokenFactory.json';

export const TOKEN_LIST_CACHE_KEY = 'stata-v2-token-list';
const TOKEN_LIST_TTL_SECONDS = 24 * 60 * 60; // 1 day
const RAY = BigInt(`1${'0'.repeat(27)}`);

export class AaveV3StataV2
  extends SimpleExchange
  implements IDex<AaveV3StataV2Data>
{
  readonly hasConstantPriceLargeAmounts = false;

  readonly isFeeOnTransferSupported = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(AaveV3StataConfig);

  logger: Logger;

  // static readonly stata = new Interface(IStaticATokenLM_ABI);
  static readonly stata = new Interface(TokenABI);
  static readonly pool = new Interface(PoolABI);

  private state: Record<string, { blockNumber: number; rate: bigint }> = {};

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
    protected config = AaveV3StataConfig[dexKey][network],
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey);
  }

  async initializePricing(blockNumber: number): Promise<void> {
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
      if (Object.keys(Tokens[this.network] ?? {}).length !== 0) return;

      const tokenListParsed = JSON.parse(cachedTokenList);
      setTokensOnNetwork(this.network, tokenListParsed);

      tokenListParsed.forEach((token: StataToken) => {
        this.state[token.address] = {
          blockNumber: 0,
          rate: 0n,
        };
      });
      return;
    }

    let tokenList = await fetchTokenList(
      this.dexHelper.web3Provider,
      this.config,
      this.dexHelper.multiWrapper,
      blockNumber,
    );

    await this.dexHelper.cache.setexAndCacheLocally(
      this.dexKey,
      this.network,
      TOKEN_LIST_CACHE_KEY,
      TOKEN_LIST_TTL_SECONDS,
      JSON.stringify(tokenList),
    );

    setTokensOnNetwork(this.network, tokenList);

    // init state for all tokens as empty
    tokenList.forEach(token => {
      this.state[token.address] = {
        blockNumber: 0,
        rate: 0n,
      };
    });
  }

  // Returns the list of contract adapters (name and index)
  // for a buy/sell. Return null if there are no adapters.
  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return null;
  }

  private _getPoolIdentifier(srcToken: Token, destToken: Token): string {
    return (
      this.dexKey +
      '-' +
      [srcToken.address.toLowerCase(), destToken.address.toLowerCase()]
        .sort((a, b) => (a > b ? 1 : -1))
        .join('_')
    );
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
    return [this._getPoolIdentifier(srcToken, destToken)];
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
  ): Promise<null | ExchangePrices<AaveV3StataV2Data>> {
    const src = getTokenType(this.network, srcToken.address);
    const dest = getTokenType(this.network, destToken.address);

    // one of the tokens must be stata
    if (![src, dest].includes(TokenType.STATA_TOKEN) || src === dest) {
      return null;
    }

    const isSrcStata = src === TokenType.STATA_TOKEN;

    const [stataToken, otherAddressLower] = isSrcStata
      ? [
          getTokenFromAddress(this.network, srcToken.address),
          destToken.address.toLowerCase(),
        ]
      : [
          getTokenFromAddress(this.network, destToken.address),
          srcToken.address.toLowerCase(),
        ];

    // the token itself can only swap from/to underlying and aToken, so
    // - at least one must be stata
    // - maximum one can be stata
    // - second one must be underlying or aUnderlying
    // on the buy side (mint, withdraw) we only support the underlying<->stata conversion, not the aUnderlying
    if (side === SwapSide.SELL) {
      if (
        otherAddressLower !== stataToken.underlying.toLowerCase() &&
        otherAddressLower !== stataToken.underlyingAToken.toLowerCase()
      ) {
        return null;
      }
    } else {
      if (otherAddressLower !== stataToken.underlying.toLowerCase()) {
        return null;
      }
    }

    const stataAddressLower = stataToken.address.toLowerCase();

    if (
      !this.state[stataAddressLower]?.blockNumber ||
      blockNumber > this.state[stataAddressLower].blockNumber
    ) {
      const results = await this.dexHelper.multiWrapper.tryAggregate<bigint>(
        true,
        [
          {
            target: stataToken.pool,
            callData: AaveV3StataV2.pool.encodeFunctionData(
              'getReserveNormalizedIncome',
              [stataToken.underlying],
            ),
            decodeFunction: uint256ToBigInt,
          },
        ],
        blockNumber,
      );
      this.state[stataAddressLower] = {
        blockNumber,
        rate: results[0].returnData,
      };
    }

    return [
      {
        prices: amounts.map(amount => {
          const rate = this.state[stataAddressLower].rate;
          if (side === SwapSide.SELL) {
            if (isSrcStata) {
              return this.previewRedeem(amount, rate);
            } else {
              return this.previewDeposit(amount, rate);
            }
          } else {
            if (isSrcStata) {
              return this.previewWithdraw(amount, rate);
            } else {
              return this.previewMint(amount, rate);
            }
          }
        }),
        unit: getBigIntPow(
          (side === SwapSide.SELL ? destToken : srcToken).decimals,
        ),
        gasCost: 270000, // 250_000 from underlying, far less from aToken
        exchange: this.dexKey,
        data: {
          srcType: src,
          destType: dest,
          exchange: stataToken.address,
        },
        poolAddresses: [stataAddressLower],
      },
    ];
  }

  getCalldataGasCost(
    poolPrices: PoolPrices<AaveV3StataV2Data>,
  ): number | number[] {
    return CALLDATA_GAS_COST.DEX_NO_PAYLOAD;
  }

  // Not used for V6
  getAdapterParam(): AdapterExchangeParam {
    return {
      targetExchange: '0x',
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
    data: AaveV3StataV2Data,
    side: SwapSide,
    _: Context,
    executorAddress: Address,
  ): DexExchangeParam {
    const { exchange, srcType, destType } = data;
    let swapData;
    let returnAmountPos = undefined;

    if (side === SwapSide.SELL) {
      if (srcType === TokenType.STATA_TOKEN) {
        // e.g. sell srcAmount 100 srcToken stataUSDC for destToken USDC
        if (destType === TokenType.UNDERLYING) {
          swapData = AaveV3StataV2.stata.encodeFunctionData(
            StataFunctions.redeem,
            [
              srcAmount,
              recipient, // receiver
              executorAddress, // owner
            ],
          );
        } else {
          swapData = AaveV3StataV2.stata.encodeFunctionData(
            StataFunctions.redeemATokens,
            [
              srcAmount,
              recipient, // receiver
              executorAddress, // owner
            ],
          );
        }

        returnAmountPos = RETURN_AMOUNT_POS_32;
      } else {
        if (srcType === TokenType.UNDERLYING) {
          // sell srcAmount 100 srcToken USDC for destToken stataUSDC
          swapData = AaveV3StataV2.stata.encodeFunctionData(
            StataFunctions.deposit,
            [
              srcAmount,
              recipient, // receiver
            ],
          );
          returnAmountPos = extractReturnAmountPosition(
            AaveV3StataV2.stata,
            StataFunctions.deposit,
          );
        } else {
          // sell srcAmount 100 srcToken USDC for destToken stataUSDC
          swapData = AaveV3StataV2.stata.encodeFunctionData(
            StataFunctions.depositATokens,
            [
              srcAmount,
              recipient, // receiver
            ],
          );
          returnAmountPos = extractReturnAmountPosition(
            AaveV3StataV2.stata,
            StataFunctions.depositATokens,
          );
        }
      }
    } else {
      if (srcType === TokenType.STATA_TOKEN) {
        // e.g. buy destAmount 100 destToken USDC for srcToken stataUSDC
        swapData = AaveV3StataV2.stata.encodeFunctionData(
          StataFunctions.withdraw,
          [
            destAmount,
            recipient, // receiver
            executorAddress, // owner
          ],
        );
      } else {
        // e.g. buy destAmount 100 destToken stataUSDC for srcToken USDC
        swapData = AaveV3StataV2.stata.encodeFunctionData(StataFunctions.mint, [
          destAmount,
          recipient,
        ]);
      }
    }

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: true,
      exchangeData: swapData,
      targetExchange: exchange,
      returnAmountPos,
      skipApproval: srcType === TokenType.STATA_TOKEN,
    };
  }

  async updatePoolState(): Promise<void> {}

  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    // only for stata <=> underlying/aToken
    await this.initializeTokens();

    const tokenType = getTokenType(this.network, tokenAddress);

    if (tokenType === TokenType.UNKNOWN) {
      return [];
    }

    const stata = getTokenFromAddress(this.network, tokenAddress);

    if (tokenType === TokenType.STATA_TOKEN) {
      return [
        {
          liquidityUSD: 1e11,
          exchange: this.dexKey,
          address: stata.address,
          connectorTokens: [
            { address: stata.underlying, decimals: stata.decimals },
            { address: stata.underlyingAToken, decimals: stata.decimals },
          ],
        },
      ];
    } else {
      return [
        {
          liquidityUSD: 1e11,
          exchange: this.dexKey,
          address: stata.address,
          connectorTokens: [
            { address: stata.address, decimals: stata.decimals },
          ],
        },
      ];
    }
  }

  // TODO: Move to pool implementation when migrating to event based
  previewRedeem(shares: bigint, rate: bigint) {
    return this._convertToAssets(shares, rate, Rounding.DOWN);
  }

  previewMint(shares: bigint, rate: bigint) {
    return this._convertToAssets(shares, rate, Rounding.UP);
  }

  previewWithdraw(assets: bigint, rate: bigint) {
    return this._convertToShares(assets, rate, Rounding.UP);
  }

  previewDeposit(assets: bigint, rate: bigint) {
    return this._convertToShares(assets, rate, Rounding.DOWN);
  }

  _convertToAssets(shares: bigint, rate: bigint, rounding: Rounding): bigint {
    if (rounding == Rounding.UP) return this.rayMulRoundUp(shares, rate);
    return this.rayMulRoundDown(shares, rate);
  }
  _convertToShares(assets: bigint, rate: bigint, rounding: Rounding): bigint {
    if (rounding == Rounding.UP) return this.rayDivRoundUp(assets, rate);
    return this.rayDivRoundDown(assets, rate);
  }

  rayMulRoundDown(a: bigint, b: bigint): bigint {
    if (a === 0n || b === 0n) {
      return 0n;
    }
    return (a * b) / RAY;
  }

  rayMulRoundUp(a: bigint, b: bigint) {
    if (a === 0n || b === 0n) {
      return 0n;
    }
    return (a * b + RAY - 1n) / RAY;
  }

  rayDivRoundDown(a: bigint, b: bigint) {
    return (a * RAY) / b;
  }

  rayDivRoundUp(a: bigint, b: bigint) {
    return (a * RAY + b - 1n) / b;
  }
}

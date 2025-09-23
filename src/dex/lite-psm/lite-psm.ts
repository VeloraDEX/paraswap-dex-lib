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
  ExchangeTxInfo,
  PreprocessTransactionOptions,
} from '../../types';
import { SwapSide, Network } from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import {
  getDexKeysWithNetwork,
  getBigIntPow,
  uuidToBytes16,
} from '../../utils';
import { IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import {
  LitePsmData,
  PoolState,
  PoolConfig,
  LitePsmParams,
  LitePsmDirectPayload,
} from './types';
import { SimpleExchange } from '../simple-exchange';
import { LitePsmConfig } from './config';
import DaiPsmABI from '../../abi/lite-psm/psm.json';
import UsdsPsmABI from '../../abi/lite-psm/usdsPsm.json';
import { BI_POWS } from '../../bigint-constants';
import { SpecialDex } from '../../executor/types';
import { hexConcat, hexZeroPad, hexlify } from '@ethersproject/bytes';
import {
  ContractMethodV6,
  OptimalSwapExchange,
  ParaSwapVersion,
} from '@paraswap/core';
import { BigNumber } from 'ethers';
import { LitePsmEventPool } from './lite-psm-event-pool';
import { extractReturnAmountPosition } from '../../executor/utils';

const daiPsmInterface = new Interface(DaiPsmABI);
const usdsPsmInterface = new Interface(UsdsPsmABI);
const WAD = BI_POWS[18];

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

export class LitePsm
  extends SimpleExchange
  implements IDex<LitePsmData, LitePsmDirectPayload>
{
  protected eventPools: { [gemAddress: string]: LitePsmEventPool };

  // warning: There is limit on swap
  readonly hasConstantPriceLargeAmounts = true;
  readonly isFeeOnTransferSupported = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(LitePsmConfig);

  logger: Logger;

  constructor(
    protected network: Network,
    dexKey: string,
    protected dexHelper: IDexHelper,
    protected dai: Token = LitePsmConfig[dexKey][network].dai,
    protected usds: Token = LitePsmConfig[dexKey][network].usds,
    protected usdsPsm: Address = LitePsmConfig[dexKey][network].usdsPsmAddress,
    protected vatAddress: Address = LitePsmConfig[dexKey][network].vatAddress,
    protected poolConfigs: PoolConfig[] = LitePsmConfig[dexKey][network].pools,
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey);
    this.eventPools = {};
    poolConfigs.forEach(
      p =>
        (this.eventPools[p.gem.address.toLowerCase()] = new LitePsmEventPool(
          dexKey,
          network,
          dexHelper,
          this.logger,
          p,
          this.vatAddress,
        )),
    );
  }

  static getDirectFunctionNameV6(): string[] {
    return [ContractMethodV6.swapExactAmountInOutOnMakerPSM];
  }

  async initializePricing(blockNumber: number) {
    await this.initializeEventPools(blockNumber);
  }

  private async initializeEventPools(
    blockNumber: number,
    subscribe = true,
  ): Promise<void> {
    await Promise.all(
      Object.values(this.eventPools).map(async eventPool => {
        if (subscribe) {
          await eventPool.initialize(blockNumber);
        } else {
          const state = await eventPool.generateState(blockNumber);
          eventPool.setState(state, blockNumber);
        }
      }),
    );
  }

  // Returns the list of contract adapters (name and index)
  // for a buy/sell. Return null if there are no adapters.
  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return null;
  }

  getEventPool(srcToken: Token, destToken: Token): LitePsmEventPool | null {
    const srcAddress = srcToken.address.toLowerCase();
    const destAddress = destToken.address.toLowerCase();
    return (
      (srcAddress === this.dai.address && this.eventPools[destAddress]) ||
      (destAddress === this.dai.address && this.eventPools[srcAddress]) ||
      (srcAddress === this.usds.address && this.eventPools[destAddress]) ||
      (destAddress === this.usds.address && this.eventPools[srcAddress]) ||
      null
    );
  }

  // Returns list of pool identifiers that can be used
  // for a given swap. poolIdentifiers must be unique
  // across DEXes.
  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    const eventPool = this.getEventPool(srcToken, destToken);
    if (!eventPool) return [];
    return [eventPool.getIdentifier()];
  }

  async getPoolState(
    pool: LitePsmEventPool,
    blockNumber: number,
  ): Promise<PoolState> {
    const eventState = pool.getState(blockNumber);
    if (eventState) return eventState;
    const onChainState = await pool.generateState(blockNumber);
    pool.setState(onChainState, blockNumber);
    return onChainState;
  }

  computePrices(
    isDestGem: boolean,
    to18ConversionFactor: bigint,
    side: SwapSide,
    amounts: bigint[],
    poolState: PoolState,
  ): bigint[] {
    const sellGemCheck = (dart: bigint) => {
      return dart <= poolState.daiBalance;
    };
    const buyGemCheck = (dart: bigint) => {
      return dart <= poolState.gemBalance * to18ConversionFactor;
    };

    return amounts.map(a => {
      if (side === SwapSide.SELL) {
        if (isDestGem) {
          const gemAmt18 = (a * WAD) / (WAD + poolState.tout);
          if (buyGemCheck(gemAmt18)) return gemAmt18 / to18ConversionFactor;
        } else {
          const gemAmt18 = to18ConversionFactor * a;
          if (sellGemCheck(gemAmt18))
            return gemAmt18 - (gemAmt18 * poolState.tin) / WAD;
        }
      } else {
        if (isDestGem) {
          const gemAmt18 = to18ConversionFactor * a;
          if (buyGemCheck(gemAmt18))
            return gemAmt18 + (gemAmt18 * poolState.tout) / WAD;
        } else {
          const gemAmt18 = (a * WAD) / (WAD - poolState.tin);
          if (sellGemCheck(gemAmt18)) return gemAmt18 / to18ConversionFactor;
        }
      }
      return 0n;
    });
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
  ): Promise<null | ExchangePrices<LitePsmData>> {
    const eventPool = this.getEventPool(srcToken, destToken);
    if (!eventPool) return null;

    const poolIdentifier = eventPool.getIdentifier();
    if (limitPools && !limitPools.includes(poolIdentifier)) return null;

    const poolState = await this.getPoolState(eventPool, blockNumber);

    const unitVolume = getBigIntPow(
      (side === SwapSide.SELL ? srcToken : destToken).decimals,
    );

    const srcLower = srcToken.address.toLowerCase();
    const isSrcDai = srcLower === this.dai.address;
    const isDaiSwap =
      isSrcDai || destToken.address.toLowerCase() === this.dai.address;

    const isDestGem = isSrcDai || srcLower === this.usds.address;

    const gem = isDestGem ? destToken : srcToken;
    const toll =
      (side === SwapSide.SELL && isDestGem) ||
      (side === SwapSide.BUY && !isDestGem)
        ? poolState.tout
        : poolState.tin;

    const [unit, ...prices] = this.computePrices(
      isDestGem,
      eventPool.to18ConversionFactor,
      side,
      [unitVolume, ...amounts],
      poolState,
    );

    const psm = isDaiSwap ? eventPool.poolConfig.psmAddress : this.usdsPsm;
    return [
      {
        prices,
        unit,
        data: {
          toll: toll.toString(),
          psmAddress: psm,
          gemDecimals: gem.decimals,
        },
        poolAddresses: [psm],
        exchange: this.dexKey,
        gasCost: 50000,
        poolIdentifiers: [poolIdentifier],
      },
    ];
  }

  // Returns estimated gas cost of calldata for this DEX in multiSwap
  getCalldataGasCost(poolPrices: PoolPrices<LitePsmData>): number | number[] {
    return (
      CALLDATA_GAS_COST.DEX_OVERHEAD +
      CALLDATA_GAS_COST.LENGTH_SMALL +
      CALLDATA_GAS_COST.ADDRESS +
      // TODO: pools have toll as zero currently but may change
      CALLDATA_GAS_COST.ZERO +
      // Either 1 (18 decimals) or 1e12 = 0xe8d4a51000 (6 decimals)
      CALLDATA_GAS_COST.wordNonZeroBytes(
        poolPrices.data.gemDecimals === 6 ? 4 : 1,
      )
    );
  }

  getPsmParams(
    srcToken: string,
    srcAmount: string,
    destAmount: string,
    data: LitePsmData,
    side: SwapSide,
  ): { isGemSell: boolean; gemAmount: string } {
    const isDestGem =
      srcToken.toLowerCase() === this.dai.address ||
      srcToken.toLowerCase() === this.usds.address;
    const to18ConversionFactor = getBigIntPow(18 - data.gemDecimals);
    if (side === SwapSide.SELL) {
      if (isDestGem) {
        const gemAmt18 = (BigInt(srcAmount) * WAD) / (WAD + BigInt(data.toll));
        return {
          isGemSell: false,
          gemAmount: (gemAmt18 / to18ConversionFactor).toString(),
        };
      } else {
        return { isGemSell: true, gemAmount: srcAmount };
      }
    } else {
      if (isDestGem) {
        return { isGemSell: false, gemAmount: destAmount };
      } else {
        const gemAmt = ceilDiv(
          BigInt(destAmount) * WAD,
          (WAD - BigInt(data.toll)) * to18ConversionFactor,
        );
        return {
          isGemSell: true,
          gemAmount: gemAmt.toString(),
        };
      }
    }
  }

  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: LitePsmData,
    side: SwapSide,
  ): AdapterExchangeParam {
    return {
      targetExchange: '0x',
      networkFee: '0',
      payload: '0x',
    };
  }

  getTokenFromAddress(address: Address): Token {
    return { address, decimals: 0 };
  }

  async preProcessTransaction?(
    optimalSwapExchange: OptimalSwapExchange<LitePsmData>,
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    options: PreprocessTransactionOptions,
  ): Promise<[OptimalSwapExchange<LitePsmData>, ExchangeTxInfo]> {
    if (!optimalSwapExchange.data) {
      throw new Error(
        `Error_${this.dexKey}_preProcessTransaction payload is not received`,
      );
    }

    let isApproved = false;

    // isApproved is only used in direct method and available only for v6, then no need to check approve for v5
    // because it's either done in getSimpleParam or approve call in the adapter smart contract
    if (options.version === ParaSwapVersion.V6 && options.isDirectMethod) {
      isApproved = await this.dexHelper.augustusApprovals.hasApproval(
        options.executionContractAddress,
        srcToken.address,
        optimalSwapExchange.data.psmAddress,
      );
    }

    return [
      {
        ...optimalSwapExchange,
        data: { ...optimalSwapExchange.data, isApproved },
      },
      {},
    ];
  }

  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: LitePsmData,
    side: SwapSide,
  ): DexExchangeParam {
    const { isGemSell, gemAmount } = this.getPsmParams(
      srcToken,
      srcAmount,
      destAmount,
      data,
      side,
    );

    const isDaiSwap =
      destToken.toLowerCase() === this.dai.address ||
      srcToken.toLowerCase() === this.dai.address;

    let exchangeData = (
      isDaiSwap ? daiPsmInterface : usdsPsmInterface
    ).encodeFunctionData(isGemSell ? 'sellGem' : 'buyGem', [
      recipient,
      gemAmount,
    ]);

    // append toll and to18ConversionFactor & set specialDexFlag = SWAP_ON_MAKER_PSM to
    // - `buyGem` on Ex1 & Ex2
    // - `sellGem` on Ex3
    let specialDexFlag = SpecialDex.DEFAULT;
    if (
      (side === SwapSide.SELL && !isGemSell) ||
      (side === SwapSide.BUY && isGemSell)
    ) {
      exchangeData = hexConcat([
        exchangeData,
        hexZeroPad(hexlify(BigInt(data.toll)), 32),
        hexZeroPad(hexlify(getBigIntPow(18 - data.gemDecimals)), 32),
      ]);
      specialDexFlag = SpecialDex.SWAP_ON_MAKER_PSM;
    }

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: true,
      exchangeData,
      targetExchange: data.psmAddress,
      specialDexFlag,
      spender: data.psmAddress, // psm is the join for both dai and usds
      returnAmountPos:
        side === SwapSide.SELL && isGemSell
          ? extractReturnAmountPosition(
              isDaiSwap ? daiPsmInterface : usdsPsmInterface,
              'sellGem',
              isDaiSwap ? 'daiOutWad' : 'usdsOutWad',
            )
          : undefined,
    };
  }

  getDirectParamV6(
    srcToken: Address,
    destToken: Address,
    fromAmount: NumberAsString,
    toAmount: NumberAsString,
    quotedAmount: NumberAsString,
    data: LitePsmData,
    side: SwapSide,
    permit: string,
    uuid: string,
    partnerAndFee: string,
    beneficiary: string,
    blockNumber: number,
    contractMethod: string,
  ) {
    if (!contractMethod) throw new Error(`contractMethod need to be passed`);
    if (!LitePsm.getDirectFunctionNameV6().includes(contractMethod!)) {
      throw new Error(`Invalid contract method ${contractMethod}`);
    }

    const beneficiaryParam = BigNumber.from(beneficiary);

    const approveParam = !data.isApproved
      ? BigNumber.from(1).shl(255)
      : BigNumber.from(0);
    const directionParam =
      side === SwapSide.SELL ? BigNumber.from(0) : BigNumber.from(1).shl(254);

    const beneficiaryDirectionApproveFlag = beneficiaryParam
      .or(directionParam)
      .or(approveParam);

    const to18ConversionFactor = getBigIntPow(18 - data.gemDecimals);

    const metadata = hexConcat([
      hexZeroPad(uuidToBytes16(uuid), 16),
      hexZeroPad(hexlify(blockNumber), 16),
    ]);

    const params: LitePsmParams = [
      srcToken,
      // not used on the contract, but used for analytics
      destToken,
      fromAmount,
      toAmount,
      data.toll,
      to18ConversionFactor.toString(),
      data.psmAddress,
      data.psmAddress,
      metadata,
      beneficiaryDirectionApproveFlag.toString(),
    ];

    const payload: LitePsmDirectPayload = [params, permit];

    const encoder = (...params: (string | LitePsmDirectPayload)[]) => {
      return this.augustusV6Interface.encodeFunctionData(
        ContractMethodV6.swapExactAmountInOutOnMakerPSM,
        [...params],
      );
    };

    return { params: payload, encoder, networkFee: '0' };
  }

  async updatePoolState(): Promise<void> {
    const blockNumber = await this.dexHelper.web3Provider.eth.getBlockNumber();

    await this.initializeEventPools(blockNumber, false);
  }

  // Returns list of top pools based on liquidity. Max
  // limit number pools should be returned.
  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    const token = tokenAddress.toLowerCase();

    const isDAI = this.dai.address.toLowerCase() === token;
    const isUSDS = this.usds.address.toLowerCase() === token;
    const isDAIorUSDS = isDAI || isUSDS;

    // Liquidity depends on the swapping side hence we simply use the min
    // Its always in terms of stable coin hence liquidityUSD = liquidity
    const minLiq = (poolState: PoolState, decimals: number) => {
      const buyLimit = poolState.gemBalance * getBigIntPow(18 - decimals);
      const sellLimit = poolState.daiBalance;

      const minLimit = buyLimit < sellLimit ? buyLimit : sellLimit;

      const liquidity = Number(minLimit) / Number(BI_POWS[18]);
      return liquidity > 0 ? 2 * liquidity : 0;
    };

    const validPoolConfigs: PoolConfig[] = isDAIorUSDS
      ? this.poolConfigs
      : this.eventPools[token]
      ? [this.eventPools[token].poolConfig]
      : [];

    if (!validPoolConfigs.length) return [];

    const pools = validPoolConfigs.map(config => {
      const eventPoolKey = config.gem.address.toLowerCase();
      const eventPool = this.eventPools[eventPoolKey];
      const state = eventPool?.getStaleState();

      if (!state) return null;

      return {
        exchange: this.dexKey,
        address: config.psmAddress,
        liquidityUSD: minLiq(state, config.gem.decimals),
        connectorTokens: isDAIorUSDS ? [config.gem] : [this.dai, this.usds],
      };
    });

    return pools.filter(p => !!p).slice(0, limit);
  }
}

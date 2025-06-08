import { DeepReadonly } from 'ts-essentials';
import { Contract } from 'web3-eth-contract';
import {
  Token,
  Address,
  ExchangePrices,
  PoolPrices,
  Log,
  AdapterExchangeParam,
  SimpleExchangeParam,
  PoolLiquidity,
  Logger,
  NumberAsString,
  DexExchangeParam,
  ExchangeTxInfo,
  PreprocessTransactionOptions,
} from '../../types';
import { SwapSide, Network } from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import {
  getDexKeysWithNetwork,
  getBigIntPow,
  encodeV6Metadata,
} from '../../utils';
import { IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import {
  MakerPsmData,
  PoolState,
  PoolConfig,
  MakerPsmParams,
  MakerPsmDirectPayload,
} from './types';
import { SimpleExchange } from '../simple-exchange';
import { MakerPsmConfig, Adapters } from './config';
import PsmABI from '../../abi/maker-psm/psm.json';
import VatABI from '../../abi/maker-psm/vat.json';
import { BI_POWS } from '../../bigint-constants';
import { SpecialDex } from '../../executor/types';
import { hexConcat, hexZeroPad, hexlify } from '@ethersproject/bytes';
import {
  ContractMethodV6,
  OptimalSwapExchange,
  ParaSwapVersion,
} from '@paraswap/core';
import { Interface } from 'ethers';

const vatInterface = new Interface(VatABI);
const psmInterface = new Interface(PsmABI);
const WAD = BI_POWS[18];

const bigIntify = (b: any) => BigInt(b.toString());
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

async function getOnChainState(
  multiContract: Contract,
  poolConfigs: PoolConfig[],
  vatAddress: Address,
  blockNumber: number | 'latest',
): Promise<PoolState[]> {
  const callData = poolConfigs
    .map(c => [
      {
        target: c.psmAddress,
        callData: psmInterface.encodeFunctionData('tin', []),
      },
      {
        target: c.psmAddress,
        callData: psmInterface.encodeFunctionData('tout', []),
      },
      {
        target: vatAddress,
        callData: vatInterface.encodeFunctionData('ilks', [c.identifier]),
      },
    ])
    .flat();

  const res = await multiContract.methods
    .aggregate(callData)
    .call({}, blockNumber);

  let i = 0;
  return poolConfigs.map(c => {
    const tin = bigIntify(
      psmInterface.decodeFunctionResult('tin', res.returnData[i++])[0],
    );
    const tout = bigIntify(
      psmInterface.decodeFunctionResult('tout', res.returnData[i++])[0],
    );
    const ilks = vatInterface.decodeFunctionResult('ilks', res.returnData[i++]);
    const Art = bigIntify(ilks.Art);
    const line = bigIntify(ilks.line);
    const rate = bigIntify(ilks.rate);
    return {
      tin,
      tout,
      Art,
      line,
      rate,
    };
  });
}

export class MakerPsmEventPool extends StatefulEventSubscriber<PoolState> {
  handlers: {
    [event: string]: (event: any, pool: PoolState, log: Log) => PoolState;
  } = {};

  logDecoder: (log: Log) => any;

  to18ConversionFactor: bigint;
  bytes32Tout =
    '0x746f757400000000000000000000000000000000000000000000000000000000'; // bytes32('tout')
  bytes32Tin =
    '0x74696e0000000000000000000000000000000000000000000000000000000000'; // bytes32('tin')

  constructor(
    parentName: string,
    protected network: number,
    protected dexHelper: IDexHelper,
    logger: Logger,
    public poolConfig: PoolConfig,
    protected vatAddress: Address,
  ) {
    super(parentName, poolConfig.identifier, dexHelper, logger);

    this.logDecoder = (log: Log) => psmInterface.parseLog(log);
    this.addressesSubscribed = [poolConfig.psmAddress];
    this.to18ConversionFactor = getBigIntPow(18 - poolConfig.gem.decimals);

    // Add handlers
    this.handlers['File'] = this.handleFile.bind(this);
    this.handlers['SellGem'] = this.handleSellGem.bind(this);
    this.handlers['BuyGem'] = this.handleBuyGem.bind(this);
  }

  handleFile(event: any, pool: PoolState, log: Log): PoolState {
    if (event.args.what === this.bytes32Tin) {
      pool.tin = bigIntify(event.args.data);
    } else if (event.args.what === this.bytes32Tout) {
      pool.tout = bigIntify(event.args.data);
    }
    return pool;
  }

  handleSellGem(event: any, pool: PoolState, log: Log): PoolState {
    pool.Art += bigIntify(event.args.value) * this.to18ConversionFactor;
    return pool;
  }

  handleBuyGem(event: any, pool: PoolState, log: Log): PoolState {
    pool.Art -= bigIntify(event.args.value) * this.to18ConversionFactor;
    return pool;
  }

  getIdentifier(): string {
    return `${this.parentName}_${this.poolConfig.psmAddress}`.toLowerCase();
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
      return state;
    } catch (e) {
      this.logger.error(
        `Error_${this.parentName}_processLog could not parse the log with topic ${log.topics}:`,
        e,
      );
      return null;
    }
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
  async generateState(blockNumber: number): Promise<Readonly<PoolState>> {
    return (
      await getOnChainState(
        this.dexHelper.multiContract,
        [this.poolConfig],
        this.vatAddress,
        blockNumber,
      )
    )[0];
  }
}

export class MakerPsm
  extends SimpleExchange
  implements IDex<MakerPsmData, MakerPsmDirectPayload>
{
  protected eventPools: { [gemAddress: string]: MakerPsmEventPool };

  // warning: There is limit on swap
  readonly hasConstantPriceLargeAmounts = true;
  readonly isFeeOnTransferSupported = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(MakerPsmConfig);

  logger: Logger;

  constructor(
    protected network: Network,
    dexKey: string,
    protected dexHelper: IDexHelper,
    protected adapters = Adapters[network],
    protected dai: Token = MakerPsmConfig[dexKey][network].dai,
    protected vatAddress: Address = MakerPsmConfig[dexKey][network].vatAddress,
    protected poolConfigs: PoolConfig[] = MakerPsmConfig[dexKey][network].pools,
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey);
    this.eventPools = {};
    poolConfigs.forEach(
      p =>
        (this.eventPools[p.gem.address.toLowerCase()] = new MakerPsmEventPool(
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
    const poolStates = await getOnChainState(
      this.dexHelper.multiContract,
      this.poolConfigs,
      this.vatAddress,
      blockNumber,
    );
    await Promise.all(
      this.poolConfigs.map(async (p, i) => {
        const eventPool = this.eventPools[p.gem.address.toLowerCase()];
        await eventPool.initialize(blockNumber, {
          state: poolStates[i],
        });
      }),
    );
  }

  // Returns the list of contract adapters (name and index)
  // for a buy/sell. Return null if there are no adapters.
  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return this.adapters[side];
  }

  getEventPool(srcToken: Token, destToken: Token): MakerPsmEventPool | null {
    const srcAddress = srcToken.address.toLowerCase();
    const destAddress = destToken.address.toLowerCase();
    return (
      (srcAddress === this.dai.address && this.eventPools[destAddress]) ||
      (destAddress === this.dai.address && this.eventPools[srcAddress]) ||
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
    pool: MakerPsmEventPool,
    blockNumber: number,
  ): Promise<PoolState> {
    const eventState = pool.getState(blockNumber);
    if (eventState) return eventState;
    const onChainState = await pool.generateState(blockNumber);
    pool.setState(onChainState, blockNumber);
    return onChainState;
  }

  computePrices(
    isSrcDai: boolean,
    to18ConversionFactor: bigint,
    side: SwapSide,
    amounts: bigint[],
    poolState: PoolState,
  ): bigint[] {
    const sellGemCheck = (dart: bigint) =>
      (dart + poolState.Art) * poolState.rate <= poolState.line;
    const buyGemCheck = (dart: bigint) => dart <= poolState.Art;

    return amounts.map(a => {
      if (side === SwapSide.SELL) {
        if (isSrcDai) {
          const gemAmt18 = (a * WAD) / (WAD + poolState.tout);
          if (buyGemCheck(gemAmt18)) return gemAmt18 / to18ConversionFactor;
        } else {
          const gemAmt18 = to18ConversionFactor * a;
          if (sellGemCheck(gemAmt18))
            return gemAmt18 - (gemAmt18 * poolState.tin) / WAD;
        }
      } else {
        if (isSrcDai) {
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
  ): Promise<null | ExchangePrices<MakerPsmData>> {
    const eventPool = this.getEventPool(srcToken, destToken);
    if (!eventPool) return null;

    const poolIdentifier = eventPool.getIdentifier();
    if (limitPools && !limitPools.includes(poolIdentifier)) return null;

    const poolState = await this.getPoolState(eventPool, blockNumber);

    const unitVolume = getBigIntPow(
      (side === SwapSide.SELL ? srcToken : destToken).decimals,
    );

    const isSrcDai = srcToken.address.toLowerCase() === this.dai.address;
    const gem = isSrcDai ? destToken : srcToken;
    const toll =
      (side === SwapSide.SELL && isSrcDai) ||
      (side === SwapSide.BUY && !isSrcDai)
        ? poolState.tout
        : poolState.tin;

    const [unit, ...prices] = this.computePrices(
      isSrcDai,
      eventPool.to18ConversionFactor,
      side,
      [unitVolume, ...amounts],
      poolState,
    );

    return [
      {
        prices,
        unit,
        data: {
          toll: toll.toString(),
          psmAddress: eventPool.poolConfig.psmAddress,
          gemJoinAddress: eventPool.poolConfig.gemJoinAddress,
          gemDecimals: gem.decimals,
        },
        poolAddresses: [eventPool.poolConfig.psmAddress],
        exchange: this.dexKey,
        gasCost: 200 * 1000,
        poolIdentifier,
      },
    ];
  }

  // Returns estimated gas cost of calldata for this DEX in multiSwap
  getCalldataGasCost(poolPrices: PoolPrices<MakerPsmData>): number | number[] {
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
    data: MakerPsmData,
    side: SwapSide,
  ): { isGemSell: boolean; gemAmount: string } {
    const isSrcDai = srcToken.toLowerCase() === this.dai.address;
    const to18ConversionFactor = getBigIntPow(18 - data.gemDecimals);
    if (side === SwapSide.SELL) {
      if (isSrcDai) {
        const gemAmt18 = (BigInt(srcAmount) * WAD) / (WAD + BigInt(data.toll));
        return {
          isGemSell: false,
          gemAmount: (gemAmt18 / to18ConversionFactor).toString(),
        };
      } else {
        return { isGemSell: true, gemAmount: srcAmount };
      }
    } else {
      if (isSrcDai) {
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

  // Encode params required by the exchange adapter
  // Used for multiSwap, buy & megaSwap
  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: MakerPsmData,
    side: SwapSide,
  ): AdapterExchangeParam {
    const to18ConversionFactor = getBigIntPow(18 - data.gemDecimals);
    const payload = this.abiCoder.encodeParameter(
      {
        ParentStruct: {
          gemJoinAddress: 'address',
          toll: 'uint256',
          to18ConversionFactor: 'uint256',
        },
      },
      {
        gemJoinAddress: data.gemJoinAddress,
        toll: data.toll,
        to18ConversionFactor,
      },
    );

    return {
      targetExchange: data.psmAddress,
      networkFee: '0',
      payload,
    };
  }

  // Encode call data used by simpleSwap like routers
  // Used for simpleSwap & simpleBuy
  async getSimpleParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: MakerPsmData,
    side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    const { isGemSell, gemAmount } = this.getPsmParams(
      srcToken,
      srcAmount,
      destAmount,
      data,
      side,
    );

    const swapData = psmInterface.encodeFunctionData(
      isGemSell ? 'sellGem' : 'buyGem',
      [this.augustusAddress, gemAmount],
    );

    return this.buildSimpleParamWithoutWETHConversion(
      srcToken,
      srcAmount,
      destToken,
      destAmount,
      swapData,
      data.psmAddress,
      isGemSell ? data.gemJoinAddress : data.psmAddress,
    );
  }

  getTokenFromAddress(address: Address): Token {
    return { address, decimals: 0 };
  }

  async preProcessTransaction?(
    optimalSwapExchange: OptimalSwapExchange<MakerPsmData>,
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    options: PreprocessTransactionOptions,
  ): Promise<[OptimalSwapExchange<MakerPsmData>, ExchangeTxInfo]> {
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
        srcToken.address.toLowerCase() === this.dai.address.toLowerCase()
          ? optimalSwapExchange.data.psmAddress
          : optimalSwapExchange.data.gemJoinAddress,
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
    data: MakerPsmData,
    side: SwapSide,
  ): DexExchangeParam {
    const { isGemSell, gemAmount } = this.getPsmParams(
      srcToken,
      srcAmount,
      destAmount,
      data,
      side,
    );

    let exchangeData = psmInterface.encodeFunctionData(
      isGemSell ? 'sellGem' : 'buyGem',
      [recipient, gemAmount],
    );

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
      spender: isGemSell ? data.gemJoinAddress : data.psmAddress,
      returnAmountPos: undefined,
    };
  }

  getDirectParamV6(
    srcToken: Address,
    destToken: Address,
    fromAmount: NumberAsString,
    toAmount: NumberAsString,
    quotedAmount: NumberAsString,
    data: MakerPsmData,
    side: SwapSide,
    permit: string,
    uuid: string,
    partnerAndFee: string,
    beneficiary: string,
    blockNumber: number,
    contractMethod: string,
  ) {
    if (!contractMethod) throw new Error(`contractMethod need to be passed`);
    if (!MakerPsm.getDirectFunctionNameV6().includes(contractMethod!)) {
      throw new Error(`Invalid contract method ${contractMethod}`);
    }

    const beneficiaryParam = BigInt(beneficiary);

    const approveParam = !data.isApproved ? 1n << 255n : 0n;
    const directionParam = side === SwapSide.SELL ? 0n : 1n << 254n;

    const beneficiaryDirectionApproveFlag =
      beneficiaryParam | directionParam | approveParam;

    const to18ConversionFactor = getBigIntPow(18 - data.gemDecimals);

    const metadata = encodeV6Metadata(uuid, blockNumber);

    const params: MakerPsmParams = [
      srcToken,
      // not used on the contract, but used for analytics
      destToken,
      fromAmount,
      toAmount,
      data.toll,
      to18ConversionFactor.toString(),
      data.psmAddress,
      data.gemJoinAddress,
      metadata,
      beneficiaryDirectionApproveFlag.toString(),
    ];

    const payload: MakerPsmDirectPayload = [params, permit];

    const encoder = (...params: (string | MakerPsmDirectPayload)[]) => {
      return this.augustusV6Interface.encodeFunctionData(
        ContractMethodV6.swapExactAmountInOutOnMakerPSM,
        [...params],
      );
    };

    return { params: payload, encoder, networkFee: '0' };
  }

  // Returns list of top pools based on liquidity. Max
  // limit number pools should be returned.
  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    const _tokenAddress = tokenAddress.toLowerCase();
    // Liquidity depends on the swapping side hence we simply use the min
    // Its always in terms of stable coin hence liquidityUSD = liquidity
    const minLiq = (poolState: PoolState) => {
      const buyLimit = poolState.Art;
      const sellLimit =
        (poolState.line - poolState.Art * poolState.rate) / poolState.rate;
      return (
        2 *
        parseInt(
          (
            (buyLimit > sellLimit ? sellLimit : buyLimit) / BI_POWS[18]
          ).toString(),
        )
      );
    };

    const isDai = _tokenAddress === this.dai.address;

    const validPoolConfigs = isDai
      ? this.poolConfigs
      : this.eventPools[_tokenAddress]
      ? [this.eventPools[_tokenAddress].poolConfig]
      : [];
    if (!validPoolConfigs.length) return [];

    const poolStates = await getOnChainState(
      this.dexHelper.multiContract,
      validPoolConfigs,
      this.vatAddress,
      'latest',
    );
    return validPoolConfigs.map((p, i) => ({
      exchange: this.dexKey,
      address: p.psmAddress,
      liquidityUSD: minLiq(poolStates[i]),
      connectorTokens: [isDai ? p.gem : this.dai],
    }));
  }
}

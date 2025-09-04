import { defaultAbiCoder, Interface } from '@ethersproject/abi';
import { getAddress } from '@ethersproject/address';
import { keccak256 } from '@ethersproject/keccak256';
import {
  DEST_TOKEN_PARASWAP_TRANSFERS,
  Network,
  SRC_TOKEN_PARASWAP_TRANSFERS,
  SwapSide,
} from '../../constants';
import { IDexHelper } from '../../dex-helper';
import { SpecialDex } from '../../executor/types';
import { applyTransferFee } from '../../lib/token-transfer-fee';
import {
  Token,
  TransferFeeParams,
  ExchangePrices,
  Address,
  DexExchangeParam,
  NumberAsString,
  DexConfigMap,
  SimpleExchangeParam,
} from '../../types';
import { getBigIntPow, getDexKeysWithNetwork } from '../../utils';
import { DexParams, UniswapV2Data } from './types';
import { UniswapV2 } from './uniswap-v2';
import uniswapV2ABI from '../../abi/uniswap-v2/uniswap-v2-pool.json';
import uniswapV2factoryABI from '../../abi/uniswap-v2/uniswap-v2-factory.json';
import RingV2ExchangeRouterABI from '../../abi/uniswap-v2/ring-v2-router.json';
import { extractReturnAmountPosition } from '../../executor/utils';

export enum RingV2Functions {
  swapExactTokensForTokens = 'swapExactTokensForTokens',
  swapExactETHForTokens = 'swapExactETHForTokens',
  swapTokensForExactTokens = 'swapTokensForExactTokens',
  swapTokensForExactETH = 'swapTokensForExactETH',
  swapETHForExactTokens = 'swapETHForExactTokens',
}

const RingV2Config: DexConfigMap<DexParams> = {
  RingV2: {
    [Network.MAINNET]: {
      factoryAddress: '0xeb2A625B704d73e82946D8d026E1F588Eed06416',
      initCode:
        '0xa7ae6a5ec37f0c21bbdac560794258c4089b8ae3ffa6e3909b53c6091764a676',
      poolGasCost: 80 * 1000,
      feeCode: 30,
      router: '0x39d1d8fcC5E6EEAf567Bce4e29B94fec956D3519',
    },
  },
};

const FewWrappedTokenConfig: DexConfigMap<{
  fewWrapFactory: string;
  initCode: string;
}> = {
  RingV2: {
    [Network.MAINNET]: {
      fewWrapFactory: '0x7D86394139bf1122E82FDF45Bb4e3b038A4464DD',
      initCode:
        '0x2bdba5734ddf754fb149ef1faa937956c52cfd1f24d68163a95f42d08ec06d38',
    },
  },
};

export function computeFWTokenAddress(
  originalAddress: string,
  dexKey: string,
  network: Network,
): string {
  const constructorArgumentsEncoded = defaultAbiCoder.encode(
    ['address'],
    [originalAddress],
  );

  const create2Inputs = [
    '0xff',
    FewWrappedTokenConfig[dexKey][network].fewWrapFactory, // factory address
    keccak256(constructorArgumentsEncoded), // salt
    FewWrappedTokenConfig[dexKey][network].initCode, // init code
  ];

  const input = `0x${create2Inputs.map(i => i.slice(2)).join('')}`;

  return getAddress(`0x${keccak256(input).slice(-40)}`);
}

const DefaultRingV2PoolGasCost = 90 * 1000;
const ringV2poolIface = new Interface(uniswapV2ABI);

export class RingV2 extends UniswapV2 {
  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(RingV2Config);

  constructor(
    protected network: Network,
    dexKey: string,
    protected dexHelper: IDexHelper,
    protected isDynamicFees = false,
    protected factoryAddress: Address = RingV2Config[dexKey][network]
      .factoryAddress,
    protected subgraphURL: string | undefined = RingV2Config[dexKey] &&
      RingV2Config[dexKey][network].subgraphURL,
    protected initCode: string = RingV2Config[dexKey][network].initCode,
    // feeCode is ignored when isDynamicFees is set to true
    protected feeCode: number = RingV2Config[dexKey][network].feeCode,
    protected poolGasCost: number = (RingV2Config[dexKey] &&
      RingV2Config[dexKey][network].poolGasCost) ??
      DefaultRingV2PoolGasCost,
    protected decoderIface: Interface = ringV2poolIface,
    protected router = (RingV2Config[dexKey] &&
      RingV2Config[dexKey][network].router) ??
      dexHelper.config.data.uniswapV2ExchangeRouterAddress,
  ) {
    super(
      network,
      dexKey,
      dexHelper,
      isDynamicFees,
      factoryAddress,
      subgraphURL,
      initCode,
      feeCode,
      poolGasCost,
      decoderIface,
      undefined, // adapters being the same as UniswapV2
      router,
    );

    this.factory = new dexHelper.web3Provider.eth.Contract(
      uniswapV2factoryABI as any,
      this.factoryAddress,
    );

    this.exchangeRouterInterface = new Interface(RingV2ExchangeRouterABI);
  }

  getTokenAddresses<T extends string | Token>(_from: T, _to: T): [T, T] {
    const from =
      typeof _from === 'string'
        ? this.dexHelper.config.wrapETH(_from)
        : this.dexHelper.config.wrapETH(_from);

    const to =
      typeof _to === 'string'
        ? this.dexHelper.config.wrapETH(_to)
        : this.dexHelper.config.wrapETH(_to);

    const getFewWrappedToken = (token: T): T => {
      const address = typeof token === 'string' ? token : token.address;

      const fewTokenAddress = computeFWTokenAddress(
        address,
        this.dexKey,
        this.network,
      );

      const newToken =
        typeof token === 'string'
          ? (fewTokenAddress as T)
          : ({
              ...(token as Token),
              address: fewTokenAddress,
              ...(token.symbol ? { symbol: `fw${token.symbol}` } : {}),
            } as T);

      return newToken;
    };

    return [getFewWrappedToken(from as T), getFewWrappedToken(to as T)];
  }

  async getPoolIdentifiers(
    _from: Token,
    _to: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    const [from, to] = this.getTokenAddresses(_from, _to);

    if (from.address.toLowerCase() === to.address.toLowerCase()) {
      return [];
    }

    return [this.getPoolIdentifier(from.address, to.address)];
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
  ): Promise<ExchangePrices<UniswapV2Data> | null> {
    try {
      const [from, to] = this.getTokenAddresses(_from, _to);

      if (from.address.toLowerCase() === to.address.toLowerCase()) {
        return null;
      }

      const poolIdentifier = this.getPoolIdentifier(from.address, to.address);

      if (limitPools && limitPools.every(p => p !== poolIdentifier)) {
        this.logger.debug('Pool not in limitPools');
        return null;
      }

      await this.batchCatchUpPairs([[from, to]], blockNumber);
      const isSell = side === SwapSide.SELL;
      const pairParam = await this.getPairOrderedParams(
        from,
        to,
        blockNumber,
        transferFees.srcDexFee,
      );
      if (!pairParam) {
        this.logger.debug('No pair parameters found');
        return null;
      }

      const unitAmount = getBigIntPow(isSell ? from.decimals : to.decimals);

      const [unitVolumeWithFee, ...amountsWithFee] = applyTransferFee(
        [unitAmount, ...amounts],
        side,
        isSell ? transferFees.srcFee : transferFees.destFee,
        isSell ? SRC_TOKEN_PARASWAP_TRANSFERS : DEST_TOKEN_PARASWAP_TRANSFERS,
      );
      this.logger.debug(
        'Unit Volume With Fee:',
        unitVolumeWithFee,
        'isSell=',
        isSell,
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

      // As ringv2 just has one pool per token pair
      return [
        {
          prices: outputsWithFee,
          unit: unitOutWithFee,
          data: {
            router: this.router,
            path: [from.address.toLowerCase(), to.address.toLowerCase()],
            factory: this.factoryAddress,
            initCode: this.initCode,
            feeFactor: this.feeFactor,
            pools: [
              {
                address: pairParam.exchange,
                fee: parseInt(pairParam.fee),
                direction: pairParam.direction,
              },
            ],
          },
          exchange: this.dexKey,
          poolIdentifiers: [poolIdentifier],
          gasCost: this.poolGasCost,
          poolAddresses: [pairParam.exchange],
        },
      ];
    } catch (e) {
      this.logger.debug('Error in getPricesVolume');

      if (blockNumber === 0)
        this.logger.error(
          `Error_getPricesVolume: Aurelius block manager not yet instantiated`,
        );
      this.logger.error(`Error_getPrices:`, e);
      return null;
    }
  }

  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: UniswapV2Data,
    side: SwapSide,
  ): DexExchangeParam {
    let args: any[];
    let functionName: RingV2Functions;

    let ttl = 1200;
    const deadline = `0x${(
      Math.floor(new Date().getTime() / 1000) + ttl
    ).toString(16)}`;

    if (side == SwapSide.SELL) {
      functionName = RingV2Functions.swapExactTokensForTokens;
      args = [srcAmount, destAmount, data.path, recipient, deadline];
    } else {
      functionName = RingV2Functions.swapTokensForExactTokens;
      args = [destAmount, srcAmount, data.path, recipient, deadline];
    }

    const exchangeData = this.exchangeRouterInterface.encodeFunctionData(
      functionName,
      args,
    );

    return {
      needWrapNative: this.needWrapNative,
      specialDexSupportsInsertFromAmount: true,
      dexFuncHasRecipient: true,
      exchangeData,
      targetExchange: data.router,
      specialDexFlag: SpecialDex.DEFAULT,
      returnAmountPos: extractReturnAmountPosition(
        this.exchangeRouterInterface,
        functionName,
        'amounts',
        1,
      ),
    };
  }

  async getSimpleParam(
    src: Address,
    dest: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    data: UniswapV2Data,
    side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    let args: any[];
    let functionName: RingV2Functions;

    let ttl = 1200;
    const deadline = `0x${(
      Math.floor(new Date().getTime() / 1000) + ttl
    ).toString(16)}`;

    if (side === SwapSide.SELL) {
      functionName = RingV2Functions.swapExactTokensForTokens;
      args = [srcAmount, destAmount, data.path, data.router, deadline];
    } else {
      functionName = RingV2Functions.swapTokensForExactTokens;
      args = [destAmount, srcAmount, data.path, data.router, deadline];
    }

    const exchangeData = this.exchangeRouterInterface.encodeFunctionData(
      functionName,
      args,
    );

    return this.buildSimpleParamWithoutWETHConversion(
      src,
      srcAmount,
      dest,
      destAmount,
      exchangeData,
      data.router,
      data.router,
    );
  }
}

import Web3Abi, { AbiCoder } from 'web3-eth-abi';
import { Contract } from 'web3-eth-contract';
import { Address, SimpleExchangeParam, NumberAsString } from '../types';
import { CACHE_PREFIX } from '../constants';
import SimpleSwapHelperABI from '../abi/SimpleSwapHelperRouter.json';
import ERC20ABI from '../abi/erc20.json';
import augustusABI from '../abi/augustus.json';
import { isETHAddress } from '../utils';
import { MAX_UINT } from '../constants';
import { IDexHelper } from '../dex-helper';
import { AbiItem } from 'web3-utils';
import augustusV6ABI from '../abi/augustus-v6/ABI.json';
import { NeedWrapNativeFunc } from './idex';
import { Interface } from 'ethers';

/*
 * Context: Augustus routers have all a deadline protection logic implemented globally.
 * But some integrations (router, pools,...) require passing a deadline generally as uint256.
 * While this problem can be solved in adapters easily by passing block.timestamp (or block.timestamp +1 for some marginal cases),
 * In the context of direct calls like simpleSwap we have to generate this value offchain.
 * One can naively pick type(uint).max but that would impose a higher gas cost on the calldata.
 * Here we decide to go with a high enough default so that the local deadline rarely supersedes the global router deadline.
 */
export const FRIENDLY_LOCAL_DEADLINE = 7 * 24 * 60 * 60;
export const getLocalDeadlineAsFriendlyPlaceholder = () =>
  String(Math.floor(new Date().getTime() / 1000) + FRIENDLY_LOCAL_DEADLINE);

export class SimpleExchange {
  simpleSwapHelper: Interface;
  protected abiCoder: AbiCoder;
  erc20Interface: Interface;
  erc20Contract: Contract;

  needWrapNative: boolean | NeedWrapNativeFunc = false;
  isFeeOnTransferSupported = false;

  protected augustusAddress: Address;
  protected augustusV6Address: Address | undefined;
  protected augustusInterface: Interface;
  protected augustusV6Interface: Interface;

  protected network: number;

  readonly cacheStateKey: string;

  constructor(protected readonly dexHelper: IDexHelper, public dexKey: string) {
    this.simpleSwapHelper = new Interface(SimpleSwapHelperABI);
    this.erc20Interface = new Interface(ERC20ABI);
    this.erc20Contract = new dexHelper.web3Provider.eth.Contract(
      ERC20ABI as AbiItem[],
    );
    this.abiCoder = Web3Abi as unknown as AbiCoder;

    this.network = dexHelper.config.data.network;
    this.augustusAddress = dexHelper.config.data.augustusAddress;
    this.augustusV6Address = dexHelper.config.data.augustusV6Address;
    this.augustusInterface = new Interface(augustusABI);
    this.augustusV6Interface = new Interface(augustusV6ABI);

    this.cacheStateKey =
      `${CACHE_PREFIX}_${this.network}_${this.dexKey}_states`.toLowerCase();
  }

  protected async getApproveSimpleParam(
    token: Address,
    target: Address,
    amount: string,
  ): Promise<SimpleExchangeParam> {
    const hasAllowance = await this.dexHelper.augustusApprovals.hasApproval(
      this.augustusAddress,
      token,
      target,
    );
    if (hasAllowance) {
      return {
        callees: [],
        calldata: [],
        values: [],
        networkFee: '0',
      };
    }

    const approveCalldata = this.simpleSwapHelper.encodeFunctionData(
      'approve',
      [token, target, MAX_UINT],
    );

    return {
      callees: [this.augustusAddress],
      calldata: [approveCalldata],
      values: ['0'],
      networkFee: '0',
    };
  }

  protected async buildSimpleParamWithoutWETHConversion(
    src: Address,
    srcAmount: NumberAsString,
    dest: Address,
    destAmount: NumberAsString,
    swapCallData: string,
    swapCallee: Address,
    spender?: Address,
    networkFee: NumberAsString = '0',
    preCalls?: Omit<SimpleExchangeParam, 'networkFee'>,
    skipApproval?: boolean,
  ): Promise<SimpleExchangeParam> {
    const approveParam = skipApproval
      ? { callees: [], calldata: [], values: [], networkFee: '0' }
      : await this.getApproveSimpleParam(src, spender || swapCallee, srcAmount);

    const swapValue = (
      BigInt(networkFee) + (isETHAddress(src) ? BigInt(srcAmount) : 0n)
    ).toString();

    return {
      callees: [
        ...(preCalls?.callees || []),
        ...approveParam.callees,
        swapCallee,
      ],
      calldata: [
        ...(preCalls?.calldata || []),
        ...approveParam.calldata,
        swapCallData,
      ],
      values: [...(preCalls?.values || []), ...approveParam.values, swapValue],
      networkFee,
    };
  }

  protected isWETH(tokenAddress: string) {
    const weth =
      this.dexHelper.config.data.wrappedNativeTokenAddress.toLowerCase();

    return tokenAddress.toLowerCase() === weth;
  }
}

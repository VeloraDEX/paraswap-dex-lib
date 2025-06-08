import { UniswapV2, UniswapV2Pair } from './uniswap-v2';
import { Network } from '../../constants';
import { Address, DexConfigMap } from '../../types';
import { IDexHelper } from '../../dex-helper/index';
import { Interface } from '@ethersproject/abi';
import { DexParams } from './types';
import BiSwapPoolABI from '../../abi/uniswap-v2/biswap-pool.json';
import { getDexKeysWithNetwork } from '../../utils';
import { BytesLike } from 'ethers';

export const BiSwapConfig: DexConfigMap<DexParams> = {
  BiSwap: {
    [Network.BSC]: {
      factoryAddress: '0x858e3312ed3a876947ea49d572a7c42de08af7ee',
      initCode:
        '0xfea293c909d87cd4153593f077b76bb7e94340200f4ee84211ae8e4f9bd7ffdf',
      poolGasCost: 120 * 1000,
      feeCode: 0, // this is ignored as BiSwap uses dynamic fees
    },
  },
};

export class BiSwap extends UniswapV2 {
  biSwapPool: Interface;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(BiSwapConfig);

  constructor(
    protected network: Network,
    dexKey: string,
    protected dexHelper: IDexHelper,
  ) {
    super(
      network,
      dexKey,
      dexHelper,
      true,
      BiSwapConfig[dexKey][network].factoryAddress,
      BiSwapConfig[dexKey][network].subgraphURL,
      BiSwapConfig[dexKey][network].initCode,
      BiSwapConfig[dexKey][network].feeCode,
      BiSwapConfig[dexKey][network].poolGasCost,
    );
    this.biSwapPool = new Interface(BiSwapPoolABI);
  }

  protected getFeesMultiCallData(pair: UniswapV2Pair) {
    const callEntry = {
      target: pair.exchange!,
      callData: this.biSwapPool.encodeFunctionData('swapFee', []),
    };
    const callDecoder = (values: BytesLike) =>
      parseInt(
        this.biSwapPool.decodeFunctionResult('swapFee', values)[0].toString(),
      ) * 10;
    return {
      callEntry,
      callDecoder,
    };
  }
}

import { Network } from '../../constants';
import { getDexKeysWithNetwork } from '../../utils';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { UniswapV2, UniswapV2Pair } from '../uniswap-v2/uniswap-v2';
import { Interface } from '@ethersproject/abi';
import NomiswapPoolABI from '../../abi/nomiswap-v2/nomiswap-v2-pool.json';
import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { BytesLike } from 'ethers';

export const NomiswapV2Config: DexConfigMap<DexParams> = {
  NomiswapV2: {
    [Network.BSC]: {
      factoryAddress: '0xd6715A8be3944ec72738F0BFDC739d48C3c29349',
      initCode:
        '0x83eb759f5ea0525124f03d4ac741bb4af0bb1c703d5f694bd42a8bd72e495a01',
      poolGasCost: 120 * 1000,
      feeCode: 0, // this is ignored as Nomiswap uses dynamic fees,
      subgraphURL: '5CBKsDihF7KeBrNX4bgtb4tVFqy41PguVm88zBGpd4Hi',
    },
  },
  // not exactly the same, but swapFee logic works in the same way
  SwaprV2: {
    [Network.GNOSIS]: {
      factoryAddress: '0x5D48C95AdfFD4B40c1AAADc4e08fc44117E02179',
      initCode:
        '0xfcee8e246628cf9708fcb9d6f5d4aa0d96b62bb50f1af012a75a3292849e2dca',
      poolGasCost: 120 * 1000,
      feeCode: 25, // this is ignored as SwaprV2 uses dynamic fees,
      subgraphURL: 'EWoa3JwNntAWtaLsLixTU25smp4R5tzGvs9rFXx9NHKZ',
    },
  },
};

export class NomiswapV2 extends UniswapV2 {
  nomiswapPool: Interface;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(NomiswapV2Config);

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
      NomiswapV2Config[dexKey][network].factoryAddress,
      NomiswapV2Config[dexKey][network].subgraphURL,
      NomiswapV2Config[dexKey][network].initCode,
      NomiswapV2Config[dexKey][network].feeCode,
      NomiswapV2Config[dexKey][network].poolGasCost,
    );
    this.nomiswapPool = new Interface(NomiswapPoolABI);
  }

  protected getFeesMultiCallData(pair: UniswapV2Pair) {
    const callEntry = {
      target: pair.exchange!,
      callData: this.nomiswapPool.encodeFunctionData('swapFee', []),
    };
    const callDecoder = (values: BytesLike) =>
      parseInt(
        this.nomiswapPool.decodeFunctionResult('swapFee', values)[0].toString(),
      ) * 10;
    return {
      callEntry,
      callDecoder,
    };
  }
}

import { defaultAbiCoder } from '@ethersproject/abi';
import { getAddress } from '@ethersproject/address';
import { keccak256 } from '@ethersproject/keccak256';

import BlastIFewWrappedTokenJSON from '../../abi/ring-v2/BlastSepoliaFewWrappedToken.json';
import ETHMainnetFewWrappedTokenJSON from '../../abi/ring-v2/ETHFewWrappedToken.json';
import EVMIFewWrappedTokenJSON from '../../abi/ring-v2/EVMFewWrappedToken.json';
import BlastIMainnetFewWrappedTokenJSON from '../../abi/ring-v2/FewWrappedToken.json';

type ChainConfig = {
  fewWrapFactory: string;
  bytecode: string;
};

const FEW_WRAPPED_FACTORY_CONFIGS: { [key: number]: ChainConfig } = {
  [168587773]: {
    fewWrapFactory: '0xf11788d14EbE6abF4EA02e162C75AD938F1730C1',
    bytecode: BlastIFewWrappedTokenJSON.bytecode,
  },
  [11155111]: {
    fewWrapFactory: '0x226e65279E177A779522864Ce1dE40c85E2C08A5',
    bytecode: EVMIFewWrappedTokenJSON.bytecode,
  },
  [81457]: {
    fewWrapFactory: '0x455b20131D59f01d082df1225154fDA813E8CeE9',
    bytecode: BlastIMainnetFewWrappedTokenJSON.bytecode,
  },
  [1]: {
    fewWrapFactory: '0x7D86394139bf1122E82FDF45Bb4e3b038A4464DD',
    bytecode: ETHMainnetFewWrappedTokenJSON.bytecode,
  },
  // unichain sepolia
  [1301]: {
    fewWrapFactory: '0x7D86394139bf1122E82FDF45Bb4e3b038A4464DD',
    bytecode: ETHMainnetFewWrappedTokenJSON.bytecode,
  },
  // unichain
  [130]: {
    fewWrapFactory: '0x974Cc3F3468cd9C12731108148C4DABFB5eE556F',
    bytecode: ETHMainnetFewWrappedTokenJSON.bytecode,
  },
  // arbitrum sepolia
  [421614]: {
    fewWrapFactory: '0xCc7eb1f253c0A988a4754445CA8c9Ab82C704E53',
    bytecode: ETHMainnetFewWrappedTokenJSON.bytecode,
  },
  // arbitrum mainnet
  [42161]: {
    fewWrapFactory: '0x974Cc3F3468cd9C12731108148C4DABFB5eE556F',
    bytecode: ETHMainnetFewWrappedTokenJSON.bytecode,
  },
  // base
  [8453]: {
    fewWrapFactory: '0xb3Ad7754f363af676dC1C5be40423FE538a47920',
    bytecode: ETHMainnetFewWrappedTokenJSON.bytecode,
  },
  // story odysey
  [1516]: {
    fewWrapFactory: '0xCc7eb1f253c0A988a4754445CA8c9Ab82C704E53',
    bytecode: ETHMainnetFewWrappedTokenJSON.bytecode,
  },
  // story mainnet
  [1514]: {
    fewWrapFactory: '0x974Cc3F3468cd9C12731108148C4DABFB5eE556F',
    bytecode: ETHMainnetFewWrappedTokenJSON.bytecode,
  },
  // bnb chain
  [56]: {
    fewWrapFactory: '0xEeE400Eabfba8F60f4e6B351D8577394BeB972CD',
    bytecode: ETHMainnetFewWrappedTokenJSON.bytecode,
  },
};

export const FEW_WRAPPED_TOKEN_FACTORY_ADDRESS = (chainId: number): string => {
  if (!(chainId in FEW_WRAPPED_FACTORY_CONFIGS))
    throw new Error(
      `Few wrapped token address not deployed on chain ${chainId}`,
    );
  const config = FEW_WRAPPED_FACTORY_CONFIGS[chainId];
  if (!config || !config.fewWrapFactory)
    throw new Error(
      `Few wrapped token factory configuration invalid for chain ${chainId}`,
    );
  return config.fewWrapFactory;
};

export const FEW_WRAPPED_TOKEN_BYTECODE = (chainId: number): string => {
  if (!(chainId in FEW_WRAPPED_FACTORY_CONFIGS))
    throw new Error(
      `Few wrapped token bytecode not deployed on chain ${chainId}`,
    );
  const config = FEW_WRAPPED_FACTORY_CONFIGS[chainId];
  if (!config || !config.bytecode)
    throw new Error(
      `Few wrapped token bytecode configuration invalid for chain ${chainId}`,
    );
  return config.bytecode;
};

import _ from 'lodash';
import {
  ImmutablePoolStateMap,
  CommonMutableState,
  PoolStateMap,
  StableMutableState,
} from './types';
import { BalancerV3Config } from './config';
import { Interface, Result } from 'ethers';
import { IDexHelper } from '../../dex-helper';
import { WAD } from './balancer-v3-pool';

export interface callData {
  target: string;
  callData: string;
}

// Encoding & Decoding for onchain calls to fetch mutable pool data
// Each supported pool type should have its own specific calls if needed
const poolOnChain: Record<
  string,
  {
    count: number;
    encode: (
      network: number,
      contractInterface: Interface,
      address: string,
    ) => callData[];
    decode: (
      contractInterface: Interface,
      poolAddress: string,
      data: any,
      startIndex: number,
    ) => {} | CommonMutableState | StableMutableState;
  }
> = {
  ['COMMON']: {
    count: 6,
    ['encode']: (
      network: number,
      contractInterface: Interface,
      address: string,
    ): callData[] => {
      return [
        {
          target: BalancerV3Config.BalancerV3[network].vaultAddress,
          callData: contractInterface.encodeFunctionData('getPoolTokenRates', [
            address,
          ]),
        },
        {
          target: BalancerV3Config.BalancerV3[network].vaultAddress,
          callData: contractInterface.encodeFunctionData(
            'getCurrentLiveBalances',
            [address],
          ),
        },
        {
          target: BalancerV3Config.BalancerV3[network].vaultAddress,
          callData: contractInterface.encodeFunctionData('getPoolConfig', [
            address,
          ]),
        },
        {
          target: BalancerV3Config.BalancerV3[network].vaultAddress,
          callData: contractInterface.encodeFunctionData('totalSupply', [
            address,
          ]),
        },
        {
          target: BalancerV3Config.BalancerV3[network].vaultAddress,
          callData: contractInterface.encodeFunctionData('isPoolPaused', [
            address,
          ]),
        },
        {
          target: BalancerV3Config.BalancerV3[network].vaultAddress,
          callData: contractInterface.encodeFunctionData('getHooksConfig', [
            address,
          ]),
        },
      ];
    },
    ['decode']: (
      contractInterface: Interface,
      poolAddress: string,
      data: any,
      startIndex: number,
    ): Omit<
      CommonMutableState,
      'erc4626Rates' | 'erc4626MaxDeposit' | 'erc4626MaxMint'
    > => {
      const resultTokenRates = decodeThrowError(
        contractInterface,
        'getPoolTokenRates',
        data[startIndex++],
        poolAddress,
      );
      if (!resultTokenRates)
        throw new Error(
          `Failed to get result for getPoolTokenRates for ${poolAddress}`,
        );
      const resultLiveBalances = decodeThrowError(
        contractInterface,
        'getCurrentLiveBalances',
        data[startIndex++],
        poolAddress,
      );
      if (!resultLiveBalances)
        throw new Error(
          `Failed to get result for getCurrentLiveBalances for ${poolAddress}`,
        );
      const resultGetPoolConfig = decodeThrowError(
        contractInterface,
        'getPoolConfig',
        data[startIndex++],
        poolAddress,
      );
      if (!resultGetPoolConfig)
        throw new Error(
          `Failed to get result for getPoolConfig for ${poolAddress}`,
        );
      const resultTotalSupply = decodeThrowError(
        contractInterface,
        'totalSupply',
        data[startIndex++],
        poolAddress,
      );
      if (!resultTotalSupply)
        throw new Error(
          `Failed to get result for totalSupply for ${poolAddress}`,
        );
      const resultIsPoolPaused = decodeThrowError(
        contractInterface,
        'isPoolPaused',
        data[startIndex++],
        poolAddress,
      );
      if (!resultIsPoolPaused)
        throw new Error(
          `Failed to get result for isPoolPaused for ${poolAddress}`,
        );
      const resultHooksConfig = decodeThrowError(
        contractInterface,
        'getHooksConfig',
        data[startIndex++],
        poolAddress,
      );
      if (!resultHooksConfig)
        throw new Error(
          `Failed to get result for resultHooksConfig for ${poolAddress}`,
        );
      return {
        tokenRates: resultTokenRates.tokenRates.map((r: string) => BigInt(r)),
        balancesLiveScaled18: resultLiveBalances.balancesLiveScaled18.map(
          (b: string) => BigInt(b),
        ),
        swapFee: BigInt(resultGetPoolConfig[0].staticSwapFeePercentage),
        aggregateSwapFee: BigInt(
          resultGetPoolConfig[0].aggregateSwapFeePercentage,
        ),
        totalSupply: BigInt(resultTotalSupply[0]),
        scalingFactors: resultTokenRates.decimalScalingFactors.map(
          (r: string) => BigInt(r),
        ),
        isPoolPaused: resultIsPoolPaused[0],
      };
    },
  },
  ['WEIGHTED']: {
    count: 0,
    ['encode']: (
      network: number,
      contractInterface: Interface,
      address: string,
    ): callData[] => {
      return [];
    },
    ['decode']: (
      contractInterface: Interface,
      poolAddress: string,
      data: any,
      startIndex: number,
    ) => {
      return {};
    },
  },
  ['STABLE']: {
    count: 2,
    ['encode']: (
      network: number,
      contractInterface: Interface,
      address: string,
    ): callData[] => {
      return [
        {
          target: address,
          callData: contractInterface.encodeFunctionData(
            'getAmplificationParameter',
          ),
        },
        {
          target: address,
          callData: contractInterface.encodeFunctionData(
            'getAmplificationState',
          ),
        },
      ];
    },
    ['decode']: (
      contractInterface: Interface,
      poolAddress: string,
      data: any,
      startIndex: number,
    ): StableMutableState => {
      const resultAmp = decodeThrowError(
        contractInterface,
        'getAmplificationParameter',
        data[startIndex++],
        poolAddress,
      );
      if (!resultAmp)
        throw new Error(
          `Failed to get result for getAmplificationParameter for ${poolAddress}`,
        );
      const resultAmpState = decodeThrowError(
        contractInterface,
        'getAmplificationState',
        data[startIndex++],
        poolAddress,
      );
      if (!resultAmpState)
        throw new Error(
          `Failed to get result for getAmplificationState for ${poolAddress}`,
        );

      return {
        amp: resultAmp[0].toBigInt(),
        ampIsUpdating: !!resultAmp[1],
        ampStartValue: resultAmpState[0][0].toBigInt(),
        ampEndValue: resultAmpState[0][1].toBigInt(),
        ampStartTime: BigInt(resultAmpState[0][2]),
        ampStopTime: BigInt(resultAmpState[0][3]),
      };
    },
  },
  // nothing to encode/decode for this pool
  // as all of the values are immutable and returned from the API
  ['GYROE']: {
    count: 0,
    ['encode']: (
      network: number,
      contractInterface: Interface,
      address: string,
    ): callData[] => {
      return [];
    },
    ['decode']: (
      contractInterface: Interface,
      poolAddress: string,
      data: any,
      startIndex: number,
    ) => {
      return {};
    },
  },
};

export function decodeThrowError(
  contractInterface: Interface,
  functionName: string,
  resultEntry: { success: boolean; returnData: any },
  poolAddress: string,
): Result {
  if (!resultEntry.success)
    throw new Error(`Failed to execute ${functionName} for ${poolAddress}`);
  return contractInterface.decodeFunctionResult(
    functionName,
    resultEntry.returnData,
  );
}

export function getErc4626MultiCallData(
  erc4626Interface: Interface,
  immutablePoolStateMap: ImmutablePoolStateMap,
): callData[] {
  // We want to query rate for each unique ERC4626 token
  const uniqueErc4626Tokens = Array.from(
    new Set(
      Object.values(immutablePoolStateMap).flatMap(pool =>
        pool.tokens.filter((_, index) => pool.tokensUnderlying[index] !== null),
      ),
    ),
  );

  // query result for 1e18 (this maintains correct scaling for different token decimals in maths)
  const erc4626MultiCallData: callData[] = uniqueErc4626Tokens.flatMap(
    token => {
      return [
        {
          target: token,
          callData: erc4626Interface.encodeFunctionData('convertToAssets', [
            WAD,
          ]),
        },
        {
          target: token,
          callData: erc4626Interface.encodeFunctionData('maxDeposit', [
            '0x0000000000000000000000000000000000000000',
          ]),
        },
        {
          target: token,
          callData: erc4626Interface.encodeFunctionData('maxMint', [
            '0x0000000000000000000000000000000000000000',
          ]),
        },
      ];
    },
  );
  return erc4626MultiCallData;
}

export function decodeErc4626MultiCallData(
  erc4626Interface: Interface,
  erc4626MultiCallData: callData[],
  dataResultErc4626: any[],
) {
  // We only need to process third of the erc4626MultiCallData entries
  // since each entry corresponds to three results
  const thirdLength = Math.floor(erc4626MultiCallData.length / 3);

  return Object.fromEntries(
    Array.from({ length: thirdLength }).map((_, i) => {
      const rateIndex = i * 3;
      const maxDepositIndex = i * 3 + 1;
      const maxMintIndex = i * 3 + 2;
      const multiCallData = erc4626MultiCallData[rateIndex];

      // Decode convertToAssets
      const rate = decodeThrowError(
        erc4626Interface,
        'convertToAssets',
        dataResultErc4626[rateIndex],
        multiCallData.target,
      );
      if (!rate)
        throw new Error(
          `Failed to get result for convertToAssets for ${multiCallData.target}`,
        );

      // Decode maxDeposit
      const maxDeposit = decodeThrowError(
        erc4626Interface,
        'maxDeposit',
        dataResultErc4626[maxDepositIndex],
        multiCallData.target,
      );
      if (!maxDeposit)
        throw new Error(
          `Failed to get result for maxDeposit for ${multiCallData.target}`,
        );

      // Decode maxMint
      const maxMint = decodeThrowError(
        erc4626Interface,
        'maxMint',
        dataResultErc4626[maxMintIndex],
        multiCallData.target,
      );
      if (!maxMint)
        throw new Error(
          `Failed to get result for maxMint for ${multiCallData.target}`,
        );

      return [
        multiCallData.target,
        {
          rate: BigInt(rate[0]),
          maxDeposit: BigInt(maxDeposit[0]),
          maxMint: BigInt(maxMint[0]),
        },
      ];
    }),
  );
}
// Any data from API will be immutable. Mutable data such as balances, etc will be fetched via onchain/event state.
export async function getOnChainState(
  network: number,
  immutablePoolStateMap: ImmutablePoolStateMap,
  dexHelper: IDexHelper,
  interfaces: {
    [name: string]: Interface;
  },
  blockNumber?: number,
): Promise<PoolStateMap> {
  const erc4626MultiCallData = getErc4626MultiCallData(
    interfaces['ERC4626'],
    immutablePoolStateMap,
  );

  // query pool specific onchain data, e.g. totalSupply, etc
  const poolsMultiCallData = Object.entries(immutablePoolStateMap)
    .map(([address, pool]) => {
      return [
        ...poolOnChain['COMMON'].encode(network, interfaces['VAULT'], address),
        ...poolOnChain[pool.poolType].encode(
          network,
          interfaces[pool.poolType],
          address,
        ),
      ];
    })
    .flat();

  // 500 is an arbitrary number chosen based on the blockGasLimit
  const slicedMultiCallData = _.chunk(
    [...erc4626MultiCallData, ...poolsMultiCallData],
    500,
  );

  const multicallDataResult = (
    await Promise.all(
      slicedMultiCallData.map(async _multiCallData =>
        dexHelper.multiContract.methods
          .tryAggregate(false, _multiCallData)
          .call({}, blockNumber),
      ),
    )
  ).flat();

  const dataResultErc4626 = multicallDataResult.slice(
    0,
    erc4626MultiCallData.length,
  );
  const dataResultPools = multicallDataResult.slice(
    erc4626MultiCallData.length,
  );

  const tokensWithRates = decodeErc4626MultiCallData(
    interfaces['ERC4626'],
    erc4626MultiCallData,
    dataResultErc4626,
  );

  let i = 0;
  const poolStateMap = Object.fromEntries(
    Object.entries(immutablePoolStateMap).map(([address, pool]) => {
      const commonMutableData = poolOnChain['COMMON'].decode(
        interfaces['VAULT'],
        address,
        dataResultPools,
        i,
      ) as CommonMutableState;
      i = i + poolOnChain['COMMON'].count;
      const poolMutableData = poolOnChain[pool.poolType].decode(
        interfaces[pool.poolType],
        address,
        dataResultPools,
        i,
      );
      i = i + poolOnChain[pool.poolType].count;
      return [
        address,
        {
          ...pool,
          ...commonMutableData,
          ...poolMutableData,
          erc4626Rates: pool.tokens.map(t => {
            if (!tokensWithRates[t]) return null;
            return tokensWithRates[t].rate;
          }),
          erc4626MaxDeposit: pool.tokens.map(t => {
            if (!tokensWithRates[t]) return null;
            return tokensWithRates[t].maxDeposit;
          }),
          erc4626MaxMint: pool.tokens.map(t => {
            if (!tokensWithRates[t]) return null;
            return tokensWithRates[t].maxMint;
          }),
        },
      ];
    }),
  );
  return poolStateMap;
}

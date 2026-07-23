import _ from 'lodash';
import {
  ImmutablePoolStateMap,
  CommonMutableState,
  PoolStateMap,
  StableMutableState,
  callData,
} from './types';
import { BalancerV3Config } from './config';
import { Interface, Result } from '@ethersproject/abi';
import { IDexHelper } from '../../dex-helper';
import { WAD } from './balancer-v3-pool';
import { QuantAmmImmutable, QuantAMMMutableState } from './quantAMMPool';
import {
  ReClammMutableState,
  encodeReClammOnChainData,
  decodeReClammOnChainData,
} from './reClammPool';
import { Logger } from 'log4js';

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
      | 'erc4626Rates'
      | 'erc4626MaxDeposit'
      | 'erc4626MaxMint'
      | 'erc4626MaxWithdraw'
      | 'erc4626MaxRedeem'
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
  ['RECLAMM']: {
    count: 1,
    ['encode']: (
      network: number,
      contractInterface: Interface,
      address: string,
    ): callData[] => {
      return encodeReClammOnChainData(contractInterface, address);
    },
    ['decode']: (
      contractInterface: Interface,
      poolAddress: string,
      data: any,
      startIndex: number,
    ): ReClammMutableState => {
      return decodeReClammOnChainData(
        contractInterface,
        poolAddress,
        data,
        startIndex,
        decodeThrowError,
      );
    },
  },
  ['RECLAMM_V2']: {
    count: 1,
    ['encode']: (
      network: number,
      contractInterface: Interface,
      address: string,
    ): callData[] => {
      return encodeReClammOnChainData(contractInterface, address);
    },
    ['decode']: (
      contractInterface: Interface,
      poolAddress: string,
      data: any,
      startIndex: number,
    ): ReClammMutableState => {
      return decodeReClammOnChainData(
        contractInterface,
        poolAddress,
        data,
        startIndex,
        decodeThrowError,
      );
    },
  },
  ['QUANT_AMM_WEIGHTED']: {
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
            'getQuantAMMWeightedPoolDynamicData',
          ),
        },
        {
          target: address,
          callData: contractInterface.encodeFunctionData(
            'getQuantAMMWeightedPoolImmutableData',
          ),
        },
      ];
    },
    ['decode']: (
      contractInterface: Interface,
      poolAddress: string,
      data: any,
      startIndex: number,
    ): QuantAMMMutableState & QuantAmmImmutable => {
      const resultDynamicData = decodeThrowError(
        contractInterface,
        'getQuantAMMWeightedPoolDynamicData',
        data[startIndex++],
        poolAddress,
      );
      if (!resultDynamicData)
        throw new Error(
          `Failed to get result for getQuantAMMWeightedPoolDynamicData for ${poolAddress}`,
        );
      const resultImmutableData = decodeThrowError(
        contractInterface,
        'getQuantAMMWeightedPoolImmutableData',
        data[startIndex++],
        poolAddress,
      );
      if (!resultImmutableData)
        throw new Error(
          `Failed to get result for getQuantAMMWeightedPoolImmutableData for ${poolAddress}`,
        );
      return {
        lastUpdateTime: BigInt(resultDynamicData[0][8]),
        firstFourWeightsAndMultipliers: resultDynamicData[0][6].map((w: any) =>
          w.toBigInt(),
        ),
        secondFourWeightsAndMultipliers: resultDynamicData[0][7].map((w: any) =>
          w.toBigInt(),
        ),
        lastInteropTime: BigInt(resultDynamicData[0][9]),
        currentTimestamp: 0n, // This will be updated at time of swap
        maxTradeSizeRatio: BigInt(resultImmutableData[0][8]),
      };
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

// Number of ERC4626 calls per wrapper token in the multicall batch.
// Order: convertToAssets, maxDeposit, maxMint, maxWithdraw, maxRedeem.
const ERC4626_CALLS_PER_TOKEN = 5;

export function getErc4626MultiCallData(
  erc4626Interface: Interface,
  immutablePoolStateMap: ImmutablePoolStateMap,
  vaultAddress: string,
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
  // maxWithdraw/maxRedeem are queried with the Vault as owner since the Vault
  // is the party that calls withdraw/redeem when unwrapping via buffers, and
  // ERC4626 caps those calls against the owner's position.
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
        {
          target: token,
          callData: erc4626Interface.encodeFunctionData('maxWithdraw', [
            vaultAddress,
          ]),
        },
        {
          target: token,
          callData: erc4626Interface.encodeFunctionData('maxRedeem', [
            vaultAddress,
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
  const tokenCount = Math.floor(
    erc4626MultiCallData.length / ERC4626_CALLS_PER_TOKEN,
  );

  return Object.fromEntries(
    Array.from({ length: tokenCount }).map((_, i) => {
      const base = i * ERC4626_CALLS_PER_TOKEN;
      const rateIndex = base;
      const maxDepositIndex = base + 1;
      const maxMintIndex = base + 2;
      const maxWithdrawIndex = base + 3;
      const maxRedeemIndex = base + 4;
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

      // Decode maxWithdraw
      const maxWithdraw = decodeThrowError(
        erc4626Interface,
        'maxWithdraw',
        dataResultErc4626[maxWithdrawIndex],
        multiCallData.target,
      );
      if (!maxWithdraw)
        throw new Error(
          `Failed to get result for maxWithdraw for ${multiCallData.target}`,
        );

      // Decode maxRedeem
      const maxRedeem = decodeThrowError(
        erc4626Interface,
        'maxRedeem',
        dataResultErc4626[maxRedeemIndex],
        multiCallData.target,
      );
      if (!maxRedeem)
        throw new Error(
          `Failed to get result for maxRedeem for ${multiCallData.target}`,
        );

      return [
        multiCallData.target,
        {
          rate: BigInt(rate[0]),
          maxDeposit: BigInt(maxDeposit[0]),
          maxMint: BigInt(maxMint[0]),
          maxWithdraw: BigInt(maxWithdraw[0]),
          maxRedeem: BigInt(maxRedeem[0]),
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
  logger?: Logger,
): Promise<PoolStateMap> {
  const erc4626MultiCallData = getErc4626MultiCallData(
    interfaces['ERC4626'],
    immutablePoolStateMap,
    BalancerV3Config.BalancerV3[network].vaultAddress,
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
    Object.entries(immutablePoolStateMap)
      .map(([address, pool]) => {
        const startIndex = i;
        try {
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
              erc4626MaxWithdraw: pool.tokens.map(t => {
                if (!tokensWithRates[t]) return null;
                return tokensWithRates[t].maxWithdraw;
              }),
              erc4626MaxRedeem: pool.tokens.map(t => {
                if (!tokensWithRates[t]) return null;
                return tokensWithRates[t].maxRedeem;
              }),
            },
          ];
        } catch (error) {
          logger?.error(
            `Error decoding onchain data for pool ${address}: ${
              (error as Error).message
            }`,
          );

          // Ensure index is set to skip all data for this pool
          i =
            startIndex +
            poolOnChain['COMMON'].count +
            poolOnChain[pool.poolType].count;

          return null;
        }
      })
      .filter(t => t !== null),
  );
  return poolStateMap;
}

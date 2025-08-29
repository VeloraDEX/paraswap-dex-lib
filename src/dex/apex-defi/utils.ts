import { AddressZero } from '@ethersproject/constants';
import { ApexDefiConfig, defaultBaseSwapRate } from './config';
import { Network } from '../../constants';
import { Interface } from '@ethersproject/abi';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { Address, Logger } from '../../types';

/**
 * Converts any value to a BigInt, handling ethers.js BigNumber objects
 * @param value - The value to convert to BigInt
 * @returns A BigInt value
 */
export function toBigInt(value: any): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'object' && value && 'hex' in value) {
    return BigInt(value.hex);
  }
  return BigInt(value);
}

/**
 * Calculates fee components for ApexDefi pools
 * @param feeHookDetails - Fee hook details from factory
 * @param feeRate - Default fee rate from factory
 * @returns Object containing baseSwapRate, protocolFee, and lpFee
 */
export function calculateFees(
  feeHookDetails: [string, any, any, any],
  feeRate: any,
): { baseSwapRate: bigint; protocolFee: bigint; lpFee: bigint } {
  const hasFeeHook = feeHookDetails[0] !== AddressZero;
  const baseSwapRate = hasFeeHook
    ? toBigInt(feeHookDetails[1])
    : defaultBaseSwapRate;
  const protocolFee = hasFeeHook
    ? toBigInt(feeHookDetails[3])
    : toBigInt(feeRate);
  const lpFee = hasFeeHook
    ? toBigInt(feeHookDetails[2])
    : defaultBaseSwapRate - toBigInt(feeRate);

  return { baseSwapRate, protocolFee, lpFee };
}

/**
 * Returns the correct factory address for a given token and network.
 * If the token has a legacy factory mapping, that address is returned.
 * Otherwise, the default factory address for the network is returned.
 *
 * @param tokenAddress - The address of the token (pool)
 * @param network - The network identifier (e.g., 'mainnet', 'testnet')
 * @returns The factory address as a string
 */
export function getFactoryAddressForToken(
  tokenAddress: Address,
  network: Network,
): { factoryAddress: Address; isLegacy: boolean } {
  const config = ApexDefiConfig.ApexDefi[network];
  return {
    factoryAddress:
      config.legacyFactoryMappings?.[tokenAddress.toLowerCase()] ||
      config.factoryAddress,
    isLegacy:
      ApexDefiConfig.ApexDefi[network].legacyFactoryMappings?.[
        tokenAddress.toLowerCase()
      ] !== undefined,
  };
}

export interface ApexDefiOnChainPoolData {
  reserve0: bigint;
  reserve1: bigint;
  baseSwapRate: number;
  protocolFee: number;
  lpFee: number;
  tradingFee: number;
  factoryAddress: Address;
  isLegacy: boolean;
  tradingEnabled: boolean;
}

export async function fetchApexDefiOnChainPoolData(
  pairAddress: Address,
  network: Network,
  blockNumber: number,
  dexHelper: IDexHelper,
  tokenIface: Interface,
  factoryIface: Interface,
  logger: Logger,
): Promise<ApexDefiOnChainPoolData | null> {
  const { factoryAddress, isLegacy } = getFactoryAddressForToken(
    pairAddress,
    network,
  );

  // Build multicall array dynamically
  const multicall = [
    {
      target: pairAddress,
      callData: tokenIface.encodeFunctionData('getReserves'),
    },
    {
      target: pairAddress,
      callData: tokenIface.encodeFunctionData('tradingFeeRate'),
    },
    {
      target: pairAddress,
      callData: tokenIface.encodeFunctionData('tradingEnabled'),
    },
  ];

  if (isLegacy) {
    multicall.push({
      target: factoryAddress,
      callData: factoryIface.encodeFunctionData('feeRate'),
    });
  } else {
    multicall.push({
      target: factoryAddress,
      callData: factoryIface.encodeFunctionData('getFeeHookDetails', [
        pairAddress,
      ]),
    });
  }

  // Use tryAggregate - no try/catch needed
  const poolData = await dexHelper.multiContract.methods
    .tryAggregate(false, multicall)
    .call({}, blockNumber);

  // Check if all calls succeeded
  const [reservesSuccess, reservesData] = poolData[0];
  const [tradingFeeSuccess, tradingFeeData] = poolData[1];
  const [tradingEnabledSuccess, tradingEnabledData] = poolData[2];
  const [feeSuccess, feeData] = poolData[3];

  if (
    !reservesSuccess ||
    !tradingFeeSuccess ||
    !feeSuccess ||
    !tradingEnabledSuccess
  ) {
    return null;
  }

  const tradingEnabled = tokenIface.decodeFunctionResult(
    'tradingEnabled',
    tradingEnabledData,
  )[0];

  const reserves = tokenIface.decodeFunctionResult('getReserves', reservesData);

  const tradingFeeRate: bigint = tokenIface.decodeFunctionResult(
    'tradingFeeRate',
    tradingFeeData,
  )[0];

  let feeHookDetails: [Address, bigint, bigint, bigint] = [
    AddressZero,
    0n,
    0n,
    0n,
  ];
  let feeRate: bigint = 0n;

  if (isLegacy) {
    feeRate = factoryIface.decodeFunctionResult(
      'feeRate',
      feeData,
    )[0] as bigint;
  } else {
    feeHookDetails = factoryIface.decodeFunctionResult(
      'getFeeHookDetails',
      feeData,
    ) as [Address, bigint, bigint, bigint];
  }

  const { baseSwapRate, protocolFee, lpFee } = calculateFees(
    feeHookDetails,
    feeRate,
  );

  return {
    reserve0: reserves[0],
    reserve1: reserves[1],
    baseSwapRate: Number(baseSwapRate),
    protocolFee: Number(protocolFee),
    lpFee: Number(lpFee),
    tradingFee: Number(tradingFeeRate),
    factoryAddress,
    isLegacy,
    tradingEnabled,
  };
}

import { ethers, Interface } from 'ethers';
import { IDexHelper } from '../../dex-helper';
import { Token } from '../../types';
import { bigIntify } from '../nerve/utils';
import { getBigIntPow } from '../../utils';
import { JarvisSwapFunctions, PoolConfig, PoolState } from './types';
import { Contract } from 'web3-eth-contract';

export const THIRTY_MINUTES = 60 * 30;

// Note: PriceFeed contract can only be called directly or from Jarvis's whitelisted contract hence why we can't group in same init multicall call
export async function getOnChainState(
  dexHelper: IDexHelper,
  poolConfigs: PoolConfig[],
  blockNumber: number | 'latest',
  {
    priceFeedContract,
    poolInterface,
  }: { priceFeedContract: Contract; poolInterface: Interface },
): Promise<PoolState[]> {
  const [pricesFeedValues, poolFeePercentages] = await Promise.all([
    _getPricesFeedValues(
      dexHelper,
      poolConfigs,
      blockNumber,
      priceFeedContract,
    ),
    _getPoolFeePercentages(dexHelper, poolConfigs, blockNumber, poolInterface),
  ]);

  return poolConfigs.map((_, index) => ({
    priceFeed: pricesFeedValues[index],
    pool: poolFeePercentages[index],
  }));
}

async function _getPoolFeePercentages(
  dexHelper: IDexHelper,
  poolConfigs: PoolConfig[],
  blockNumber: number | 'latest',
  poolInterface: Interface,
) {
  const multiContract = dexHelper.multiContract;
  const PoolCallData = poolConfigs
    .map(pool => [
      {
        target: pool.address,
        callData: poolInterface.encodeFunctionData('feePercentage', []),
      },
    ])
    .flat();

  const poolDataCalled = (await multiContract.methods
    .aggregate(PoolCallData)
    .call({}, blockNumber)) as { returnData: string[] };

  return poolDataCalled.returnData.map(d => ({
    feesPercentage: bigIntify(
      poolInterface.decodeFunctionResult('feePercentage', d)[0],
    ),
  }));
}

async function _getPricesFeedValues(
  dexHelper: IDexHelper,
  poolConfigs: PoolConfig[],
  blockNumber: number | 'latest',
  priceFeedContract: Contract,
) {
  const pairList = poolConfigs.map(pool =>
    ethers.encodeBytes32String(pool.priceFeedPair),
  );

  const pricesFeedValues = (await priceFeedContract.methods
    .getLatestPrices(pairList)
    .call({}, blockNumber)) as string[];

  return pricesFeedValues.map(d => ({
    usdcPrice: bigIntify(d),
  }));
}

export function getJarvisPoolFromTokens(
  srcToken: Token,
  destToken: Token,
  poolConfigs: PoolConfig[],
): PoolConfig | null {
  const srcAddress = srcToken.address.toLowerCase();
  const destAddress = destToken.address.toLowerCase();
  return (
    poolConfigs.find(pool => {
      const collateralAddress = pool.collateralToken.address.toLowerCase();
      const syntheticToken = pool.syntheticToken.address.toLowerCase();
      return (
        (srcAddress === collateralAddress && destAddress === syntheticToken) ||
        (srcAddress === syntheticToken && destAddress === collateralAddress)
      );
    }) ?? null
  );
}

export function convertToNewDecimals(
  amount: bigint,
  currentDecimal: number,
  desireDecimal: number,
): bigint {
  if (currentDecimal === desireDecimal) return amount;
  const isDecimalIncrease = currentDecimal < desireDecimal;
  const bigIntPow = getBigIntPow(
    isDecimalIncrease
      ? desireDecimal - currentDecimal
      : currentDecimal - desireDecimal,
  );

  return isDecimalIncrease ? amount * bigIntPow : amount / bigIntPow;
}

export function getJarvisSwapFunction(
  srcToken: Token,
  pool: PoolConfig,
): JarvisSwapFunctions {
  const srcAddress = srcToken.address.toLowerCase();
  if (srcAddress === pool.collateralToken.address.toLowerCase())
    return JarvisSwapFunctions.MINT;
  return JarvisSwapFunctions.REDEEM;
}

import { Network } from '../../../constants';

export const stablecoins: Record<number, string[]> = {
  [Network.BASE]: [
    '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'.toLowerCase(), // usdc
    '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA'.toLowerCase(), // usdbc
    '0xEB466342C4d449BC9f53A865D5Cb90586f405215'.toLowerCase(), // axelar usdc
  ],
};

export function isStablePair(chainId: number, tokenA: string, tokenB: string) {
  const stables = stablecoins[chainId];

  return (
    stables.includes(tokenA.toLocaleLowerCase()) &&
    stables.includes(tokenB.toLocaleLowerCase())
  );
}

import { Address, PoolLiquidity } from '../../types';
import { RENEGADE_NAME } from './constants';
import { RenegadeDepth } from './types';

// Depth response from Renegade API.
export class RenegadeLevelsResponse {
  private readonly levels: { [pairIdentifier: string]: RenegadeDepth };
  private readonly poolLiquidity: { [pairIdentifier: string]: PoolLiquidity };

  constructor(data: { [pairIdentifier: string]: RenegadeDepth }) {
    this.levels = data;

    if (!this.levels || typeof this.levels !== 'object') {
      throw new Error('Invalid Renegade levels response: expected object');
    }

    this.poolLiquidity = {};
    for (const [pairIdentifier, pairData] of Object.entries(this.levels)) {
      const askLiquidityUSD = pairData.asks.reduce(
        (acc: number, [price, size]: [string, string]) => {
          return acc + parseFloat(size) * parseFloat(price);
        },
        0,
      );
      const bidLiquidityUSD = pairData.bids.reduce(
        (acc: number, [price, size]: [string, string]) => {
          return acc + parseFloat(size) * parseFloat(price);
        },
        0,
      );
      const liquidityUSD = askLiquidityUSD + bidLiquidityUSD;
      this.poolLiquidity[pairIdentifier] = {
        poolIdentifier: pairIdentifier,
        exchange: RENEGADE_NAME,
        address: pairIdentifier.split('/')[0],
        connectorTokens: [],
        liquidityUSD,
      };
    }
  }

  // Returns the raw levels data.
  public getRawData(): { [pairIdentifier: string]: RenegadeDepth } {
    return this.levels;
  }

  // Returns the pool liquidity for the given base token.
  public getPoolLiquidity(tokenAddress: Address): PoolLiquidity[] {
    const pools = [];
    for (const [pair, pool] of Object.entries(this.poolLiquidity)) {
      if (pair.toLowerCase().indexOf(tokenAddress.toLowerCase()) !== -1) {
        pools.push(pool);
      }
    }
    return pools;
  }
}

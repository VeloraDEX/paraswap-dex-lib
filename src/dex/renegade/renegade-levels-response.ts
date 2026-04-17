import { Address } from '../../types';
import { RenegadeDepth, RenegadePriceLevel } from './types';

// Depth response from Renegade API.
export class RenegadeLevelsResponse {
  private readonly levels: { [pairIdentifier: string]: RenegadeDepth };

  constructor(data: { [pairIdentifier: string]: RenegadeDepth }) {
    this.levels = data;

    if (!this.levels || typeof this.levels !== 'object') {
      throw new Error('Invalid Renegade levels response: expected object');
    }
  }

  // Returns the raw levels data.
  public getRawData(): { [pairIdentifier: string]: RenegadeDepth } {
    return this.levels;
  }

  public getPairDepth(
    baseToken: Address,
    quoteToken: Address,
  ): RenegadeDepth | null {
    const expectedPair = `${baseToken.toLowerCase()}/${quoteToken.toLowerCase()}`;
    return this.levels[expectedPair] ?? null;
  }

  // Returns directional liquidity data for a token across all relevant pairs.
  public getDirectionalLiquidityForToken(
    tokenAddress: Address,
    usdcAddress: Address,
  ): Array<{
    baseToken: Address;
    quoteToken: Address;
    outboundLiquidityUSD: number;
    reverseLiquidityUSD: number;
    isTokenBase: boolean;
  }> {
    const normalizedTokenAddress = tokenAddress.toLowerCase();
    const normalizedUsdcAddress = usdcAddress.toLowerCase();

    const results: Array<{
      baseToken: Address;
      quoteToken: Address;
      outboundLiquidityUSD: number;
      reverseLiquidityUSD: number;
      isTokenBase: boolean;
    }> = [];

    for (const [pairIdentifier, pairDepth] of Object.entries(this.levels)) {
      const parsedPair = this.parsePairIdentifier(pairIdentifier);
      if (!parsedPair) continue;

      const [baseToken, quoteToken] = parsedPair;
      if (quoteToken !== normalizedUsdcAddress) continue; // quote token should always be USDC

      const isTokenBase = normalizedTokenAddress === baseToken;
      const isTokenQuote = normalizedTokenAddress === quoteToken;

      if (!isTokenBase && !isTokenQuote) continue;

      // Calculate directional liquidity
      // If token is base: outbound = bids (sell base), reverse = asks (buy base)
      // If token is quote: outbound = asks (sell quote), reverse = bids (buy quote)
      const outboundLiquidityUSD = isTokenBase
        ? this.calculateLiquidityUSD(pairDepth.bids)
        : this.calculateLiquidityUSD(pairDepth.asks);

      const reverseLiquidityUSD = isTokenBase
        ? this.calculateLiquidityUSD(pairDepth.asks)
        : this.calculateLiquidityUSD(pairDepth.bids);

      if (outboundLiquidityUSD <= 0) continue;

      results.push({
        baseToken,
        quoteToken,
        outboundLiquidityUSD,
        reverseLiquidityUSD,
        isTokenBase,
      });
    }

    return results;
  }

  // Internal helper: parse pair identifier into [base, quote] tuple.
  // Pair identifiers are formatted as [base]/[quote], where quote is always USDC.
  private parsePairIdentifier(pairIdentifier: string): [string, string] | null {
    const parts = pairIdentifier.split('/').map(s => s.toLowerCase());
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return null;
    }
    return [parts[0], parts[1]];
  }

  // Internal helper: calculate USD liquidity from price levels.
  // Sums price * size across all levels (both are strings).
  private calculateLiquidityUSD(levels: RenegadePriceLevel[]): number {
    return levels.reduce(
      (acc, [price, size]) => acc + parseFloat(size) * parseFloat(price),
      0,
    );
  }
}

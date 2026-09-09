import { quoteVe33 } from './ve33';

const ONE_PERCENT_FEE = (1n << 64n) / 100n;

function underlyingQuote(calculatedAmount: bigint, consumedAmount: bigint) {
  return {
    calculatedAmount,
    consumedAmount,
    gasConsumed: 10,
    skipAhead: 0,
    stateAfter: { marker: 1 },
  };
}

describe(quoteVe33, () => {
  test('exact input takes the voted fee from actual output', () => {
    const quote = quoteVe33(
      underlyingQuote(999n, 500n),
      1_000n,
      ONE_PERCENT_FEE,
    );

    expect(quote.consumedAmount).toBe(500n);
    expect(quote.calculatedAmount).toBe(989n);
    expect(quote.stateAfter).toEqual({ marker: 1, swapFee: ONE_PERCENT_FEE });
  });

  test('exact output grosses up the required input', () => {
    const quote = quoteVe33(
      underlyingQuote(1_000n, -500n),
      -500n,
      ONE_PERCENT_FEE,
    );

    expect(quote.calculatedAmount).toBe(1_011n);
  });

  test('zero fee leaves the underlying amount unchanged', () => {
    expect(
      quoteVe33(underlyingQuote(999n, 1_000n), 1_000n, 0n).calculatedAmount,
    ).toBe(999n);
  });
});

import { DeepReadonly } from 'ts-essentials';
import { PoolState } from '../types';

const ONE = 1n << 64n;
const MAX_I128 = (1n << 127n) - 1n;
const MIN_I128 = -(1n << 127n);
const MAX_U256 = (1n << 256n) - 1n;
const MAX_I256 = (1n << 255n) - 1n;
const MAX_FEE = 1n << 62n; // 0.25 in signed 64.64
const MAX_DIFF = -0x10c6f7a0b5een;
const CONVERGENCE_DIVISOR = 10_000_000_000_000n;

// Match Solidity's revert behavior when a quote violates a contract check.
function requireCondition(
  condition: boolean,
  message: string,
): asserts condition {
  if (!condition) throw new Error(`Stabull: ${message}`);
}

// Check that an intermediate fits the contract's signed 128-bit math type.
function i128(value: bigint, label: string): bigint {
  requireCondition(
    value >= MIN_I128 && value <= MAX_I128,
    `${label} exceeds int128`,
  );
  return value;
}

// Add two signed fixed-point values with Solidity's int128 bounds.
function add(x: bigint, y: bigint, label: string): bigint {
  return i128(x + y, label);
}

// Subtract two signed fixed-point values with Solidity's int128 bounds.
function sub(x: bigint, y: bigint, label: string): bigint {
  return i128(x - y, label);
}

// Multiply signed 64.64 values, rounding down as ABDK does for negative values.
function mul(x: bigint, y: bigint, label: string): bigint {
  return i128((x * y) >> 64n, label);
}

// Reproduce UnsafeMath64x64's unchecked int128 wrap for the final output fee.
function uncheckedMul(x: bigint, y: bigint): bigint {
  const raw = (x * y) >> 64n;
  const wrapped = raw & ((1n << 128n) - 1n);
  return wrapped >= 1n << 127n ? wrapped - (1n << 128n) : wrapped;
}

// Divide signed 64.64 values, rounding toward zero like ABDK.
function div(x: bigint, y: bigint, label: string): bigint {
  requireCondition(y !== 0n, `${label} division by zero`);
  return i128((x << 64n) / y, label);
}

// Convert an unsigned integer ratio into signed 64.64 form.
function divu(x: bigint, y: bigint, label: string): bigint {
  requireCondition(x >= 0n && x <= MAX_U256, `${label} is outside uint256`);
  requireCondition(y > 0n && y <= MAX_U256, `${label} has invalid divisor`);
  return i128((x << 64n) / y, label);
}

// Multiply a 64.64 value by an unsigned amount and return the integer result.
function mulu(x: bigint, y: bigint, label: string): bigint {
  requireCondition(
    x >= 0n && x <= MAX_I128,
    `${label} must be nonnegative int128`,
  );
  requireCondition(
    y >= 0n && y <= MAX_U256,
    `${label} multiplier is outside uint256`,
  );
  const result = (x * y) >> 64n;
  requireCondition(result <= MAX_U256, `${label} exceeds uint256`);
  return result;
}

// Build a checked decimal scale used by token and oracle conversions.
function pow10(decimals: number, label: string): bigint {
  requireCondition(
    Number.isInteger(decimals) && decimals >= 0 && decimals <= 77,
    `${label} decimals are invalid`,
  );
  return 10n ** BigInt(decimals);
}

/** Convert a token amount into the common oracle-valued units used by the curve. */
function toNumeraire(
  raw: bigint,
  tokenDecimals: number,
  oracleDecimals: number,
  answer: bigint,
): bigint {
  requireCondition(
    raw >= 0n && raw <= MAX_U256,
    'raw amount is outside uint256',
  );
  requireCondition(
    answer > 0n && answer <= MAX_I256,
    'oracle answer is invalid',
  );
  const oracleScale = pow10(oracleDecimals, 'oracle');
  const tokenScale = pow10(tokenDecimals, 'token');
  const product = raw * answer;
  requireCondition(
    product <= MAX_U256,
    'raw amount times oracle answer overflows uint256',
  );
  const scaled = product / oracleScale;
  return divu(scaled, tokenScale, 'numeraire conversion');
}

// Calculate one asset's fee from its distance outside the beta balance band.
function calculateMicroFee(
  balance: bigint,
  ideal: bigint,
  beta: bigint,
  delta: bigint,
): bigint {
  if (balance < ideal) {
    const threshold = mul(
      ideal,
      sub(ONE, beta, 'lower beta threshold'),
      'lower fee threshold',
    );
    if (balance >= threshold) return 0n;
    const margin = sub(threshold, balance, 'lower fee margin');
    let fee = div(
      mul(margin, delta, 'lower fee rate'),
      ideal,
      'lower fee ratio',
    );
    if (fee > MAX_FEE) fee = MAX_FEE;
    return mul(fee, margin, 'lower micro fee');
  }

  const threshold = mul(
    ideal,
    add(ONE, beta, 'upper beta threshold'),
    'upper fee threshold',
  );
  if (balance <= threshold) return 0n;
  const margin = sub(balance, threshold, 'upper fee margin');
  let fee = div(mul(margin, delta, 'upper fee rate'), ideal, 'upper fee ratio');
  if (fee > MAX_FEE) fee = MAX_FEE;
  return mul(fee, margin, 'upper micro fee');
}

// Sum the imbalance fees for both assets at the current liquidity level.
function calculateFee(
  gLiquidity: bigint,
  balances: readonly [bigint, bigint],
  weights: readonly [bigint, bigint],
  beta: bigint,
  delta: bigint,
): bigint {
  let fee = 0n;
  for (let i = 0; i < 2; i += 1) {
    const ideal = mul(gLiquidity, weights[i], 'ideal balance');
    fee = add(
      fee,
      calculateMicroFee(balances[i], ideal, beta, delta),
      'total curve fee',
    );
  }
  return fee;
}

// Reject trades that move a balance farther beyond its alpha halt boundary.
function enforceHalts(
  alpha: bigint,
  oldLiquidity: bigint,
  newLiquidity: bigint,
  oldBalances: [bigint, bigint],
  newBalances: [bigint, bigint],
  weights: readonly [bigint, bigint],
): void {
  for (let i = 0; i < 2; i += 1) {
    const newIdeal = mul(newLiquidity, weights[i], 'new ideal balance');
    if (newBalances[i] > newIdeal) {
      const upperAlpha = add(ONE, alpha, 'upper alpha');
      const newHalt = mul(newIdeal, upperAlpha, 'new upper halt');
      if (newBalances[i] > newHalt) {
        const oldHalt = mul(
          mul(oldLiquidity, weights[i], 'old ideal balance'),
          upperAlpha,
          'old upper halt',
        );
        requireCondition(oldBalances[i] >= oldHalt, 'upper halt');
        requireCondition(
          sub(newBalances[i], newHalt, 'new upper halt excess') <=
            sub(oldBalances[i], oldHalt, 'old upper halt excess'),
          'upper halt',
        );
      }
    } else {
      const lowerAlpha = sub(ONE, alpha, 'lower alpha');
      const newHalt = mul(newIdeal, lowerAlpha, 'new lower halt');
      if (newBalances[i] < newHalt) {
        const oldHalt = mul(
          mul(oldLiquidity, weights[i], 'old ideal balance'),
          lowerAlpha,
          'old lower halt',
        );
        requireCondition(oldBalances[i] <= oldHalt, 'lower halt');
        requireCondition(
          sub(newHalt, newBalances[i], 'new lower halt deficit') <=
            sub(oldHalt, oldBalances[i], 'old lower halt deficit'),
          'lower halt',
        );
      }
    }
  }
}

// Solve the curve's signed output amount using its fee and halt rules.
function calculateTrade(
  inputAmount: bigint,
  oldBalances: [bigint, bigint],
  inputIndex: number,
  outputIndex: number,
  state: DeepReadonly<PoolState>,
): bigint {
  const { alpha, beta, delta, lambda } = state.parameters;
  const weights = state.weights;
  const oldLiquidity = add(
    oldBalances[0],
    oldBalances[1],
    'old global liquidity',
  );
  const omega = calculateFee(oldLiquidity, oldBalances, weights, beta, delta);
  let outputAmount = i128(-inputAmount, 'initial output amount');
  const newBalances: [bigint, bigint] = [...oldBalances];
  newBalances[inputIndex] = add(
    newBalances[inputIndex],
    inputAmount,
    'input balance after intake',
  );
  // viewOriginSwapData pre-debits the output balance by the input amount before
  // calculateTrade's first psi calculation. Later iterations replace this with
  // oldOutputBalance + the current signed output estimate.
  newBalances[outputIndex] = sub(
    newBalances[outputIndex],
    inputAmount,
    'initial output balance',
  );

  for (let iteration = 0; iteration < 32; iteration += 1) {
    const psi = calculateFee(
      add(
        oldLiquidity,
        add(inputAmount, outputAmount, 'net swap amount'),
        'new global liquidity',
      ),
      newBalances,
      weights,
      beta,
      delta,
    );
    const previousAmount = outputAmount;
    if (omega < psi) {
      outputAmount = i128(
        -sub(
          add(inputAmount, omega, 'fee-adjusted input'),
          psi,
          'fee-adjusted output',
        ),
        'output amount',
      );
    } else {
      outputAmount = i128(
        -add(
          inputAmount,
          mul(lambda, sub(omega, psi, 'fee delta'), 'lambda fee adjustment'),
          'lambda-adjusted input',
        ),
        'output amount',
      );
    }

    if (
      outputAmount / CONVERGENCE_DIVISOR ===
      previousAmount / CONVERGENCE_DIVISOR
    ) {
      const newLiquidity = add(
        oldLiquidity,
        add(inputAmount, outputAmount, 'converged net swap amount'),
        'converged global liquidity',
      );
      newBalances[outputIndex] = add(
        oldBalances[outputIndex],
        outputAmount,
        'output balance after swap',
      );
      enforceHalts(
        alpha,
        oldLiquidity,
        newLiquidity,
        oldBalances,
        newBalances,
        weights,
      );

      const diff = sub(
        sub(newLiquidity, psi, 'post-swap utilization'),
        sub(oldLiquidity, omega, 'pre-swap utilization'),
        'swap invariant difference',
      );
      requireCondition(
        0n < diff || diff >= MAX_DIFF,
        'swap invariant violation',
      );
      return outputAmount;
    }

    newBalances[outputIndex] = add(
      oldBalances[outputIndex],
      outputAmount,
      'iteration output balance',
    );
    // The next iteration derives liquidity from oGLiq + input + current output,
    // matching CurveMath. The input balance remains old balance + converted input.
  }

  throw new Error('Stabull: swap convergence failed');
}

/**
 * Quotes exact-input SELL through the contract's originSwap execution path.
 * Returns zero for a zero input; invalid/unexecutable positive inputs throw.
 */
export function quoteSell(
  state: DeepReadonly<PoolState>,
  inputIndex: number,
  amount: bigint,
): bigint {
  return calculateSell(state, inputIndex, amount, false);
}

/** Reproduces viewOriginSwap for independent comparisons with the read-only contract. */
export function quoteViewSell(
  state: DeepReadonly<PoolState>,
  inputIndex: number,
  amount: bigint,
): bigint {
  return calculateSell(state, inputIndex, amount, true);
}

/** Shares curve math while preserving each contract path's balance rounding. */
function calculateSell(
  state: DeepReadonly<PoolState>,
  inputIndex: number,
  amount: bigint,
  useViewBalance: boolean,
): bigint {
  if (amount === 0n) return 0n;
  requireCondition(
    amount > 0n && amount <= MAX_U256,
    'input amount must be a positive uint256',
  );
  requireCondition(
    inputIndex === 0 || inputIndex === 1,
    'unsupported input index',
  );
  requireCondition(
    !state.frozen && !state.emergency && !state.globallyFrozen,
    'pool is halted',
  );

  const outputIndex = inputIndex === 0 ? 1 : 0;
  const input = state.tokens[inputIndex];
  const output = state.tokens[outputIndex];
  requireCondition(
    Boolean(input.address) && Boolean(output.address),
    'token state is unavailable',
  );
  requireCondition(
    input.address.toLowerCase() !== output.address.toLowerCase(),
    'input and output token are identical',
  );
  requireCondition(
    Boolean(
      input.assimilator &&
        output.assimilator &&
        input.proxy &&
        output.proxy &&
        input.aggregator &&
        output.aggregator,
    ),
    'assimilator or oracle mapping is unavailable',
  );
  requireCondition(
    input.balance > 0n && output.balance > 0n,
    'pool liquidity is unavailable',
  );
  requireCondition(
    input.updatedAt > 0n && output.updatedAt > 0n,
    'oracle timestamp is unavailable',
  );
  requireCondition(
    state.weights[0] > 0n && state.weights[1] > 0n,
    'pool weights are invalid',
  );

  const parameters = Object.values(state.parameters);
  requireCondition(
    parameters.every(value => value >= 0n && value <= MAX_I128),
    'curve parameters are invalid',
  );
  requireCondition(
    state.parameters.alpha < ONE + 18n &&
      state.parameters.beta < state.parameters.alpha,
    'alpha/beta are outside contract bounds',
  );
  requireCondition(
    state.parameters.epsilon <= ONE / 100n + 18n,
    'epsilon is outside contract bounds',
  );
  requireCondition(
    state.parameters.lambda <= ONE + 18n,
    'lambda is outside contract bounds',
  );

  const inputAmount = toNumeraire(
    amount,
    input.decimals,
    input.oracleDecimals,
    input.answer,
  );
  requireCondition(inputAmount > 0n, 'input rounds to zero numeraire');
  const oldBalances: [bigint, bigint] = [
    toNumeraire(
      state.tokens[0].balance,
      state.tokens[0].decimals,
      state.tokens[0].oracleDecimals,
      state.tokens[0].answer,
    ),
    toNumeraire(
      state.tokens[1].balance,
      state.tokens[1].decimals,
      state.tokens[1].oracleDecimals,
      state.tokens[1].answer,
    ),
  ];
  // originSwap transfers first, converts the new balance, then subtracts the
  // separately converted input. Independent floors make this differ from the
  // view function's conversion of the old balance, especially for 6-decimal input.
  if (!useViewBalance) {
    const postTransferBalance = input.balance + amount;
    requireCondition(
      postTransferBalance <= MAX_U256,
      'input balance after transfer overflows uint256',
    );
    oldBalances[inputIndex] = sub(
      toNumeraire(
        postTransferBalance,
        input.decimals,
        input.oracleDecimals,
        input.answer,
      ),
      inputAmount,
      'input balance before transfer',
    );
  }
  requireCondition(
    oldBalances[0] > 0n && oldBalances[1] > 0n,
    'pool balance rounds to zero numeraire',
  );

  const curveOutput = calculateTrade(
    inputAmount,
    oldBalances,
    inputIndex,
    outputIndex,
    state,
  );
  requireCondition(curveOutput < 0n, 'curve returned a non-output amount');
  const epsilonMultiplier = sub(
    ONE,
    state.parameters.epsilon,
    'epsilon multiplier',
  );
  // Solidity multiplies the negative signed output first, then AssimilatorV2
  // applies checked abs(). For negative products, arithmetic shift rounds down;
  // taking abs before multiplication would round the opposite way by one ULP.
  const signedNetOutput = uncheckedMul(curveOutput, epsilonMultiplier);
  requireCondition(
    signedNetOutput !== MIN_I128,
    'epsilon-adjusted output cannot be represented as absolute int128',
  );
  const netOutput = signedNetOutput < 0n ? -signedNetOutput : signedNetOutput;
  const rawNumerator =
    mulu(
      netOutput,
      pow10(output.decimals, 'output token'),
      'raw output token amount',
    ) * pow10(output.oracleDecimals, 'output oracle');
  requireCondition(
    rawNumerator <= MAX_U256,
    'raw output conversion overflows uint256',
  );
  const rawOutput = rawNumerator / output.answer;
  requireCondition(rawOutput > 0n, 'output rounds to zero');
  return rawOutput;
}

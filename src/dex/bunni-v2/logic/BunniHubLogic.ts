import _ from 'lodash';
import {
  DepositLogicInputData,
  DepositLogicReturnData,
  DepositParams,
  DexParams,
  PoolState,
  WithdrawParams,
} from '../types';
import { getReservesInUnderlying } from '../lib/VaultMath';
import { IdleBalanceLibrary } from '../lib/IdleBalance';
import { LDFType } from '../ldf/LDFType';
import { RAW_TOKEN_RATIO_BASE } from '../lib/Constants';
import { NULL_ADDRESS } from '../../../constants';
import { abs, min, mulDiv, mulDivUp } from '../lib/Math';
import { queryTwap } from '../lib/QueryTwap';
import { queryLDF } from '../lib/QueryLDF';
import { IDexHelper } from '../../../dex-helper';
import {
  ERC4626_previewDeposit,
  ERC4626_maxDeposit,
  ERC4626_previewWithdraw,
} from '../getOnChainState';
import { _updateAmAmmWrite } from './AmAmm';

export async function deposit(
  state: PoolState,
  params: DepositParams,
  blockNumber: bigint,
  blockTimestamp: bigint,
  deploymentBlock: bigint,
  K: bigint,
  dexHelper: IDexHelper,
  dexParams: DexParams,
): Promise<void> {
  let amount0: bigint;
  let amount1: bigint;

  // trigger am-AMM state machine update to avoid sandwiching rent burns
  _updateAmAmmWrite(state, blockNumber, deploymentBlock, K);

  const depositReturnData: DepositLogicReturnData = await _depositLogic(
    {
      state: state,
      params: params,
      poolId: state.id,
      currentTick: state.slot0.tick,
      sqrtPriceX96: state.slot0.sqrtPriceX96,
    },
    blockNumber,
    blockTimestamp,
    dexHelper,
    dexParams,
  );

  let reserveAmount0: bigint = depositReturnData.reserveAmount0;
  let reserveAmount1: bigint = depositReturnData.reserveAmount1;
  amount0 = depositReturnData.amount0;
  amount1 = depositReturnData.amount1;

  const rawAmount0: bigint =
    state.vault0 !== NULL_ADDRESS ? amount0 - reserveAmount0 : amount0;
  const rawAmount1: bigint =
    state.vault1 !== NULL_ADDRESS ? amount1 - reserveAmount1 : amount1;
  state.rawBalance0 += rawAmount0;
  state.rawBalance1 += rawAmount1;

  if (state.vault0 !== NULL_ADDRESS && reserveAmount0 !== 0n) {
    const { reserveChange, reserveChangeInUnderlying } =
      await _depositVaultReserve(
        reserveAmount0,
        state.vault0,
        blockNumber,
        dexHelper,
      );
    state.reserve0 += reserveChange;
    reserveAmount0 = reserveChangeInUnderlying;
  }

  if (state.vault1 !== NULL_ADDRESS && reserveAmount1 !== 0n) {
    const { reserveChange, reserveChangeInUnderlying } =
      await _depositVaultReserve(
        reserveAmount1,
        state.vault1,
        blockNumber,
        dexHelper,
      );
    state.reserve1 += reserveChange;
    reserveAmount1 = reserveChangeInUnderlying;
  }

  // update amount0 and amount1 to be the actual amounts added to the pool balance
  amount0 =
    state.vault0 !== NULL_ADDRESS ? rawAmount0 + reserveAmount0 : rawAmount0;
  amount1 =
    state.vault1 !== NULL_ADDRESS ? rawAmount1 + reserveAmount1 : rawAmount1;

  if (depositReturnData.balance0 === 0n && depositReturnData.balance1 === 0n) {
    if (state.idleBalance !== IdleBalanceLibrary.ZERO) {
      state.idleBalance = IdleBalanceLibrary.ZERO;
    }
  } else {
    const { rawBalance, isToken0 } = IdleBalanceLibrary.fromIdleBalance(
      state.idleBalance,
    );

    const newBalance =
      rawBalance +
      (isToken0
        ? depositReturnData.balance0 === 0n
          ? amount0
          : mulDivUp(amount0, rawBalance, depositReturnData.balance0)
        : depositReturnData.balance1 === 0n
        ? amount1
        : mulDivUp(amount1, rawBalance, depositReturnData.balance1));

    if (newBalance !== rawBalance) {
      state.idleBalance = IdleBalanceLibrary.toIdleBalance(
        newBalance,
        isToken0,
      );
    }
  }
}

export async function withdraw(
  state: PoolState,
  params: WithdrawParams,
  blockNumber: bigint,
  dexHelper: IDexHelper,
): Promise<void> {
  let amount0: bigint;
  let amount1: bigint;

  const reserveAmount0 = await getReservesInUnderlying(
    mulDiv(state.reserve0, params.shares, state.totalSupply),
    state.vault0,
    blockNumber,
    dexHelper,
  );
  const reserveAmount1 = await getReservesInUnderlying(
    mulDiv(state.reserve1, params.shares, state.totalSupply),
    state.vault1,
    blockNumber,
    dexHelper,
  );
  const rawAmount0 = mulDiv(
    state.rawBalance0,
    params.shares,
    state.totalSupply,
  );
  const rawAmount1 = mulDiv(
    state.rawBalance1,
    params.shares,
    state.totalSupply,
  );
  amount0 = reserveAmount0 + rawAmount0;
  amount1 = reserveAmount1 + rawAmount1;

  // update the idle balance
  const { rawBalance, isToken0 } = IdleBalanceLibrary.fromIdleBalance(
    state.idleBalance,
  );
  const newBalance =
    rawBalance - mulDiv(rawBalance, params.shares, state.totalSupply);
  if (newBalance !== rawBalance) {
    state.idleBalance = IdleBalanceLibrary.toIdleBalance(newBalance, isToken0);
  }

  if (state.vault0 !== NULL_ADDRESS && reserveAmount0 !== 0n) {
    const { reserveChange } = await _withdrawVaultReserve(
      reserveAmount0,
      state.vault0,
      blockNumber,
      dexHelper,
    );
    state.reserve0 -= reserveChange;
  }

  if (state.vault1 !== NULL_ADDRESS && reserveAmount1 !== 0n) {
    const { reserveChange } = await _withdrawVaultReserve(
      reserveAmount1,
      state.vault1,
      blockNumber,
      dexHelper,
    );
    state.reserve1 -= reserveChange;
  }

  state.rawBalance0 -= rawAmount0;
  state.rawBalance1 -= rawAmount1;
}

export async function hookHandleSwap(
  state: PoolState,
  zeroForOne: boolean,
  inputAmount: bigint,
  outputAmount: bigint,
  shouldSurge: boolean,
  blockNumber: bigint,
  dexHelper: IDexHelper,
): Promise<void> {
  // pull input claim tokens from hook
  if (inputAmount !== 0n) {
    zeroForOne
      ? (state.rawBalance0 += inputAmount)
      : (state.rawBalance1 += inputAmount);
  }

  if (outputAmount !== 0n) {
    const outputRawBalance: bigint = zeroForOne
      ? state.rawBalance1
      : state.rawBalance0;
    const outputVault: string = zeroForOne ? state.vault1 : state.vault0;

    if (outputVault !== NULL_ADDRESS && outputRawBalance < outputAmount) {
      const { reserveChange, actualRawBalanceChange: rawBalanceChange } =
        await _updateVaultReserveViaClaimTokens(
          outputAmount - outputRawBalance,
          outputVault,
          state,
          blockNumber,
          dexHelper,
        );

      zeroForOne
        ? (state.reserve1 += reserveChange)
        : (state.reserve0 += reserveChange);
      zeroForOne
        ? (state.rawBalance1 += rawBalanceChange)
        : (state.rawBalance0 += rawBalanceChange);
    }

    zeroForOne
      ? (state.rawBalance1 -= outputAmount)
      : (state.rawBalance0 -= outputAmount);
  }

  if (!shouldSurge) {
    if (state.vault0 !== NULL_ADDRESS) {
      const { newReserve, newRawBalance } = await _updateRawBalanceIfNeeded(
        state.vault0,
        state.rawBalance0,
        state.reserve0,
        state.minRawTokenRatio0,
        state.maxRawTokenRatio0,
        state.targetRawTokenRatio0,
        state,
        blockNumber,
        dexHelper,
      );

      state.reserve0 = newReserve;
      state.rawBalance0 = newRawBalance;
    }

    if (state.vault1 !== NULL_ADDRESS) {
      const { newReserve, newRawBalance } = await _updateRawBalanceIfNeeded(
        state.vault1,
        state.rawBalance1,
        state.reserve1,
        state.minRawTokenRatio1,
        state.maxRawTokenRatio1,
        state.targetRawTokenRatio1,
        state,
        blockNumber,
        dexHelper,
      );

      state.reserve1 = newReserve;
      state.rawBalance1 = newRawBalance;
    }
  }
}

/*
  Modified from the originally written solidity specifically
  to handle deposit events where the acutal emitted amounts
  are known. Replicating the solidity logic exactly will lead
  to incorrect values and should not be used unless further
  development deems it necessary.
*/
async function _depositLogic(
  inputData: DepositLogicInputData,
  blockNumber: bigint,
  blockTimestamp: bigint,
  dexHelper: IDexHelper,
  dexParams: DexParams,
): Promise<DepositLogicReturnData> {
  const returnData: DepositLogicReturnData = {
    reserveAmount0: 0n,
    reserveAmount1: 0n,
    amount0: 0n,
    amount1: 0n,
    balance0: 0n,
    balance1: 0n,
  };

  const { reserveBalance0, reserveBalance1 } = {
    reserveBalance0: await getReservesInUnderlying(
      inputData.state.reserve0,
      inputData.state.vault0,
      blockNumber,
      dexHelper,
    ),
    reserveBalance1: await getReservesInUnderlying(
      inputData.state.reserve1,
      inputData.state.vault1,
      blockNumber,
      dexHelper,
    ),
  };

  returnData.amount0 = inputData.params.amount0Desired;
  returnData.amount1 = inputData.params.amount1Desired;
  returnData.balance0 = inputData.state.rawBalance0 + reserveBalance0;
  returnData.balance1 = inputData.state.rawBalance1 + reserveBalance1;

  const requiresLDF: boolean =
    returnData.balance0 === 0n && returnData.balance1 === 0n;

  if (requiresLDF) {
    const useTwap = inputData.state.twapSecondsAgo !== 0n;

    const arithmeticMeanTick = useTwap
      ? queryTwap(
          inputData.state,
          inputData.state.twapSecondsAgo,
          blockTimestamp,
        )
      : 0n;

    const { newLdfState } = queryLDF(
      inputData.state.key,
      inputData.sqrtPriceX96,
      inputData.currentTick,
      arithmeticMeanTick,
      inputData.state.liquidityDensityFunction,
      inputData.state.ldfParams,
      inputData.state.ldfState,
      inputData.params.amount0Desired,
      inputData.params.amount1Desired,
      IdleBalanceLibrary.ZERO,
      dexParams,
    );

    if (inputData.state.ldfType === LDFType.DYNAMIC_AND_STATEFUL) {
      inputData.state.ldfState = newLdfState;
    }
  }

  // update token amounts to deposit into vaults
  returnData.reserveAmount0 =
    returnData.amount0 -
    mulDiv(
      returnData.amount0,
      inputData.state.targetRawTokenRatio0,
      RAW_TOKEN_RATIO_BASE,
    );
  returnData.reserveAmount1 =
    returnData.amount1 -
    mulDiv(
      returnData.amount1,
      inputData.state.targetRawTokenRatio1,
      RAW_TOKEN_RATIO_BASE,
    );

  // modify reserveAmount0 using ERC4626::maxDeposit()
  if (
    inputData.state.vault0 !== NULL_ADDRESS &&
    returnData.reserveAmount0 !== 0n
  ) {
    const maxDeposit0: bigint = await ERC4626_maxDeposit(
      inputData.state.bunniHub,
      inputData.state.vault0,
      blockNumber,
      dexHelper,
    );

    if (returnData.reserveAmount0 > maxDeposit0) {
      returnData.reserveAmount0 = maxDeposit0;
    }
  }

  // modify reserveAmount1 using ERC4626::maxDeposit()
  if (
    inputData.state.vault1 !== NULL_ADDRESS &&
    returnData.reserveAmount1 !== 0n
  ) {
    const maxDeposit1: bigint = await ERC4626_maxDeposit(
      inputData.state.bunniHub,
      inputData.state.vault1,
      blockNumber,
      dexHelper,
    );

    if (returnData.reserveAmount1 > maxDeposit1) {
      returnData.reserveAmount1 = maxDeposit1;
    }
  }

  return returnData;
}

async function _depositVaultReserve(
  amount: bigint,
  vault: string,
  blockNumber: bigint,
  dexHelper: IDexHelper,
): Promise<{
  reserveChange: bigint;
  reserveChangeInUnderlying: bigint;
}> {
  throw new Error(
    'Unreliable results from _depositVaultReserve(), fallback to RPC state updates',
  );

  // @dev
  // The original solidity code uses the return value from depositing
  // into the ERC4626. Using previewDeposit here gives unreliable
  // results and cannot be trusted. I've attempted almost every possible
  // combination of RPC calls here to no avail. So, for now, we will
  // throw an error to revert back to general RPC state updates.

  const reserveChange = await ERC4626_previewDeposit(
    amount,
    vault,
    blockNumber,
    dexHelper,
  );
  return { reserveChange, reserveChangeInUnderlying: amount };
}

async function _withdrawVaultReserve(
  amount: bigint,
  vault: string,
  blockNumber: bigint,
  dexHelper: IDexHelper,
): Promise<{ reserveChange: bigint }> {
  const reserveChange = await ERC4626_previewWithdraw(
    amount,
    vault,
    blockNumber,
    dexHelper,
  );
  return { reserveChange };
}

async function _updateVaultReserveViaClaimTokens(
  rawBalanceChange: bigint,
  vault: string,
  state: PoolState,
  blockNumber: bigint,
  dexHelper: IDexHelper,
): Promise<{
  reserveChange: bigint;
  actualRawBalanceChange: bigint;
}> {
  let reserveChange: bigint = 0n;
  let actualRawBalanceChange: bigint = 0n;

  let absAmount = abs(rawBalanceChange);

  if (rawBalanceChange < 0) {
    const maxDepositAmount = await ERC4626_maxDeposit(
      state.bunniHub,
      vault,
      blockNumber,
      dexHelper,
    );
    absAmount = min(absAmount, maxDepositAmount);

    reserveChange = await ERC4626_previewDeposit(
      absAmount,
      vault,
      blockNumber,
      dexHelper,
    );
    actualRawBalanceChange = rawBalanceChange;
  } else if (rawBalanceChange > 0) {
    reserveChange = -(await ERC4626_previewWithdraw(
      absAmount,
      vault,
      blockNumber,
      dexHelper,
    ));
    actualRawBalanceChange = rawBalanceChange;
  }

  return { reserveChange, actualRawBalanceChange };
}

async function _updateRawBalanceIfNeeded(
  vault: string,
  rawBalance: bigint,
  reserve: bigint,
  minRatio: bigint,
  maxRatio: bigint,
  targetRatio: bigint,
  state: PoolState,
  blockNumber: bigint,
  dexHelper: IDexHelper,
): Promise<{
  newReserve: bigint;
  newRawBalance: bigint;
}> {
  let newReserve: bigint = 0n;
  let newRawBalance: bigint = 0n;

  const balance =
    rawBalance +
    (await getReservesInUnderlying(reserve, vault, blockNumber, dexHelper));
  const minRawBalance = mulDiv(balance, minRatio, RAW_TOKEN_RATIO_BASE);
  const maxRawBalance = mulDiv(balance, maxRatio, RAW_TOKEN_RATIO_BASE);

  if (rawBalance < minRawBalance || rawBalance > maxRawBalance) {
    const targetRawBalance = mulDiv(balance, targetRatio, RAW_TOKEN_RATIO_BASE);

    const { reserveChange, actualRawBalanceChange: rawBalanceChange } =
      await _updateVaultReserveViaClaimTokens(
        targetRawBalance - rawBalance,
        vault,
        state,
        blockNumber,
        dexHelper,
      );

    newReserve = reserve + reserveChange;
    newRawBalance = rawBalance + rawBalanceChange;
  } else {
    newReserve = reserve;
    newRawBalance = rawBalance;
  }

  return { newReserve, newRawBalance };
}

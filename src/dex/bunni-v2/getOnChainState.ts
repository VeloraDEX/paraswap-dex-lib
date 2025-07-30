import { Interface } from '@ethersproject/abi';
import { IDexHelper } from '../../dex-helper';
import ERC4626Abi from '../../abi/ERC4626.json';
import { DexParams, PoolState, Vault } from './types';
import { bigIntify } from '../../utils';
import { multicall } from './utils';
import { BigNumber, BytesLike, ethers } from 'ethers';

const ERC4626Interface: Interface = new Interface(ERC4626Abi);

const mask8: BigNumber = BigNumber.from('0xff');
const mask16: BigNumber = BigNumber.from('0xffff');
const mask24: BigNumber = BigNumber.from('0xffffff');
const mask32: BigNumber = BigNumber.from('0xffffffff');
const mask56: BigNumber = BigNumber.from('0x00ffffffffffffff');
const mask120: BigNumber = BigNumber.from('0xffffffffffffffffffffffffffffff');

export async function generateOnChainState(
  poolStates: PoolState[],
  blockNumber: number,
  bunniHubInterface: Interface,
  bunniHookInterface: Interface,
  bunniTokenInterface: Interface,
  feeOverrideHookletInterface: Interface,
  dexHelper: IDexHelper,
  config: DexParams,
): Promise<void> {
  await Promise.all([
    updateHubState(poolStates, blockNumber, bunniHubInterface, dexHelper).then(
      () =>
        updateFeeOverrides(
          poolStates,
          blockNumber,
          feeOverrideHookletInterface,
          dexHelper,
          config,
        ),
    ),
    updateHookState(
      poolStates,
      blockNumber,
      bunniHookInterface,
      dexHelper,
    ).then(() =>
      updateObservations(
        poolStates,
        blockNumber,
        bunniHookInterface,
        dexHelper,
      ),
    ),
    updateSlot0(poolStates, blockNumber, bunniHookInterface, dexHelper),
    updateLdfState(poolStates, blockNumber, bunniHookInterface, dexHelper),
    updateVaultSharePricesAtLastSwap(
      poolStates,
      blockNumber,
      bunniHookInterface,
      dexHelper,
    ),
    updateCuratorFees(poolStates, blockNumber, bunniHookInterface, dexHelper),
    updateTotalSupply(poolStates, blockNumber, bunniTokenInterface, dexHelper),
    updateTopBid(poolStates, blockNumber, bunniHookInterface, dexHelper),
    updateNextBid(poolStates, blockNumber, bunniHookInterface, dexHelper),
  ]);
}

/* -------------------------------------------------------------------------- */
/*                            After Event Updaters                            */
/* -------------------------------------------------------------------------- */

export async function updateStateAfterNewBunni(
  state: PoolState,
  blockNumber: number,
  bunniHubInterface: Interface,
  bunniHookInterface: Interface,
  bunniTokenInterface: Interface,
  dexHelper: IDexHelper,
): Promise<void> {
  await Promise.all([
    updateHubState([state], blockNumber, bunniHubInterface, dexHelper),
    updateLdfState([state], blockNumber, bunniHookInterface, dexHelper),
    updateTotalSupply([state], blockNumber, bunniTokenInterface, dexHelper),
  ]);
}

export async function updateStateAfterDeposit(
  state: PoolState,
  blockNumber: number,
  bunniHubInterface: Interface,
  bunniHookInterface: Interface,
  dexHelper: IDexHelper,
): Promise<void> {
  await Promise.all([
    updateHubState([state], blockNumber, bunniHubInterface, dexHelper),
    updateLdfState([state], blockNumber, bunniHookInterface, dexHelper),
  ]);
}

export async function updateStateAfterWithdraw(
  state: PoolState,
  blockNumber: number,
  bunniHubInterface: Interface,
  dexHelper: IDexHelper,
): Promise<void> {
  await Promise.all([
    updateHubState([state], blockNumber, bunniHubInterface, dexHelper),
  ]);
}

export async function updateStateAfterSwap(
  state: PoolState,
  blockNumber: number,
  bunniHubInterface: Interface,
  bunniHookInterface: Interface,
  dexHelper: IDexHelper,
): Promise<void> {
  await Promise.all([
    updateHubState([state], blockNumber, bunniHubInterface, dexHelper),
    updateHookState([state], blockNumber, bunniHookInterface, dexHelper).then(
      () =>
        updateObservations([state], blockNumber, bunniHookInterface, dexHelper),
    ),
    updateSlot0([state], blockNumber, bunniHookInterface, dexHelper),
    updateLdfState([state], blockNumber, bunniHookInterface, dexHelper),
    updateVaultSharePricesAtLastSwap(
      [state],
      blockNumber,
      bunniHookInterface,
      dexHelper,
    ),
  ]);
}

export async function updateStateAfterOrderFulfilled(
  states: PoolState[],
  blockNumber: number,
  bunniHubInterface: Interface,
  bunniHookInterface: Interface,
  dexHelper: IDexHelper,
): Promise<void> {
  await Promise.all([
    updateHubState(states, blockNumber, bunniHubInterface, dexHelper),
    updateSlot0(states, blockNumber, bunniHookInterface, dexHelper),
  ]);
}

/* -------------------------------------------------------------------------- */
/*                               State Updaters                               */
/* -------------------------------------------------------------------------- */

export async function updateHubState(
  poolStates: PoolState[],
  blockNumber: number,
  bunniHubInterface: Interface,
  dexHelper: IDexHelper,
): Promise<void> {
  const multiCallData = poolStates.map(poolState => {
    return {
      target: poolState.bunniHub,
      callData: bunniHubInterface.encodeFunctionData('poolState', [
        poolState.id,
      ]),
    };
  });

  const result = await multicall(multiCallData, blockNumber, dexHelper);

  poolStates.forEach((poolState, i) => {
    const data = bunniHubInterface.decodeFunctionResult(
      'poolState',
      result[i].returnData,
    )[0];
    poolState.liquidityDensityFunction =
      data.liquidityDensityFunction.toLowerCase();
    poolState.bunniToken = data.bunniToken.toLowerCase();
    poolState.hooklet = data.hooklet.toLowerCase();
    poolState.twapSecondsAgo = bigIntify(data.twapSecondsAgo);
    poolState.ldfParams = data.ldfParams;
    poolState.hookParams = data.hookParams;
    poolState.vault0 = data.vault0.toLowerCase();
    poolState.vault1 = data.vault1.toLowerCase();
    poolState.ldfType = parseInt(data.ldfType);
    poolState.minRawTokenRatio0 = bigIntify(data.minRawTokenRatio0);
    poolState.targetRawTokenRatio0 = bigIntify(data.targetRawTokenRatio0);
    poolState.maxRawTokenRatio0 = bigIntify(data.maxRawTokenRatio0);
    poolState.minRawTokenRatio1 = bigIntify(data.minRawTokenRatio1);
    poolState.targetRawTokenRatio1 = bigIntify(data.targetRawTokenRatio1);
    poolState.maxRawTokenRatio1 = bigIntify(data.maxRawTokenRatio1);
    poolState.currency0Decimals = bigIntify(data.currency0Decimals);
    poolState.currency1Decimals = bigIntify(data.currency1Decimals);
    poolState.vault0Decimals = bigIntify(data.vault0Decimals);
    poolState.vault1Decimals = bigIntify(data.vault1Decimals);
    poolState.rawBalance0 = bigIntify(data.rawBalance0);
    poolState.rawBalance1 = bigIntify(data.rawBalance1);
    poolState.reserve0 = bigIntify(data.reserve0);
    poolState.reserve1 = bigIntify(data.reserve1);
    poolState.idleBalance = data.idleBalance;
  });
}

export async function updateHookState(
  poolStates: PoolState[],
  blockNumber: number,
  bunniHookInterface: Interface,
  dexHelper: IDexHelper,
): Promise<void> {
  const encodeExtsLoad = (s: PoolState) => {
    const statesSlot = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(['bytes32', 'uint256'], [s.id, 7n]),
    );
    const intermediateObservationSlot = BigNumber.from(statesSlot)
      .add(1)
      .toHexString();

    const rebalanceOrderHashSlot = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(['bytes32', 'uint256'], [s.id, 8n]),
    );

    return bunniHookInterface.encodeFunctionData('0xdbd035ff', [
      [statesSlot, intermediateObservationSlot, rebalanceOrderHashSlot],
    ]);
  };

  const decodeExtsLoad = (d: BytesLike) => {
    const decoded = ethers.utils.defaultAbiCoder.decode(['bytes32[]'], d);

    // decode the observation state
    const decodedState = BigNumber.from(decoded[0][0]);
    const index = bigIntify(decodedState.and(mask32));
    const cardinality = bigIntify(decodedState.shr(32).and(mask32));
    const cardinalityNext = bigIntify(decodedState.shr(64).and(mask32));

    // decode the intermediate observation
    const decodedIntermediateObservation = BigNumber.from(decoded[0][1]);
    const blockTimestamp = bigIntify(
      decodedIntermediateObservation.and(mask32),
    );
    const prevTick = decodedIntermediateObservation.shr(32).and(mask24);
    const tickCumulative = decodedIntermediateObservation.shr(56).and(mask56);
    const initialized = decodedIntermediateObservation
      .shr(112)
      .and(mask8)
      .eq(1);

    const prevTickSigned = prevTick.gt(BigNumber.from('0x7fffff'))
      ? prevTick.sub(BigNumber.from('0x1000000'))
      : prevTick;

    const tickCumulativeSigned = tickCumulative.gt(
      BigNumber.from('0x7fffffffffffff'),
    )
      ? tickCumulative.sub(BigNumber.from('0x100000000000000'))
      : tickCumulative;

    const rebalanceOrderHash = decoded[0][2];

    return {
      index,
      cardinality,
      cardinalityNext,
      intermediateObservation: {
        blockTimestamp,
        prevTick: bigIntify(prevTickSigned),
        tickCumulative: bigIntify(tickCumulativeSigned),
        initialized,
      },
      rebalanceOrderHash,
    };
  };

  const multiCallData = poolStates.map(poolState => {
    return {
      target: poolState.key.hooks,
      callData: encodeExtsLoad(poolState),
    };
  });

  const result = await multicall(multiCallData, blockNumber, dexHelper);

  poolStates.forEach((poolState, i) => {
    const data = decodeExtsLoad(result[i].returnData);

    poolState.index = data.index;
    poolState.cardinality = data.cardinality;
    poolState.cardinalityNext = data.cardinalityNext;
    poolState.intermediateObservation = data.intermediateObservation;
    poolState.rebalanceOrderHash = data.rebalanceOrderHash;
  });
}

export async function updateSlot0(
  poolStates: PoolState[],
  blockNumber: number,
  bunniHookInterface: Interface,
  dexHelper: IDexHelper,
): Promise<void> {
  const multiCallData = poolStates.map(poolState => {
    return {
      target: poolState.key.hooks,
      callData: bunniHookInterface.encodeFunctionData('slot0s', [poolState.id]),
    };
  });

  const result = await multicall(multiCallData, blockNumber, dexHelper);

  poolStates.forEach((poolState, i) => {
    const data = bunniHookInterface.decodeFunctionResult(
      'slot0s',
      result[i].returnData,
    );

    poolState.slot0.sqrtPriceX96 = bigIntify(data.sqrtPriceX96);
    poolState.slot0.tick = bigIntify(data.tick);
    poolState.slot0.lastSwapTimestamp = bigIntify(data.lastSwapTimestamp);
    poolState.slot0.lastSurgeTimestamp = bigIntify(data.lastSurgeTimestamp);
  });
}

export async function updateLdfState(
  poolStates: PoolState[],
  blockNumber: number,
  bunniHookInterface: Interface,
  dexHelper: IDexHelper,
): Promise<void> {
  const multiCallData = poolStates.map(poolState => {
    return {
      target: poolState.key.hooks,
      callData: bunniHookInterface.encodeFunctionData('ldfStates', [
        poolState.id,
      ]),
    };
  });

  const result = await multicall(multiCallData, blockNumber, dexHelper);

  poolStates.forEach((poolState, i) => {
    const data = bunniHookInterface.decodeFunctionResult(
      'ldfStates',
      result[i].returnData,
    )[0];
    poolState.ldfState = data;
  });
}

export async function updateVaultSharePricesAtLastSwap(
  poolStates: PoolState[],
  blockNumber: number,
  bunniHookInterface: Interface,
  dexHelper: IDexHelper,
): Promise<void> {
  const encodeExtsLoad = (s: PoolState) => {
    const slot = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(['bytes32', 'uint256'], [s.id, 11n]),
    );
    return bunniHookInterface.encodeFunctionData('0x1e2eaeaf', [slot]);
  };

  const decodeExtsLoad = (d: BytesLike) => {
    const decodedVaultSharePricesAtLastSwap = BigNumber.from(d);

    const initialized = decodedVaultSharePricesAtLastSwap.and(mask8).eq(1);
    const sharePrice0 = bigIntify(
      decodedVaultSharePricesAtLastSwap.shr(8).and(mask120),
    );
    const sharePrice1 = bigIntify(
      decodedVaultSharePricesAtLastSwap.shr(128).and(mask120),
    );
    return { initialized, sharePrice0, sharePrice1 };
  };

  const multiCallData = poolStates.map(poolState => {
    return {
      target: poolState.key.hooks,
      callData: encodeExtsLoad(poolState),
    };
  });

  const result = await multicall(multiCallData, blockNumber, dexHelper);

  poolStates.forEach((poolState, i) => {
    const data = decodeExtsLoad(result[i].returnData);
    poolState.initialized = data.initialized;
    poolState.sharePrice0 = data.sharePrice0;
    poolState.sharePrice1 = data.sharePrice1;
  });
}

export async function updateCuratorFees(
  poolStates: PoolState[],
  blockNumber: number,
  bunniHookInterface: Interface,
  dexHelper: IDexHelper,
): Promise<void> {
  const encodeExtsLoad = (s: PoolState) => {
    const slot = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(['bytes32', 'uint256'], [s.id, 15n]),
    );
    return bunniHookInterface.encodeFunctionData('0x1e2eaeaf', [slot]);
  };

  const decodeExtsLoad = (d: BytesLike) => {
    const decodedCuratorFees = BigNumber.from(d);

    const feeRate = bigIntify(decodedCuratorFees.and(mask16));
    const accruedFee0 = bigIntify(decodedCuratorFees.shr(8).and(mask120));
    const accruedFee1 = bigIntify(decodedCuratorFees.shr(128).and(mask120));
    return { feeRate, accruedFee0, accruedFee1 };
  };

  const multiCallData = poolStates.map(poolState => {
    return {
      target: poolState.key.hooks,
      callData: encodeExtsLoad(poolState),
    };
  });

  const result = await multicall(multiCallData, blockNumber, dexHelper);

  poolStates.forEach((poolState, i) => {
    const data = decodeExtsLoad(result[i].returnData);
    poolState.curatorFeeRate = data.feeRate;
  });
}

export async function updateTopBid(
  poolStates: PoolState[],
  blockNumber: number,
  bunniHookInterface: Interface,
  dexHelper: IDexHelper,
): Promise<void> {
  const multiCallData = poolStates.map(poolState => {
    return {
      target: poolState.key.hooks,
      callData: bunniHookInterface.encodeFunctionData('getBid', [
        poolState.id,
        true,
      ]),
    };
  });

  const result = await multicall(multiCallData, blockNumber, dexHelper);

  poolStates.forEach((poolState, i) => {
    const data = bunniHookInterface.decodeFunctionResult(
      'getBid',
      result[i].returnData,
    )[0];

    poolState.topBid = {
      manager: data.manager,
      blockIdx: bigIntify(data.blockIdx),
      payload: data.payload,
      rent: bigIntify(data.rent),
      deposit: bigIntify(data.deposit),
    };
  });
}

export async function updateNextBid(
  poolStates: PoolState[],
  blockNumber: number,
  bunniHookInterface: Interface,
  dexHelper: IDexHelper,
): Promise<void> {
  const multiCallData = poolStates.map(poolState => {
    return {
      target: poolState.key.hooks,
      callData: bunniHookInterface.encodeFunctionData('getBid', [
        poolState.id,
        false,
      ]),
    };
  });

  const result = await multicall(multiCallData, blockNumber, dexHelper);

  poolStates.forEach((poolState, i) => {
    const data = bunniHookInterface.decodeFunctionResult(
      'getBid',
      result[i].returnData,
    )[0];

    poolState.nextBid = {
      manager: data.manager,
      blockIdx: bigIntify(data.blockIdx),
      payload: data.payload,
      rent: bigIntify(data.rent),
      deposit: bigIntify(data.deposit),
    };
  });
}

export async function updateTotalSupply(
  poolStates: PoolState[],
  blockNumber: number,
  bunniTokenInterface: Interface,
  dexHelper: IDexHelper,
): Promise<void> {
  const multiCallData = poolStates.map(poolState => {
    return {
      target: poolState.bunniToken,
      callData: bunniTokenInterface.encodeFunctionData('totalSupply'),
    };
  });

  const result = await multicall(multiCallData, blockNumber, dexHelper);

  poolStates.forEach((poolState, i) => {
    const data = bunniTokenInterface.decodeFunctionResult(
      'totalSupply',
      result[i].returnData,
    );
    poolState.totalSupply = bigIntify(data);
  });
}

export async function updateObservations(
  poolStates: PoolState[],
  blockNumber: number,
  bunniHookInterface: Interface,
  dexHelper: IDexHelper,
): Promise<void> {
  const encodeExtsLoad = (s: PoolState) => {
    const observationsBaseSlot = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(['bytes32', 'uint256'], [s.id, 6n]),
    );

    const observationSlots = [];
    for (let i = 0; i < s.cardinalityNext; i++) {
      observationSlots.push(
        BigNumber.from(observationsBaseSlot).add(i).toHexString(),
      );
    }

    return bunniHookInterface.encodeFunctionData('0xdbd035ff', [
      [...observationSlots],
    ]);
  };

  const decodeExtsLoad = (d: BytesLike) => {
    const decoded = ethers.utils.defaultAbiCoder.decode(['bytes32[]'], d);

    const observations = [];
    for (let i = 0; i < decoded[0].length; i++) {
      const rawObservation = BigNumber.from(decoded[0][i]);

      const blockTimestamp = bigIntify(rawObservation.and(mask32));
      const prevTick = rawObservation.shr(32).and(mask24);
      const tickCumulative = rawObservation.shr(56).and(mask56);
      const initialized = rawObservation.shr(112).and(mask8).eq(1);

      const prevTickSigned = prevTick.gt(BigNumber.from('0x7fffff'))
        ? prevTick.sub(BigNumber.from('0x1000000'))
        : prevTick;

      const tickCumulativeSigned = tickCumulative.gt(
        BigNumber.from('0x7fffffffffffff'),
      )
        ? tickCumulative.sub(BigNumber.from('0x100000000000000'))
        : tickCumulative;

      observations.push({
        blockTimestamp,
        prevTick: bigIntify(prevTickSigned),
        tickCumulative: bigIntify(tickCumulativeSigned),
        initialized,
      });
    }

    return observations;
  };

  const multiCallData = poolStates.map(poolState => {
    return {
      target: poolState.key.hooks,
      callData: encodeExtsLoad(poolState),
    };
  });

  const result = await multicall(multiCallData, blockNumber, dexHelper);

  poolStates.forEach((poolState, i) => {
    const data = decodeExtsLoad(result[i].returnData);
    poolState.observations = data;
  });
}

export async function updateFeeOverrides(
  poolStates: PoolState[],
  blockNumber: number,
  feeOverrideHookletInterface: Interface,
  dexHelper: IDexHelper,
  config: DexParams,
): Promise<void> {
  const poolsToQuery = poolStates.filter(poolState =>
    Object.prototype.hasOwnProperty.call(
      config.hooklets,
      poolState.hooklet.toLowerCase(),
    ),
  );

  const multiCallData = poolsToQuery.map(poolState => {
    return {
      target: poolState.hooklet,
      callData: feeOverrideHookletInterface.encodeFunctionData('feeOverrides', [
        poolState.id,
      ]),
    };
  });

  const result = await multicall(multiCallData, blockNumber, dexHelper);

  poolsToQuery.forEach((poolState, i) => {
    const data = feeOverrideHookletInterface.decodeFunctionResult(
      'feeOverrides',
      result[i].returnData,
    );

    poolState.overrideZeroToOne = data.overrideZeroToOne;
    poolState.feeZeroToOne = bigIntify(data.feeZeroToOne);
    poolState.overrideOneToZero = data.overrideOneToZero;
    poolState.feeOneToZero = bigIntify(data.feeOneToZero);
  });
}

/* -------------------------------------------------------------------------- */
/*                                   OTHER                                  */
/* -------------------------------------------------------------------------- */

export async function updateVaultSharePrices(
  vaults: Vault[],
  dexHelper: IDexHelper,
): Promise<void> {
  const multiCallData = vaults.map(vault => {
    return {
      target: vault.address,
      callData: ERC4626Interface.encodeFunctionData('convertToAssets', [
        10n ** vault.vaultDecimals,
      ]),
    };
  });

  const result = await multicall(multiCallData, 'latest', dexHelper);

  vaults.forEach((vault, i) => {
    const data = ERC4626Interface.decodeFunctionResult(
      'convertToAssets',
      result[i].returnData,
    );
    vault.sharePrice = bigIntify(data);
  });
}

/* -------------------------------------------------------------------------- */
/*                                   ERC4626                                  */
/* -------------------------------------------------------------------------- */

export async function ERC4626_previewDeposit(
  amount: bigint,
  vault: string,
  blockNumber: bigint,
  dexHelper: IDexHelper,
): Promise<bigint> {
  const callData = {
    target: vault,
    callData: ERC4626Interface.encodeFunctionData('previewDeposit', [amount]),
  };

  const result = await multicall([callData], Number(blockNumber), dexHelper);

  const data = ERC4626Interface.decodeFunctionResult(
    'previewDeposit',
    result[0].returnData,
  )[0];

  return bigIntify(data);
}

export async function ERC4626_previewWithdraw(
  amount: bigint,
  vault: string,
  blockNumber: bigint,
  dexHelper: IDexHelper,
): Promise<bigint> {
  const callData = {
    target: vault,
    callData: ERC4626Interface.encodeFunctionData('previewWithdraw', [amount]),
  };

  const result = await multicall([callData], Number(blockNumber), dexHelper);

  const data = ERC4626Interface.decodeFunctionResult(
    'previewWithdraw',
    result[0].returnData,
  )[0];

  return bigIntify(data);
}

export async function ERC4626_previewRedeem(
  amount: bigint,
  vault: string,
  blockNumber: bigint,
  dexHelper: IDexHelper,
): Promise<bigint> {
  const callData = {
    target: vault,
    callData: ERC4626Interface.encodeFunctionData('previewRedeem', [amount]),
  };

  const result = await multicall([callData], Number(blockNumber), dexHelper);

  const data = ERC4626Interface.decodeFunctionResult(
    'previewRedeem',
    result[0].returnData,
  )[0];

  return bigIntify(data);
}

export async function ERC4626_maxDeposit(
  account: string,
  vault: string,
  blockNumber: bigint,
  dexHelper: IDexHelper,
): Promise<bigint> {
  const callData = {
    target: vault,
    callData: ERC4626Interface.encodeFunctionData('maxDeposit', [account]),
  };

  const result = await multicall([callData], Number(blockNumber), dexHelper);

  const data = ERC4626Interface.decodeFunctionResult(
    'maxDeposit',
    result[0].returnData,
  )[0];

  return bigIntify(data);
}

import BigNumber from 'bignumber.js';
import { DeepReadonly } from 'ts-essentials';
import { Address, BlockHeader, Log } from '../../../types';
import { ThreePool } from './3pool';
import { PoolState } from './curve-pool';
import { IDexHelper } from '../../../dex-helper';
import { BN_0, BN_1 } from '../../../bignumber-constants';
import { bigNumberify, stringify } from '../../../utils';

// Plain (non-lending) StableSwap pools deployed outside mainnet. Same
// liquidity math as the mainnet 3pool, but their events carry the post-op
// token supply, RemoveLiquidityOne carries the withdrawn coin amount, and
// get_dy applies the fee before converting back to coin units.
export abstract class SidechainPool extends ThreePool {
  constructor(
    parentName: string,
    dexHelper: IDexHelper,
    pool: string,
    address: Address,
    tokenAddress: Address,
    abi: any,
    N_COINS: number,
    PRECISION_MUL: BigNumber[],
    COINS: Address[],
    prefix: string,
  ) {
    super(
      parentName,
      dexHelper,
      pool,
      address,
      tokenAddress,
      // The coin index of RemoveLiquidityOne is recovered from the event
      // itself, so there is no need to follow every transfer of the coins.
      false,
      abi,
      N_COINS,
      PRECISION_MUL,
      new Array(N_COINS).fill(false),
      COINS,
      prefix,
    );
    // When the pool is its own LP token, its Transfer events have no `src`.
    delete this.handlers['Transfer'];
  }

  protected async processBlockLogs(
    state: DeepReadonly<PoolState>,
    logs: Readonly<Log>[],
    blockHeader: Readonly<BlockHeader>,
  ): Promise<DeepReadonly<PoolState> | null> {
    const newState = await super.processBlockLogs(state, logs, blockHeader);
    if (newState && newState.isValid === false) {
      return await this.generateState(blockHeader.number);
    }
    return newState;
  }

  handleAddLiquidity(event: any, state: PoolState, log: Log): PoolState {
    super.handleAddLiquidity(event, state, log);
    state.supply = bigNumberify(stringify(event.args.token_supply));
    return state;
  }

  handleRemoveLiquidityImbalances(
    event: any,
    state: PoolState,
    log: Log,
  ): PoolState {
    super.handleRemoveLiquidityImbalances(event, state, log);
    state.supply = bigNumberify(stringify(event.args.token_supply));
    return state;
  }

  handleRemoveLiquidityOne(event: any, state: PoolState, log: Log): PoolState {
    const tokenAmount = bigNumberify(stringify(event.args.token_amount));
    const coinAmount = bigNumberify(stringify(event.args.coin_amount));

    // Coins with equal decimals can withdraw the same dust amount
    const matches = [...Array(this.N_COINS).keys()].filter(i =>
      this.calc_withdraw_one_coin(tokenAmount, i, state).eq(coinAmount),
    );
    if (matches.length !== 1) {
      this.logger.warn(
        `${this.parentName}_${this.address}: ${matches.length} coins match RemoveLiquidityOne amount ${coinAmount} in tx ${log.transactionHash}, refetching state at block ${log.blockNumber}`,
      );
      state.isValid = false;
      return state;
    }

    this.remove_liquidity_one_coin(tokenAmount, matches[0], state);
    state.supply = bigNumberify(stringify(event.args.token_supply));
    return state;
  }

  public _get_dy(
    i: number,
    j: number,
    dx: BigNumber,
    A: BigNumber,
    fee: BigNumber,
    balances: BigNumber[],
    rates: BigNumber[],
    usefee = true,
  ): BigNumber {
    const xp = this._xp(rates, balances);
    const x = xp[i].plus(dx.times(rates[i]).idiv(this.PRECISION));
    const y = this.get_y(i, j, x, xp, A);
    const dy = xp[j].minus(y).minus(BN_1);
    const _fee = usefee ? fee.times(dy).idiv(this.FEE_DENOMINATOR) : BN_0;
    return dy.minus(_fee).times(this.PRECISION).idiv(rates[j]);
  }
}

import _ from 'lodash';
import { Interface } from '@ethersproject/abi';
import BigNumber from 'bignumber.js';
import { Logger } from 'log4js';
import { Address, Log } from '../../../types';
import { StatefulEventSubscriber } from '../../../stateful-event-subscriber';
import { DeepReadonly } from 'ts-essentials';
// import { getManyPoolStates } from './getstate-multicall';
import { BN_0, BN_1, BN_POWS } from '../../../bignumber-constants';
import { IDexHelper } from '../../../dex-helper';
import { erc20Iface } from '../../../lib/utils-interfaces';
import { bigNumberify, catchParseLogError, stringify } from '../../../utils';
import { getManyPoolStates } from './getstate-multicall';

export interface PoolState {
  A: BigNumber;
  fee: BigNumber;
  admin_fee: BigNumber;
  supply: BigNumber;
  balances: BigNumber[];
}

export abstract class CurvePool extends StatefulEventSubscriber<PoolState> {
  // Common constants across all the pools
  protected FEE_DENOMINATOR = BN_POWS[10];
  protected LENDING_PRECISION: BigNumber = BN_POWS[18];
  protected PRECISION: BigNumber = BN_POWS[18];

  public handlers: {
    [event: string]: (event: any, state: PoolState, log: Log) => PoolState;
  } = {};
  public poolIface: Interface;

  decoder: (log: Log) => any;

  constructor(
    public parentName: string,
    protected dexHelper: IDexHelper,
    logger: Logger,
    public pool: string,
    public address: Address,
    public tokenAddress: Address,
    protected trackCoins: boolean,
    protected abi: any,
    // Constants specific for a particular pool
    public N_COINS: number,
    public PRECISION_MUL: BigNumber[],
    public USE_LENDING: boolean[],
    public COINS: Address[],
  ) {
    super(parentName, `${pool}_${address}`, dexHelper, logger);

    this.addressesSubscribed = [this.address];
    if (trackCoins) {
      this.addressesSubscribed = _.concat(this.COINS, this.addressesSubscribed);
    }

    // Add default handlers
    this.handlers['AddLiquidity'] = this.handleAddLiquidity.bind(this);
    this.handlers['RemoveLiquidity'] = this.handleRemoveLiquidity.bind(this);
    this.handlers['TokenExchange'] = this.handleTokenExchange.bind(this);
    this.handlers['RemoveLiquidityImbalance'] =
      this.handleRemoveLiquidityImbalances.bind(this);
    this.handlers['NewParameters'] = this.handleNewParameters.bind(this);

    this.poolIface = new Interface(this.abi);
    this.decoder = (log: Log) => {
      if (
        this.trackCoins &&
        _.findIndex(
          this.COINS,
          c => c.toLowerCase() === log.address.toLowerCase(),
        ) != -1
      )
        return erc20Iface.parseLog(log);

      return this.poolIface.parseLog(log);
    };
  }

  public processLog(
    state: DeepReadonly<PoolState>,
    log: Readonly<Log>,
  ): DeepReadonly<PoolState> | null {
    let _state: PoolState = {
      A: bigNumberify(state.A),
      fee: bigNumberify(state.fee),
      admin_fee: bigNumberify(state.admin_fee),
      supply: bigNumberify(state.supply),
      balances: state.balances.map(bigNumberify),
    };
    try {
      const event = this.decoder(log);

      if (event.name in this.handlers) {
        return this.handlers[event.name](event, _state, log);
      }
      return _state;
    } catch (e) {
      catchParseLogError(e, this.logger);
    }
    return _state;
  }

  async setup(blockNumber: number, poolState: PoolState | null = null) {
    if (!poolState) poolState = await this.generateState(blockNumber);
    if (blockNumber) this.setState(poolState, blockNumber);
  }

  protected getRates() {
    return [...this.PRECISION_MUL].map(r => r.times(this.LENDING_PRECISION));
  }

  async generateState(
    blockNumber: number | 'latest' = 'latest',
  ): Promise<Readonly<PoolState>> {
    return (
      await getManyPoolStates([this], this.dexHelper.multiContract, blockNumber)
    )[0];
  }

  handleNewParameters(event: any, state: PoolState, log: Log): PoolState {
    const A = bigNumberify(stringify(event.args.A));
    const fee = bigNumberify(stringify(event.args.fee));
    const admin_fee = bigNumberify(stringify(event.args.admin_fee));

    state.A = A;
    state.fee = fee;
    state.admin_fee = admin_fee;
    return state;
  }

  handleRemoveLiquidity(event: any, state: PoolState, log: Log): PoolState {
    const token_amounts = event.args.token_amounts
      .map(stringify)
      .map(bigNumberify);
    const token_supply = bigNumberify(stringify(event.args.token_supply));

    for (let i = 0; i < this.N_COINS; i++) {
      state.balances[i] = state.balances[i].minus(token_amounts[i]);
    }
    state.supply = token_supply;
    return state;
  }

  handleRemoveLiquidityImbalances(
    event: any,
    state: PoolState,
    log: Log,
  ): PoolState {
    const amounts = event.args.token_amounts.map(stringify).map(bigNumberify);
    const rates = this.getRates();

    const token_supply: BigNumber = state.supply;
    // assert token_supply != 0  # dev: zero total supply
    const _fee: BigNumber = state.fee
      .times(this.N_COINS)
      .idiv(4 * (this.N_COINS - 1));
    const _admin_fee: BigNumber = state.admin_fee;
    const amp: BigNumber = state.A;

    const old_balances: BigNumber[] = state.balances;
    let new_balances: BigNumber[] = _.clone(old_balances);
    const D0: BigNumber = this.get_D_mem(rates, old_balances, amp);
    for (let i = 0; i < this.N_COINS; i++) {
      new_balances[i] = new_balances[i].minus(amounts[i]);
    }
    const D1: BigNumber = this.get_D_mem(rates, new_balances, amp);
    const fees: BigNumber[] = new Array<BigNumber>(this.N_COINS);
    for (let i = 0; i < this.N_COINS; i++) {
      const ideal_balance: BigNumber = D1.times(old_balances[i]).idiv(D0);
      let difference: BigNumber = BN_0;
      if (ideal_balance.gt(new_balances[i])) {
        difference = ideal_balance.minus(new_balances[i]);
      } else {
        difference = new_balances[i].minus(ideal_balance);
      }
      fees[i] = _fee.times(difference).idiv(this.FEE_DENOMINATOR);
      state.balances[i] = new_balances[i].minus(
        fees[i].times(_admin_fee).idiv(this.FEE_DENOMINATOR),
      );
      new_balances[i] = new_balances[i].minus(fees[i]);
    }
    const D2: BigNumber = this.get_D_mem(rates, new_balances, amp);

    let token_amount: BigNumber = D0.minus(D2).times(token_supply).idiv(D0);
    // assert token_amount != 0  # dev: zero tokens burned
    token_amount = token_amount.plus(1); // In case of rounding errors - make it unfavorable for the "attacker"
    // assert token_amount <= max_burn_amount, "Slippage screwed you"

    // state.token.burnFrom(msg.sender, token_amount)  # dev: insufficient funds
    // TODO: token supply should be handled by token subscriptions
    state.supply = state.supply.minus(token_amount);
    return state;
  }

  exchange(i: number, j: number, dx: BigNumber, state: PoolState): BigNumber {
    const rates = this.getRates();

    const old_balances: BigNumber[] = state.balances;
    const xp: BigNumber[] = this._xp_mem(rates, old_balances);

    const dx_w_fee: BigNumber = dx;
    // TODO: Handling an unexpected charge of a fee on transfer (USDT, PAXG)
    /* Original contract does the actual transfer from sender to contract here*/

    const x: BigNumber = xp[i].plus(
      dx_w_fee.times(rates[i]).idiv(this.PRECISION),
    );
    const y: BigNumber = this.get_y(i, j, x, xp, state.A);

    let dy: BigNumber = xp[j].minus(y).minus(1); // -1 just in case there were some rounding errors
    const dy_fee: BigNumber = dy.times(state.fee).idiv(this.FEE_DENOMINATOR);

    // Convert all to real units
    dy = dy.minus(dy_fee).times(this.PRECISION).idiv(rates[j]);

    let dy_admin_fee: BigNumber = dy_fee
      .times(state.admin_fee)
      .idiv(this.FEE_DENOMINATOR);
    dy_admin_fee = dy_admin_fee.times(this.PRECISION).idiv(rates[j]);

    // Change balances exactly in same way as we change actual ERC20 coin amounts
    state.balances[i] = old_balances[i].plus(dx_w_fee);
    // When rounding errors happen, we undercharge admin fee in favor of LP
    state.balances[j] = old_balances[j].minus(dy).minus(dy_admin_fee);

    /* Original contract does the actual transfer from contract to sender here*/
    return dy;
  }

  handleTokenExchange(event: any, state: PoolState, log: Log): PoolState {
    const i = event.args.sold_id.toNumber();
    const j = event.args.bought_id.toNumber();
    const dx = bigNumberify(stringify(event.args.tokens_sold));
    this.exchange(i, j, dx, state);
    return state;
  }

  add_liquidity(amounts: BigNumber[], state: PoolState): BigNumber {
    const rates = this.getRates();

    let fees: BigNumber[] = new Array<BigNumber>(this.N_COINS);
    const _fee: BigNumber = state.fee
      .times(this.N_COINS)
      .idiv(4 * (this.N_COINS - 1));
    const _admin_fee: BigNumber = state.admin_fee;
    // TODO: This might be incorrect as the original contract uses amplification factor
    const amp: BigNumber = state.A;

    // TODO: This can be incorrect as the contract always uses the token contract to get the supply
    const token_supply: BigNumber = state.supply;
    // Initial invariant
    let D0: BigNumber = BN_0;
    const old_balances: BigNumber[] = state.balances;
    if (token_supply.gt(0)) {
      D0 = this.get_D_mem(rates, old_balances, amp);
    }
    const new_balances: BigNumber[] = _.clone(old_balances);

    for (let i = 0; i < this.N_COINS; i++) {
      const in_amount: BigNumber = amounts[i];
      /* Original contract does the actual transfer here*/
      // TODO: This can be incorrect because of the fees charged which might differ the actual value
      new_balances[i] = old_balances[i].plus(in_amount);
    }

    // Invariant after change
    const D1: BigNumber = this.get_D_mem(rates, new_balances, amp);

    // We need to recalculate the invariant accounting for fees
    // to calculate fair user's share
    let D2: BigNumber = D1;
    if (token_supply.gt(BN_0)) {
      // Only account for fees if we are not the first to deposit
      for (let i = 0; i < this.N_COINS; i++) {
        const ideal_balance: BigNumber = D1.times(old_balances[i]).idiv(D0);
        let difference: BigNumber = BN_0;
        if (ideal_balance.gt(new_balances[i])) {
          difference = ideal_balance.minus(new_balances[i]);
        } else {
          difference = new_balances[i].minus(ideal_balance);
        }
        fees[i] = _fee.times(difference).idiv(this.FEE_DENOMINATOR);
        state.balances[i] = new_balances[i].minus(
          fees[i].times(_admin_fee).idiv(this.FEE_DENOMINATOR),
        );
        new_balances[i] = new_balances[i].minus(fees[i]);
      }
      D2 = this.get_D_mem(rates, new_balances, amp);
    } else {
      state.balances = new_balances;
    }

    // Calculate, how much pool tokens to mint
    /* Original contract does the minting of the token here*/
    let mint_amount: BigNumber;
    if (token_supply.eq(0)) mint_amount = D1;
    // Take the dust if there was any
    else mint_amount = token_supply.times(D2.minus(D0)).idiv(D0);
    state.supply = state.supply.plus(mint_amount);

    return mint_amount;
  }

  handleAddLiquidity(event: any, state: PoolState, log: Log): PoolState {
    const amounts = event.args.token_amounts.map(stringify).map(bigNumberify);
    this.add_liquidity(amounts, state);
    return state;
  }

  public _get_dy_underlying(
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
    const x = xp[i].plus(dx.times(this.PRECISION_MUL[i]));
    const y = this.get_y(i, j, x, xp, A);
    const dy = xp[j].minus(y).idiv(this.PRECISION_MUL[j]);
    let _fee = fee.times(dy).idiv(this.FEE_DENOMINATOR);
    if (!usefee) _fee = BN_0;
    return dy.minus(_fee);
  }

  public get_dy_underlying(
    i: number,
    j: number,
    dx: BigNumber,
    state: Readonly<PoolState>,
  ): BigNumber {
    const rates = this.getRates();
    return this._get_dy_underlying(
      i,
      j,
      dx,
      bigNumberify(state.A),
      bigNumberify(state.fee),
      state.balances.map(bigNumberify),
      rates,
    );
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
    const dy = xp[j].minus(y).times(this.PRECISION).idiv(rates[j]);
    let _fee = fee.times(dy).idiv(this.FEE_DENOMINATOR);
    if (!usefee) _fee = BN_0;
    return dy.minus(_fee);
  }

  public get_virtual_price(state: PoolState): BigNumber {
    // Returns portfolio virtual price (for calculating profit)
    // scaled up by 1e18
    const D = this.get_D(this._xp(this.getRates(), state.balances), state.A);
    // D is in the units similar to DAI (e.g. converted to precision 1e18)
    // When balanced, D = n * x_u - total virtual value of the portfolio
    const token_supply = state.supply;
    return D.times(this.PRECISION).idiv(token_supply);
  }

  public get_dy(
    i: number,
    j: number,
    dx: BigNumber,
    state: Readonly<PoolState>,
  ): BigNumber {
    const rates = this.getRates();
    return this._get_dy(
      i,
      j,
      dx,
      bigNumberify(state.A),
      bigNumberify(state.fee),
      state.balances.map(bigNumberify),
      rates,
    );
  }

  get_D(xp: BigNumber[], amp: BigNumber): BigNumber {
    let S = BN_0;
    for (const _x of xp) S = S.plus(_x);
    if (S.eq(0)) return BN_0;

    let Dprev = BN_0;
    let D = bigNumberify(S);
    const Ann = amp.times(this.N_COINS);
    for (let _i = 0; _i < 255; _i++) {
      let D_P = bigNumberify(D);
      for (const _x of xp) {
        D_P = D_P.times(D).idiv(_x.times(this.N_COINS));
      }
      Dprev = bigNumberify(D);
      D = Ann.times(S)
        .plus(D_P.times(this.N_COINS))
        .times(D)
        .idiv(
          Ann.minus(1)
            .times(D)
            .plus(bigNumberify(this.N_COINS + 1).times(D_P)),
        );
      if (D.gt(Dprev)) {
        if (D.minus(Dprev).lte(1)) break;
      } else {
        if (Dprev.minus(D).lte(1)) break;
      }
    }
    return D;
  }

  get_y(
    i: number,
    j: number,
    x: BigNumber,
    xp: BigNumber[],
    A: BigNumber,
  ): BigNumber {
    // if(! ((i != j) && (i >= 0) && (j >= 0) && (i < this.N_COINS) && (j < this.N_COINS))) throw new Error('get y assert failed')

    const D = this.get_D(xp, A);

    let c = bigNumberify(D);
    let S_ = BN_0;
    const Ann = A.times(this.N_COINS);

    let _x = BN_0;
    for (let _i = 0; _i < this.N_COINS; _i++) {
      if (_i === i) _x = x;
      else if (_i !== j) _x = xp[_i];
      else continue;
      S_ = S_.plus(_x);
      c = c.times(D).idiv(_x.times(this.N_COINS));
    }
    c = c.times(D).idiv(Ann.times(this.N_COINS));
    const b = S_.plus(D.idiv(Ann));
    let yPrev = BN_0;
    let y = bigNumberify(D);
    for (let o = 0; o < 255; o++) {
      yPrev = bigNumberify(y);
      const y1 = y.times(y);
      const y2 = y1.plus(c);

      const y3 = bigNumberify(2).times(y);
      const y4 = y3.plus(b).minus(D);

      y = y2.idiv(y4);

      if (y.gt(yPrev)) {
        if (y.minus(yPrev).lte(1)) break;
      } else {
        if (yPrev.minus(y).lte(1)) break;
      }
    }
    return y;
  }

  get_D_mem(rates: BigNumber[], balances: BigNumber[], amp: BigNumber) {
    return this.get_D(this._xp_mem(rates, balances), amp);
  }

  protected _xp(rates: BigNumber[], balances: BigNumber[]): BigNumber[] {
    return this._xp_mem(rates, balances);
  }

  protected _xp_mem(rates: BigNumber[], balances: BigNumber[]): BigNumber[] {
    const result = [...rates];
    for (let i = 0; i < this.N_COINS; i++) {
      result[i] = result[i].times(balances[i]).idiv(this.PRECISION);
    }
    return result;
  }
}

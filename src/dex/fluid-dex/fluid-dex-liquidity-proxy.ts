import { DeepReadonly } from 'ts-essentials';
import { Log, Logger } from '../../types';
import { bigIntify, catchParseLogError } from '../../utils';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { IDexHelper } from '../../dex-helper/idex-helper';
import ResolverABI from '../../abi/fluid-dex/resolver.abi.json';
import LiquidityABI from '../../abi/fluid-dex/liquidityUserModule.abi.json';
import {
  CommonAddresses,
  FluidDexLiquidityProxyState,
  PoolReserve,
  PoolReserveResponse,
} from './types';
import { Address } from '../../types';
import { Contract, Interface } from 'ethers';

export class FluidDexLiquidityProxy extends StatefulEventSubscriber<FluidDexLiquidityProxyState> {
  handlers: {
    [event: string]: (
      event: any,
      state: DeepReadonly<FluidDexLiquidityProxyState>,
      log: Readonly<Log>,
    ) => Promise<DeepReadonly<FluidDexLiquidityProxyState> | null>;
  } = {};

  logDecoder: (log: Log) => any;

  addressesSubscribed: Address[];

  readonly liquidityIface = new Interface(LiquidityABI);

  readonly resolverIface = new Interface(ResolverABI);

  resolverContract: Contract;

  constructor(
    readonly parentName: string,
    readonly commonAddresses: CommonAddresses,
    protected network: number,
    readonly dexHelper: IDexHelper,
    logger: Logger,
  ) {
    super(parentName, 'liquidity proxy', dexHelper, logger);

    this.logDecoder = (log: Log) => this.liquidityIface.parseLog(log);

    this.resolverContract = new Contract(
      this.commonAddresses.resolver,
      ResolverABI,
      this.dexHelper.provider,
    );

    this.addressesSubscribed = [commonAddresses.liquidityProxy];

    // Add handlers
    this.handlers['LogOperate'] = this.handleOperate.bind(this);
  }

  /**
   * Handle a trade rate change on the pool.
   */
  async handleOperate(
    event: any,
    state: DeepReadonly<FluidDexLiquidityProxyState>,
    log: Readonly<Log>,
  ): Promise<DeepReadonly<FluidDexLiquidityProxyState> | null> {
    return this.generateState(log.blockNumber);
  }

  /**
   * The function is called every time any of the subscribed
   * addresses release log. The function accepts the current
   * state, updates the state according to the log, and returns
   * the updated state.
   * @param state - Current state of event subscriber
   * @param log - Log released by one of the subscribed addresses
   * @returns Updates state of the event subscriber after the log
   */
  async processLog(
    state: DeepReadonly<FluidDexLiquidityProxyState>,
    log: Readonly<Log>,
  ): Promise<DeepReadonly<FluidDexLiquidityProxyState> | null> {
    try {
      const event = this.logDecoder(log);
      if (event.name in this.handlers) {
        return await this.handlers[event.name](event, state, log);
      }
    } catch (e) {
      catchParseLogError(e, this.logger);
    }

    return null;
  }

  async getStateOrGenerate(
    blockNumber: number,
    readonly: boolean = false,
  ): Promise<FluidDexLiquidityProxyState> {
    let state = this.getState(blockNumber);
    if (!state) {
      state = await this.generateState(blockNumber);
      if (!readonly) this.setState(state, blockNumber);
    }
    return state;
  }

  /**
   * The function generates state using on-chain calls. This
   * function is called to regenerate state if the event based
   * system fails to fetch events and the local state is no
   * more correct.
   * @param blockNumber - Blocknumber for which the state should
   * should be generated
   * @returns state of the event subscriber at blocknumber
   */
  async generateState(
    blockNumber: number,
  ): Promise<DeepReadonly<FluidDexLiquidityProxyState>> {
    const rawResult = await this.resolverContract.getAllPoolsReservesAdjusted({
      blockTag: blockNumber,
    });

    const convertedResult = this.convertToFluidDexPoolState(rawResult);
    this.logger.info(`${this.parentName}: ${this.name}: generating state...`);

    return convertedResult;
  }

  private convertToFluidDexPoolState(
    poolReserves: PoolReserveResponse[],
  ): FluidDexLiquidityProxyState {
    const result: PoolReserve[] = poolReserves.map(poolReserve => {
      const [
        pool,
        token0,
        token1,
        feeHex,
        centerPriceHex,
        collateralReservesHex,
        debtReservesHex,
        dexLimitsHex,
      ] = poolReserve;

      const fee = Number(feeHex.toString());
      const centerPrice = Number(centerPriceHex.toString());

      const collateralReserves = {
        token0RealReserves: bigIntify(collateralReservesHex[0]),
        token1RealReserves: bigIntify(collateralReservesHex[1]),
        token0ImaginaryReserves: bigIntify(collateralReservesHex[2]),
        token1ImaginaryReserves: bigIntify(collateralReservesHex[3]),
      };

      const debtReserves = {
        token0Debt: bigIntify(debtReservesHex[0]),
        token1Debt: bigIntify(debtReservesHex[1]),
        token0RealReserves: bigIntify(debtReservesHex[2]),
        token1RealReserves: bigIntify(debtReservesHex[3]),
        token0ImaginaryReserves: bigIntify(debtReservesHex[4]),
        token1ImaginaryReserves: bigIntify(debtReservesHex[5]),
      };

      const withdrawableToken0 = {
        available: bigIntify(dexLimitsHex[0][0]),
        expandsTo: bigIntify(dexLimitsHex[0][1]),
        expandsDuration: bigIntify(dexLimitsHex[0][2]),
      };

      const withdrawableToken1 = {
        available: bigIntify(dexLimitsHex[1][0]),
        expandsTo: bigIntify(dexLimitsHex[1][1]),
        expandsDuration: bigIntify(dexLimitsHex[1][2]),
      };

      const borrowableToken0 = {
        available: bigIntify(dexLimitsHex[2][0]),
        expandsTo: bigIntify(dexLimitsHex[2][1]),
        expandsDuration: bigIntify(dexLimitsHex[2][2]),
      };

      const borrowableToken1 = {
        available: bigIntify(dexLimitsHex[3][0]),
        expandsTo: bigIntify(dexLimitsHex[3][1]),
        expandsDuration: bigIntify(dexLimitsHex[3][2]),
      };

      const dexLimits = {
        withdrawableToken0,
        withdrawableToken1,
        borrowableToken0,
        borrowableToken1,
      };

      return {
        pool,
        token0,
        token1,
        fee,
        centerPrice,
        collateralReserves,
        debtReserves,
        dexLimits,
      };
    });

    return { poolsReserves: result };
  }
}

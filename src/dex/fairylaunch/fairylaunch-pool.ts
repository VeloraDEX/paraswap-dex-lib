import { Interface } from '@ethersproject/abi';
import { AsyncOrSync, DeepReadonly } from 'ts-essentials';
import { Log, Logger, Address } from '../../types';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { Network } from '../../constants';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { PoolState } from './types';
import LaunchFactoryABI from '../../abi/fairylaunch/LaunchFactory.json';
import BondingCurveABI from '../../abi/fairylaunch/BondingCurve.json';

const launchFactoryIface = new Interface(LaunchFactoryABI);
const bondingCurveIface = new Interface(BondingCurveABI);

export class FairylaunchEventPool extends StatefulEventSubscriber<PoolState> {
  handlers: {
    [event: string]: (
      event: any,
      state: DeepReadonly<PoolState>,
    ) => DeepReadonly<PoolState> | null;
  } = {};

  private knownBondingCurves: Set<string> = new Set();
  private statesByCurve: Map<string, PoolState> = new Map();

  constructor(
    readonly dexKey: string,
    readonly network: Network,
    readonly dexHelper: IDexHelper,
    readonly logger: Logger,
    readonly launchFactoryAddress: Address,
  ) {
    super(
      dexKey,
      dexKey,
      dexHelper,
      logger,
      false,
      '',
    );

    this.addressesSubscribed = [launchFactoryAddress];

    this.handlers['Buy'] = this.handleBuy.bind(this);
    this.handlers['Sell'] = this.handleSell.bind(this);
    this.handlers['Graduate'] = this.handleGraduate.bind(this);
    this.handlers['LaunchCreated'] = this.handleLaunchCreated.bind(this);
  }

  async generateState(blockNumber: number): Promise<DeepReadonly<PoolState>> {
    const launchFactoryContract = new this.dexHelper.web3Provider.eth.Contract(
      LaunchFactoryABI as any,
      this.launchFactoryAddress,
    );

    const totalLaunches = Number(
      await launchFactoryContract.methods.totalLaunches().call({}, blockNumber),
    );

    // CORRECCIÓN BUGBOT: SIEMPRE limpiar antes de regenerar
    this.statesByCurve.clear();
    this.knownBondingCurves.clear();

    if (totalLaunches === 0) {
      this.updateSubscriptions();
      return this.getEmptyState();
    }

    // Registrar todas las BondingCurves y sus estados
    for (let i = 1; i <= totalLaunches; i++) {
      try {
        const launchInfo = await launchFactoryContract.methods.getLaunch(i).call({}, blockNumber);
        if (!launchInfo.graduated) {
          const curveAddress = launchInfo.bondingCurve.toLowerCase();
          this.knownBondingCurves.add(curveAddress);
          
          const bondingCurveContract = new this.dexHelper.web3Provider.eth.Contract(
            BondingCurveABI as any,
            launchInfo.bondingCurve,
          );

          const [ethReserve, tokenReserve, totalTokensSold, graduated] = await Promise.all([
            bondingCurveContract.methods.ethReserve().call({}, blockNumber),
            bondingCurveContract.methods.tokenReserve().call({}, blockNumber),
            bondingCurveContract.methods.totalTokensSold().call({}, blockNumber),
            bondingCurveContract.methods.graduated().call({}, blockNumber),
          ]);

          const curveState: PoolState = {
            bondingCurve: launchInfo.bondingCurve,
            token: launchInfo.token,
            ethReserve: BigInt(ethReserve.toString()),
            tokenReserve: BigInt(tokenReserve.toString()),
            totalTokensSold: BigInt(totalTokensSold.toString()),
            graduated,
            launchId: Number(launchInfo.launchId),
          };

          this.statesByCurve.set(curveAddress, curveState);
        }
      } catch (e) {
        this.logger.warn(`Error getting launch ${i}: ${(e as Error).message}`);
      }
    }

    this.updateSubscriptions();

    const firstActive = Array.from(this.statesByCurve.values()).find(s => !s.graduated);
    if (firstActive) {
      return firstActive;
    }

    return this.getEmptyState();
  }

  private getEmptyState(): DeepReadonly<PoolState> {
    return {
      bondingCurve: '',
      token: '',
      ethReserve: 0n,
      tokenReserve: 0n,
      totalTokensSold: 0n,
      graduated: true,
      launchId: 0,
    };
  }

  private updateSubscriptions(): void {
    this.addressesSubscribed = [
      this.launchFactoryAddress,
      ...Array.from(this.knownBondingCurves),
    ];
  }

  protected processLog(
    state: DeepReadonly<PoolState>,
    log: Readonly<Log>,
  ): AsyncOrSync<DeepReadonly<PoolState> | null> {
    try {
      const event = bondingCurveIface.parseLog(log);
      const handler = this.handlers[event.name];
      if (handler) {
        return handler(event, state);
      }
      return null;
    } catch (e) {
      try {
        const event = launchFactoryIface.parseLog(log);
        const handler = this.handlers[event.name];
        if (handler) {
          return handler(event, state);
        }
      } catch (e2) {
        // Ignorar
      }
      return null;
    }
  }

  protected getPoolIdentifierData() {
    return {
      dexKey: this.parentName,
      poolName: this.name,
      bondingCurves: Array.from(this.knownBondingCurves),
    };
  }

  handleLaunchCreated(
    event: any,
    state: DeepReadonly<PoolState>,
  ): DeepReadonly<PoolState> | null {
    const { bondingCurve } = event.args;
    if (bondingCurve) {
      const curveAddress = bondingCurve.toLowerCase();
      this.knownBondingCurves.add(curveAddress);
      this.updateSubscriptions();
    }
    return state;
  }

  handleBuy(
    event: any,
    state: DeepReadonly<PoolState>,
  ): DeepReadonly<PoolState> | null {
    const curveAddress = (event.address || state.bondingCurve).toLowerCase();
    const curveState = this.statesByCurve.get(curveAddress) || state;
    
    const newState: PoolState = {
      ...curveState,
      bondingCurve: curveAddress,
      ethReserve: BigInt(event.args.ethReserveAfter.toString()),
      tokenReserve: curveState.tokenReserve - BigInt(event.args.tokenAmount.toString()),
      totalTokensSold: curveState.totalTokensSold + BigInt(event.args.tokenAmount.toString()),
    };
    
    this.statesByCurve.set(curveAddress, newState);
    return newState;
  }

  handleSell(
    event: any,
    state: DeepReadonly<PoolState>,
  ): DeepReadonly<PoolState> | null {
    const curveAddress = (event.address || state.bondingCurve).toLowerCase();
    const curveState = this.statesByCurve.get(curveAddress) || state;
    
    const newState: PoolState = {
      ...curveState,
      bondingCurve: curveAddress,
      ethReserve: BigInt(event.args.ethReserveAfter.toString()),
      tokenReserve: curveState.tokenReserve + BigInt(event.args.tokenAmount.toString()),
      totalTokensSold: curveState.totalTokensSold - BigInt(event.args.tokenAmount.toString()),
    };
    
    this.statesByCurve.set(curveAddress, newState);
    return newState;
  }

  handleGraduate(
    event: any,
    state: DeepReadonly<PoolState>,
  ): DeepReadonly<PoolState> | null {
    const curveAddress = (event.address || state.bondingCurve).toLowerCase();
    const curveState = this.statesByCurve.get(curveAddress) || state;
    
    const newState: PoolState = {
      ...curveState,
      graduated: true,
    };
    
    this.statesByCurve.set(curveAddress, newState);
    return newState;
  }
}
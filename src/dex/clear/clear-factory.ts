import { Contract } from 'ethers';
import { DeepReadonly } from 'ts-essentials';
import { Log, Logger, Address } from '../../types';
import { catchParseLogError } from '../../utils';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { IDexHelper } from '../../dex-helper';
import { MultiCallParams } from '../../lib/multi-wrapper';
import { addressArrayDecode, addressDecode } from '../../lib/decoders';
import { DexParams, FactoryState, FactoryEntry } from './types';
import ClearFactoryABI from '../../abi/clear/ClearFactory.json';
import { factoryIface, vaultIface } from './clear-ifaces';

type Handler = (
  event: any,
  state: DeepReadonly<FactoryState>,
) => DeepReadonly<FactoryState> | null;

export class ClearFactory extends StatefulEventSubscriber<FactoryState> {
  addressesSubscribed: Address[];
  protected handlers: Record<string, Handler> = {};

  constructor(
    readonly parentName: string,
    readonly config: DexParams,
    protected network: number,
    protected dexHelper: IDexHelper,
    logger: Logger,
  ) {
    super(parentName, 'factory', dexHelper, logger);
    this.addressesSubscribed = [config.factoryAddress];
    this.handlers['NewClearVault'] = this.handleNewClearVault.bind(this);
  }

  protected processLog(
    state: DeepReadonly<FactoryState>,
    log: Readonly<Log>,
  ): DeepReadonly<FactoryState> | null {
    try {
      const event = factoryIface.parseLog(log);
      if (event.name in this.handlers) {
        return this.handlers[event.name](event, state);
      }
    } catch (e) {
      catchParseLogError(e, this.logger);
    }
    return null;
  }

  protected handleNewClearVault(
    event: any,
    state: DeepReadonly<FactoryState>,
  ): DeepReadonly<FactoryState> | null {
    const address = String(event.args.vault).toLowerCase();
    const tokens = (event.args.tokens as string[]).map(a => a.toLowerCase());
    const curvePlainPool = String(event.args.curvePlainPool).toLowerCase();
    if (state.some(v => v.address === address)) return null;
    return [...state, { address, tokens, curvePlainPool }];
  }

  async getStateOrGenerate(
    blockNumber: number,
  ): Promise<DeepReadonly<FactoryState>> {
    let state = this.getState(blockNumber);
    if (!state) {
      state = await this.generateState(blockNumber);
      this.setState(state, blockNumber);
    }
    return state;
  }

  // Bootstrap: read all vault addresses, then per-vault tokens() and tokensCurvePool() in one batch.
  async generateState(
    blockNumber: number,
  ): Promise<DeepReadonly<FactoryState>> {
    const factoryContract = new Contract(
      this.config.factoryAddress,
      ClearFactoryABI,
      this.dexHelper.provider,
    );

    const vaultsLengthBN = await factoryContract.vaultsLength({
      blockTag: blockNumber,
    });
    const vaultsLength = vaultsLengthBN.toNumber();
    if (vaultsLength === 0) return [];

    const indexes = [...Array(vaultsLength).keys()];
    const vaultAddressesRaw: string[] =
      await factoryContract.getBatchVaultAddresses(indexes, {
        blockTag: blockNumber,
      });
    const vaultAddresses = vaultAddressesRaw.map(a => a.toLowerCase());

    type Decoded = string[] | string;
    const calls: MultiCallParams<Decoded>[] = [];
    for (const vault of vaultAddresses) {
      calls.push({
        target: vault,
        callData: vaultIface.encodeFunctionData('tokens'),
        decodeFunction: addressArrayDecode as any,
      });
      calls.push({
        target: vault,
        callData: vaultIface.encodeFunctionData('tokensCurvePool'),
        decodeFunction: addressDecode as any,
      });
    }
    const results = await this.dexHelper.multiWrapper.tryAggregate<Decoded>(
      false,
      calls,
      blockNumber,
    );

    const vaults: FactoryEntry[] = [];
    for (let i = 0; i < vaultAddresses.length; i++) {
      const tokensRes = results[i * 2];
      const curveRes = results[i * 2 + 1];
      if (!tokensRes.success || !tokensRes.returnData) continue;
      const tokens = (tokensRes.returnData as string[]).map(a =>
        a.toLowerCase(),
      );
      const curvePlainPool = curveRes.success
        ? String(curveRes.returnData).toLowerCase()
        : '';
      vaults.push({ address: vaultAddresses[i], tokens, curvePlainPool });
    }

    return vaults;
  }
}

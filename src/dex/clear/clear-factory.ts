import { Contract } from 'ethers';
import { Interface } from '@ethersproject/abi';
import { DeepReadonly } from 'ts-essentials';
import { Log, Logger } from '../../types';
import { catchParseLogError } from '../../utils';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { IDexHelper } from '../../dex-helper';
import { MultiCallParams } from '../../lib/multi-wrapper';
import { Address } from '../../types';
import { ClearVault, DexParams } from './types';
import ClearFactoryABI from '../../abi/clear/ClearFactory.json';
import ClearVaultABI from '../../abi/clear/ClearVault.json';
import { addressArrayDecode } from '../../lib/decoders';

export class ClearFactory extends StatefulEventSubscriber<ClearVault[]> {
  handlers: {
    [event: string]: (
      event: any,
      state: DeepReadonly<ClearVault[]>,
      log: Readonly<Log>,
    ) => Promise<DeepReadonly<ClearVault[]> | null>;
  } = {};

  logDecoder: (log: Log) => any;

  addressesSubscribed: Address[];

  protected factoryIface = new Interface(ClearFactoryABI);
  protected vaultIface = new Interface(ClearVaultABI);
  protected factoryContract: Contract;

  constructor(
    readonly parentName: string,
    readonly config: DexParams,
    protected network: number,
    protected dexHelper: IDexHelper,
    logger: Logger,
  ) {
    super(parentName, 'factory', dexHelper, logger);

    this.logDecoder = (log: Log) => this.factoryIface.parseLog(log);
    this.addressesSubscribed = [config.factoryAddress];
    this.factoryContract = new Contract(
      config.factoryAddress,
      ClearFactoryABI,
      dexHelper.provider,
    );

    this.handlers['NewClearVault'] = this.handleNewClearVault.bind(this);
  }

  async handleNewClearVault(
    event: any,
    state: DeepReadonly<ClearVault[]>,
    log: Readonly<Log>,
  ): Promise<DeepReadonly<ClearVault[]> | null> {
    const vaultAddress = event.args.vault.toLowerCase();

    const [tokenResult] = await this.dexHelper.multiWrapper.tryAggregate<
      string[]
    >(
      false,
      [
        {
          target: vaultAddress,
          callData: this.vaultIface.encodeFunctionData('tokens'),
          decodeFunction: addressArrayDecode as any,
        },
      ],
      log.blockNumber,
    );

    if (!tokenResult.success || !tokenResult.returnData) {
      this.logger.error(
        `${this.parentName}: Failed to fetch tokens for new vault ${vaultAddress}`,
      );
      return null;
    }

    const newVault: ClearVault = {
      address: vaultAddress,
      tokens: tokenResult.returnData.map(addr => ({
        address: addr.toLowerCase(),
      })),
    };

    return [...state, newVault];
  }

  async processLog(
    state: DeepReadonly<ClearVault[]>,
    log: Readonly<Log>,
  ): Promise<DeepReadonly<ClearVault[]> | null> {
    try {
      const event = this.logDecoder(log);
      if (event.name in this.handlers) {
        return this.handlers[event.name](event, state, log);
      }
    } catch (e) {
      catchParseLogError(e, this.logger);
    }

    return null;
  }

  async getStateOrGenerate(
    blockNumber: number,
  ): Promise<DeepReadonly<ClearVault[]>> {
    let state = this.getState(blockNumber);
    if (!state) {
      state = await this.generateState(blockNumber);
      this.setState(state, blockNumber);
    }
    return state;
  }

  /**
   * Generate state:
   * 1. vaultsLength() -> total count
   * 2. getBatchVaultAddresses() -> all addresses
   * 3. tokens() on each vault -> supported tokens
   */
  async generateState(
    blockNumber: number,
  ): Promise<DeepReadonly<ClearVault[]>> {
    // Step 1: Get total number of vaults
    const vaultsLengthBN = await this.factoryContract.vaultsLength({
      blockTag: blockNumber,
    });
    const vaultsLength = vaultsLengthBN.toNumber();

    if (vaultsLength === 0) return [];

    // Step 2: Get all vault addresses
    const vaultIndexes = [...Array(vaultsLength).keys()];
    const vaultAddressesRaw: string[] =
      await this.factoryContract.getBatchVaultAddresses(vaultIndexes, {
        blockTag: blockNumber,
      });

    const vaultAddresses = vaultAddressesRaw.map(a => a.toLowerCase());

    // Step 3: Fetch tokens for each vault
    const tokenCalls: MultiCallParams<string[]>[] = vaultAddresses.map(
      vault => ({
        target: vault,
        callData: this.vaultIface.encodeFunctionData('tokens'),
        decodeFunction: addressArrayDecode as any,
      }),
    );

    const tokenResults = await this.dexHelper.multiWrapper.tryAggregate<
      string[]
    >(false, tokenCalls, blockNumber);

    // Collect all valid vault data first
    const vaults: ClearVault[] = vaultAddresses
      .map((address, i) => {
        const result = tokenResults[i];
        if (!result.success || !result.returnData) {
          this.logger.warn(
            `${this.parentName}: Failed to fetch tokens for vault ${address}`,
          );
          return null;
        }

        return {
          address,
          tokens: result.returnData.map(addr => ({
            address: addr.toLowerCase(),
          })),
        };
      })
      .filter(Boolean) as ClearVault[];

    this.logger.info(
      `${this.parentName}: Generated state with ${vaults.length} vaults`,
    );

    return vaults;
  }
}

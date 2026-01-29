import { Interface } from '@ethersproject/abi';
import { DeepReadonly } from 'ts-essentials';
import { Log, Logger } from '../../types';
import { catchParseLogError } from '../../utils';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { IDexHelper } from '../../dex-helper';
import { MultiCallParams } from '../../lib/multi-wrapper';
import { Address } from '../../types';
import { uint256DecodeToNumber } from '../../lib/decoders';
import { ClearVault, DexParams } from './types';
import ClearFactoryABI from '../../abi/clear/ClearFactory.json';
import ClearVaultABI from '../../abi/clear/ClearVault.json';

type OnVaultCreatedCallback = (vaults: DeepReadonly<ClearVault[]>) => void;

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

  constructor(
    readonly parentName: string,
    readonly config: DexParams,
    protected network: number,
    protected dexHelper: IDexHelper,
    logger: Logger,
    protected readonly onVaultCreated: OnVaultCreatedCallback,
  ) {
    super(parentName, 'factory', dexHelper, logger);

    this.logDecoder = (log: Log) => this.factoryIface.parseLog(log);
    this.addressesSubscribed = [config.factoryAddress];

    // Add handler for NewClearVault event
    this.handlers['NewClearVault'] = this.handleNewClearVault.bind(this);
  }

  /**
   * Handle NewClearVault event - add the new vault to existing state
   */
  async handleNewClearVault(
    event: any,
    state: DeepReadonly<ClearVault[]>,
    log: Readonly<Log>,
  ): Promise<DeepReadonly<ClearVault[]> | null> {
    const vaultAddress = event.args.vault.toLowerCase();

    // Fetch tokens for the new vault
    const tokenCall: MultiCallParams<string[]> = {
      target: vaultAddress,
      callData: this.vaultIface.encodeFunctionData('tokens'),
      decodeFunction: (result: any) => {
        const decoded = this.vaultIface.decodeFunctionResult('tokens', result);
        return decoded[0] as string[];
      },
    };

    const [tokenResult] = await this.dexHelper.multiWrapper.tryAggregate<
      string[]
    >(false, [tokenCall], log.blockNumber);

    if (!tokenResult.success || !tokenResult.returnData) {
      this.logger.error(
        `${this.parentName}: Failed to fetch tokens for new vault ${vaultAddress}`,
      );
      return null;
    }

    const tokenAddresses = tokenResult.returnData.map(t => t.toLowerCase());

    // Fetch decimals for each token
    const decimalCalls: MultiCallParams<number>[] = tokenAddresses.map(
      token => ({
        target: token,
        callData: '0x313ce567', // decimals()
        decodeFunction: uint256DecodeToNumber,
      }),
    );

    const decimalResults =
      await this.dexHelper.multiWrapper.tryAggregate<number>(
        false,
        decimalCalls,
        log.blockNumber,
      );

    // Build the new vault
    const newVault: ClearVault = {
      id: vaultAddress,
      address: vaultAddress,
      tokens: tokenAddresses.map((addr, i) => {
        const result = decimalResults[i];
        const decimals =
          result.success && result.returnData !== undefined
            ? result.returnData
            : 18;
        return {
          id: addr,
          address: addr,
          symbol: '',
          decimals: String(decimals),
        };
      }),
    };

    // Add new vault to existing state
    const updatedVaults = [...state, newVault];
    this.onVaultCreated(updatedVaults);
    return updatedVaults;
  }

  /**
   * Process incoming logs and dispatch to appropriate handlers
   */
  async processLog(
    state: DeepReadonly<ClearVault[]>,
    log: Readonly<Log>,
  ): Promise<DeepReadonly<ClearVault[]> | null> {
    try {
      let event;
      try {
        event = this.logDecoder(log);
      } catch (e) {
        return null;
      }
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
  ): Promise<DeepReadonly<ClearVault[]>> {
    let state = this.getState(blockNumber);
    if (!state) {
      state = await this.generateState(blockNumber);
      if (!readonly) this.setState(state, blockNumber);
    }
    return state;
  }

  /**
   * Generate state using on-chain calls:
   * 1. Call vaultsLength() to get total count
   * 2. Call getBatchVaultAddresses() to get all addresses
   * 3. Call tokens() on each vault to get supported tokens
   */
  async generateState(
    blockNumber: number,
  ): Promise<DeepReadonly<ClearVault[]>> {
    // Step 1: Get total number of vaults
    const lengthCall: MultiCallParams<bigint> = {
      target: this.config.factoryAddress,
      callData: this.factoryIface.encodeFunctionData('vaultsLength'),
      decodeFunction: (result: any) => {
        const decoded = this.factoryIface.decodeFunctionResult(
          'vaultsLength',
          result,
        );
        return BigInt(decoded[0].toString());
      },
    };

    const [lengthResult] =
      await this.dexHelper.multiWrapper.tryAggregate<bigint>(
        false,
        [lengthCall],
        blockNumber,
      );

    if (!lengthResult.success) {
      this.logger.error(`${this.parentName}: Failed to fetch vaultsLength`);
      return [];
    }

    const vaultsLength = Number(lengthResult.returnData);
    if (vaultsLength === 0) {
      this.logger.info(`${this.parentName}: No vaults found`);
      return [];
    }

    // Step 2: Get all vault addresses
    const indexes = Array.from({ length: vaultsLength }, (_, i) => i);
    const batchCall: MultiCallParams<string[]> = {
      target: this.config.factoryAddress,
      callData: this.factoryIface.encodeFunctionData('getBatchVaultAddresses', [
        indexes,
      ]),
      decodeFunction: (result: any) => {
        const decoded = this.factoryIface.decodeFunctionResult(
          'getBatchVaultAddresses',
          result,
        );
        return decoded[0] as string[];
      },
    };

    const [batchResult] = await this.dexHelper.multiWrapper.tryAggregate<
      string[]
    >(false, [batchCall], blockNumber);

    if (!batchResult.success || !batchResult.returnData) {
      this.logger.error(`${this.parentName}: Failed to fetch vault addresses`);
      return [];
    }

    const vaultAddresses = batchResult.returnData.map(addr =>
      addr.toLowerCase(),
    );

    // Step 3: Fetch tokens for each vault
    const tokenCalls: MultiCallParams<string[]>[] = vaultAddresses.map(
      vault => ({
        target: vault,
        callData: this.vaultIface.encodeFunctionData('tokens'),
        decodeFunction: (result: any) => {
          const decoded = this.vaultIface.decodeFunctionResult(
            'tokens',
            result,
          );
          return decoded[0] as string[];
        },
      }),
    );

    const tokenResults = await this.dexHelper.multiWrapper.tryAggregate<
      string[]
    >(
      false,
      tokenCalls,
      blockNumber,
      this.dexHelper.multiWrapper.defaultBatchSize,
      false,
    );

    // Collect all valid vault data first
    const validVaultData: { address: string; tokens: string[] }[] = [];
    for (let i = 0; i < vaultAddresses.length; i++) {
      const result = tokenResults[i];
      if (!result.success || !result.returnData) {
        this.logger.warn(
          `${this.parentName}: Failed to fetch tokens for vault ${vaultAddresses[i]}`,
        );
        continue;
      }
      validVaultData.push({
        address: vaultAddresses[i],
        tokens: result.returnData,
      });
    }

    // Step 4: Collect all unique token addresses and fetch their decimals
    const uniqueTokens = Array.from(
      new Set(validVaultData.flatMap(v => v.tokens.map(t => t.toLowerCase()))),
    );

    const decimalCalls: MultiCallParams<number>[] = uniqueTokens.map(token => ({
      target: token,
      callData: '0x313ce567', // decimals()
      decodeFunction: uint256DecodeToNumber,
    }));

    const decimalResults =
      await this.dexHelper.multiWrapper.tryAggregate<number>(
        false,
        decimalCalls,
        blockNumber,
        this.dexHelper.multiWrapper.defaultBatchSize,
        false,
      );

    // Build token -> decimals map (default to 18 if call fails)
    const tokenDecimals: Record<string, number> = {};
    for (let i = 0; i < uniqueTokens.length; i++) {
      const result = decimalResults[i];
      if (result.success && result.returnData !== undefined) {
        tokenDecimals[uniqueTokens[i]] = result.returnData;
      } else {
        this.logger.warn(
          `${this.parentName}: Failed to fetch decimals for ${uniqueTokens[i]}, defaulting to 18`,
        );
        tokenDecimals[uniqueTokens[i]] = 18;
      }
    }

    // Build vaults with correct decimals
    const vaults: ClearVault[] = validVaultData.map(vaultData => ({
      id: vaultData.address,
      address: vaultData.address,
      tokens: vaultData.tokens.map(addr => {
        const addrLower = addr.toLowerCase();
        return {
          id: addrLower,
          address: addrLower,
          symbol: '',
          decimals: String(tokenDecimals[addrLower] ?? 18),
        };
      }),
    }));

    this.logger.info(
      `${this.parentName}: Generated state with ${vaults.length} vaults`,
    );

    return vaults;
  }
}

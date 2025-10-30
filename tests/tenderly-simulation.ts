/* eslint-disable no-console */
import 'dotenv/config';
import axios from 'axios';
import { ethers } from 'ethers';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ETHER_ADDRESS } from '../src/constants';
import { merge } from 'lodash';

const TENDERLY_TOKEN = process.env.TENDERLY_TOKEN!;
const TENDERLY_ACCOUNT_ID = process.env.TENDERLY_ACCOUNT_ID!;
const TENDERLY_PROJECT = process.env.TENDERLY_PROJECT!;
const TENDERLY_VNET_ID = process.env.TENDERLY_VNET_ID!;

interface StateObject {
  // Overrides of storage slots.
  // In this mapping, the key is variable storage slot,
  // and the value contains the override.
  storage?: Record<string, string>; // storage slot -> value
  balance?: string;
  nonce?: number;
  // Bytecode that will override the code associated to the given account.
  code?: string;
}
export type StateOverride = Record<string, StateObject>; // contract -> storage override

interface TokenStorageSlots {
  balanceSlot: string;
  allowanceSlot: string;
  isVyper?: boolean;
  stateProxy?: string;
  additionalOverrides?: StateOverride;
}

interface SimulateTransactionRequest {
  from: string | null;
  to: string | null;
  value?: string;
  data: string;
  chainId: number;
  timestamp?: number;
  blockNumber?: number;
  stateOverride?: StateOverride;
}

// not fully complete
interface SimulatedTransactionCall {
  hash: string;
  contract_name: string;
  function_name: string;
  function_pc: number;
  function_op: string;
  function_file_index: number;
  function_code_start: number;
  function_line_number: number;
  function_code_length: number;
  absolute_position: number;
  caller_pc: number;
  caller_op: string;
  call_type: string;
  address: string;
  from: string;
  from_balance: string;
  to: string;
  to_balance: string;
  value: string | null;
  caller: {
    address: string;
    balance: string;
  };
  block_timestamp: string;
  gas: number;
  gas_used: number;
  intrinsic_gas: number;
  storage_address: string;
  input: string;
  output: string;
  storage_slot: string[] | undefined;
  calls: SimulatedTransactionCall[] | null;
}

type SimulatedTransactionCallWithParent = SimulatedTransactionCall & {
  parentCall: SimulatedTransactionCall | null;
};

// not fully complete
interface Simulation {
  id: string;
  project_id: string;
  owner_id: string;
  network_id: string;
  block_number: number;
  transaction_index: number;
  from: string;
  to: string;
  input: string;
  gas: number;
  gas_price: string;
  gas_used: number;
  value: string;
  method: string;
  status: boolean;
}

// not complete, all details include a lot more info
interface SimulatedTransactionDetails {
  transaction: {
    hash: string;
    block_hash: string;
    block_number: number;
    from: string;
    gas: number;
    gas_price: number;
    gas_fee_cap: number;
    gas_tip_cap: number;
    cumulative_gas_used: number;
    gas_used: number;
    effective_gas_price: number;
    input: string;
    nonce: number;
    to: string;
    index: number;
    value: string;
    access_list: null;
    status: boolean;
    transaction_info: {
      call_trace: SimulatedTransactionCall;
    };
    call_trace: SimulatedTransactionCall[];
  };
}

export type SimulatedTransaction = Pick<
  SimulatedTransactionDetails['transaction'],
  'transaction_info' | 'call_trace'
>;

export type SimulationResult = {
  transaction: SimulatedTransaction;
  simulation: Simulation;
};

class TokenStorageSlotsCache {
  private static TOKEN_STORAGE_SLOTS: Record<
    number,
    Record<string, TokenStorageSlots>
  > | null = null;
  private static readonly TOKEN_STORAGE_SLOTS_FILEPATH = path.join(
    __dirname,
    'token-storage-slots.json',
  );

  private static async loadTokenStorageSlots(): Promise<
    Record<number, Record<string, TokenStorageSlots>>
  > {
    return JSON.parse(
      await fs.readFile(TokenStorageSlotsCache.TOKEN_STORAGE_SLOTS_FILEPATH, {
        encoding: 'utf-8',
      }),
    );
  }

  private static async saveTokenStorageSlots(): Promise<void> {
    await fs.writeFile(
      TokenStorageSlotsCache.TOKEN_STORAGE_SLOTS_FILEPATH,
      JSON.stringify(TokenStorageSlotsCache.TOKEN_STORAGE_SLOTS, null, 2),
      { encoding: 'utf-8' },
    );
  }

  static async getTokenStorageSlots(
    chainId: number,
    token: string,
  ): Promise<TokenStorageSlots | null> {
    if (!TokenStorageSlotsCache.TOKEN_STORAGE_SLOTS) {
      TokenStorageSlotsCache.TOKEN_STORAGE_SLOTS =
        await TokenStorageSlotsCache.loadTokenStorageSlots();
    }

    return (
      TokenStorageSlotsCache.TOKEN_STORAGE_SLOTS[chainId]?.[
        token.toLowerCase()
      ] ?? null
    );
  }

  static async setTokenStorageSlots(
    chainId: number,
    token: string,
    slots: TokenStorageSlots,
  ): Promise<void> {
    if (!TokenStorageSlotsCache.TOKEN_STORAGE_SLOTS) {
      TokenStorageSlotsCache.TOKEN_STORAGE_SLOTS =
        await TokenStorageSlotsCache.loadTokenStorageSlots();
    }

    TokenStorageSlotsCache.TOKEN_STORAGE_SLOTS ||= {};
    TokenStorageSlotsCache.TOKEN_STORAGE_SLOTS[chainId] ||= {};
    TokenStorageSlotsCache.TOKEN_STORAGE_SLOTS[chainId][token.toLowerCase()] =
      slots;

    void TokenStorageSlotsCache.saveTokenStorageSlots();
  }
}

export class TenderlySimulator {
  // public constants
  static readonly DEFAULT_OWNER = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  static readonly DEFAULT_SPENDER =
    '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

  // singleton
  private static instance: TenderlySimulator;

  private constructor() {}

  public static getInstance(): TenderlySimulator {
    if (!TenderlySimulator.instance) {
      TenderlySimulator.instance = new TenderlySimulator();
    }

    return TenderlySimulator.instance;
  }

  public async simulateTransaction(
    request: SimulateTransactionRequest,
    forceSimulationAPI = false,
  ): Promise<SimulationResult> {
    if (TENDERLY_VNET_ID && !forceSimulationAPI) {
      return this.simulateWithTenderlyVNet(request);
    } else {
      return this.simulateWithTenderlySimulationAPI(request);
    }
  }

  private async simulateWithTenderlySimulationAPI(
    request: SimulateTransactionRequest,
  ): Promise<SimulationResult> {
    const data = {
      network_id: request.chainId,
      from: request.from,
      to: request.to,
      input: request.data,
      value: request.value,
      save: true,
      save_if_fails: true,
      state_objects: request.stateOverride,
      block_number: request.blockNumber,
    };

    console.log('Sending transaction simulation with params:');
    console.log(JSON.stringify(data, null, 2));

    const {
      data: { transaction, simulation },
    } = await axios.post(
      `https://api.tenderly.co/api/v1/account/${TENDERLY_ACCOUNT_ID}/project/${TENDERLY_PROJECT}/simulate`,
      data,
      {
        headers: {
          'X-Access-Key': TENDERLY_TOKEN,
        },
      },
    );

    const url = `https://dashboard.tenderly.co/${TENDERLY_ACCOUNT_ID}/${TENDERLY_PROJECT}/simulator/${simulation.id}`;
    console.log('Successfully simulated a transaction:');
    console.log(`Simulation URL - ${url}`);

    return { transaction, simulation };
  }

  private async simulateWithTenderlyVNet(
    request: SimulateTransactionRequest,
  ): Promise<SimulationResult> {
    const data = {
      network_id: request.chainId,
      from: request.from,
      to: request.to,
      input: request.data,
      value: request.value,
      save: true,
      save_if_fails: true,
      state_objects: request.stateOverride,
      block_number: request.blockNumber,
    };

    console.log('Sending transaction simulation with params:');
    console.log(JSON.stringify(data, null, 2));

    const {
      data: { transaction, simulation },
    } = await axios.post(
      `https://api.tenderly.co/api/v1/account/${TENDERLY_ACCOUNT_ID}/project/${TENDERLY_PROJECT}/testnet/${TENDERLY_VNET_ID}/simulate`,
      data,
      {
        headers: {
          'X-Access-Key': TENDERLY_TOKEN,
        },
      },
    );

    const url = `https://dashboard.tenderly.co/${TENDERLY_ACCOUNT_ID}/${TENDERLY_PROJECT}/testnet/${TENDERLY_VNET_ID}/simulator/${simulation.id}`;
    console.log('Successfully simulated a transaction:');
    console.log(`Simulation URL - ${url}`);

    return { transaction, simulation };
  }

  public async getSimulatedTransactionDetails(
    id: string,
  ): Promise<SimulatedTransactionDetails | null> {
    try {
      const { data } = await axios.post(
        `https://api.tenderly.co/api/v1/account/${TENDERLY_ACCOUNT_ID}/project/${TENDERLY_PROJECT}/simulations/${id}`,
        {},
        { headers: { 'X-Access-Key': TENDERLY_TOKEN } },
      );

      return data;
    } catch (e) {
      console.error(e);
      return null;
    }
  }

  getSLOADCalls = (
    callTrace: SimulatedTransactionCall,
    parentCall: SimulatedTransactionCall | null = null,
  ): SimulatedTransactionCallWithParent[] => {
    const results: SimulatedTransactionCallWithParent[] = [];

    if (callTrace.call_type === 'SLOAD') {
      results.push({ ...callTrace, parentCall });
    }

    if (callTrace.calls) {
      for (const call of callTrace.calls) {
        results.push(...this.getSLOADCalls(call, callTrace));
      }
    }

    return results;
  };

  /**
   *
   * @param balanceOfSlot storage slot of `balanceOf` mapping
   * @param owner account's address
   * @param isVyper `true` if contract is written in Vyper
   */
  calculateAddressBalanceSlot(
    balanceOfSlot: string,
    owner: string,
    isVyper = false,
  ) {
    return isVyper
      ? this.calculateVyperAddressBalanceSlot(balanceOfSlot, owner)
      : this.calculateSolidityAddressBalanceSlot(balanceOfSlot, owner);
  }

  /**
   *
   * @param balanceOfSlot storage slot of `balanceOf` mapping
   * @param owner account's address
   */
  calculateSolidityAddressBalanceSlot(balanceOfSlot: string, owner: string) {
    return ethers.utils.keccak256(
      ethers.utils.concat([ethers.utils.hexZeroPad(owner, 32), balanceOfSlot]),
    );
  }

  /**
   *
   * @param balanceOfSlot storage slot of `balanceOf` mapping
   * @param owner account's address
   */
  calculateVyperAddressBalanceSlot(balanceOfSlot: string, owner: string) {
    return ethers.utils.keccak256(
      ethers.utils.concat([balanceOfSlot, ethers.utils.hexZeroPad(owner, 32)]),
    );
  }

  /**
   *
   * @param allowanceSlot storage slot of `allowance` mapping
   * @param owner account's address
   * @param spender spender's address
   * @param isVyper `true` if contract is written in Vyper
   */
  calculateAddressAllowanceSlot(
    allowanceSlot: string,
    owner: string,
    spender: string,
    isVyper = false,
  ) {
    return isVyper
      ? this.calculateVyperAddressAllowanceSlot(allowanceSlot, owner, spender)
      : this.calculateSolidityAddressAllowanceSlot(
          allowanceSlot,
          owner,
          spender,
        );
  }

  /**
   *
   * @param allowanceSlot storage slot of `allowance` mapping
   * @param owner account's address
   * @param spender spender's address
   */
  calculateSolidityAddressAllowanceSlot(
    allowanceSlot: string,
    owner: string,
    spender: string,
  ) {
    const slotHash = ethers.utils.keccak256(
      ethers.utils.concat([
        ethers.utils.hexZeroPad(owner, 32),
        ethers.utils.hexZeroPad(allowanceSlot, 32),
      ]),
    );

    return ethers.utils.keccak256(
      ethers.utils.concat([ethers.utils.hexZeroPad(spender, 32), slotHash]),
    );
  }

  /**
   *
   * @param allowanceSlot storage slot of `allowance` mapping
   * @param owner account's address
   * @param spender spender's address
   */
  calculateVyperAddressAllowanceSlot(
    allowanceSlot: string,
    owner: string,
    spender: string,
  ) {
    const slotHash = ethers.utils.keccak256(
      ethers.utils.concat([
        ethers.utils.hexZeroPad(allowanceSlot, 32),
        ethers.utils.hexZeroPad(owner, 32),
      ]),
    );

    return ethers.utils.keccak256(
      ethers.utils.concat([slotHash, ethers.utils.hexZeroPad(spender, 32)]),
    );
  }

  buildBalanceOfSimulationRequest(
    chainId: number,
    token: string,
    owner: string,
  ): SimulateTransactionRequest {
    const iface = new ethers.utils.Interface([
      'function balanceOf(address owner) view returns (uint)',
    ]);

    return {
      from: ethers.constants.AddressZero,
      to: token,
      data: iface.encodeFunctionData('balanceOf', [owner]),
      chainId,
    };
  }

  buildAllowanceSimulationRequest(
    chainId: number,
    token: string,
    owner: string,
    spender: string,
  ): SimulateTransactionRequest {
    const iface = new ethers.utils.Interface([
      'function allowance(address owner, address spender) view returns (uint)',
    ]);

    return {
      from: ethers.constants.AddressZero,
      to: token,
      data: iface.encodeFunctionData('allowance', [owner, spender]),
      chainId,
    };
  }

  /**
   * Finds the slot of the `balanceOf` mapping in given token contract's storage.
   * Supports `Solidity` and `Vyper` contracts
   * @param chainId token chain id
   * @param token token address
   */
  async findTokenBalanceOfSlot(
    chainId: number,
    token: string,
  ): Promise<{ slot: string; isVyper?: boolean; stateProxy?: string }> {
    const account = TenderlySimulator.DEFAULT_OWNER;

    const balanceOfSimulationRequest = this.buildBalanceOfSimulationRequest(
      chainId,
      token,
      account,
    );

    const {
      simulation: { id: simulationId },
    } = await this.simulateTransaction(
      balanceOfSimulationRequest,
      true, // force Tenderly simulation API
    );

    const simulationDetails = await this.getSimulatedTransactionDetails(
      simulationId,
    );

    if (!simulationDetails) {
      throw `No simulation with id ${simulationId} details found`;
    }

    const callTrace = simulationDetails.transaction.transaction_info.call_trace;

    const sloadCalls = this.getSLOADCalls(callTrace);
    // token's storage slots that were read during the `balanceOf` call
    const readSlots = sloadCalls
      .map(call => ({
        slot: call.storage_slot?.[0],
        address: call.storage_address,
        parentCallType: call.parentCall ? call.parentCall.call_type : null,
      }))
      .filter(({ slot }) => !!slot);

    const startingPoints = [
      // regular contract
      0n,
      // ERC20Upgradeable
      BigInt(
        '0x52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace00',
      ),
    ];

    for (const startingPoint of startingPoints) {
      for (let i = startingPoint; i < startingPoint + 1_000n; i += 1n) {
        const candidateSlot = ethers.utils.defaultAbiCoder.encode(
          ['uint'],
          [i],
        );
        // try solidity slot
        const solitidyBalanceOfSlot = this.calculateSolidityAddressBalanceSlot(
          candidateSlot,
          account,
        );
        const foundSoliditySlot = readSlots.find(
          ({ slot }) => slot === solitidyBalanceOfSlot,
        );
        if (foundSoliditySlot) {
          return foundSoliditySlot.address !== token.toLowerCase() &&
            foundSoliditySlot.parentCallType !== 'DELEGATECALL'
            ? { slot: candidateSlot, stateProxy: foundSoliditySlot.address }
            : { slot: candidateSlot };
        }
        // try vyper slot
        const vyperBalanceOfSlot = this.calculateVyperAddressBalanceSlot(
          candidateSlot,
          account,
        );
        const foundVyperSlot = readSlots.find(
          ({ slot }) => slot === vyperBalanceOfSlot,
        );

        if (foundVyperSlot) {
          return foundVyperSlot.address === token.toLowerCase() &&
            foundVyperSlot.parentCallType !== 'DELEGATECALL'
            ? {
                slot: candidateSlot,
                isVyper: true,
                stateProxy: foundVyperSlot.address,
              }
            : { slot: candidateSlot, isVyper: true };
        }
      }
    }

    throw new Error(
      `Could not find a 'balanceOf' mapping slot for token ${token} on chain ${chainId}`,
    );
  }

  /**
   * Finds the slot of the `allowance` mapping in given token contract's storage
   * Supports `Solidity` and `Vyper` contracts
   * @param chainId token chain id
   * @param token token address
   */
  async findTokenAllowanceSlot(
    chainId: number,
    token: string,
  ): Promise<{ slot: string; isVyper?: boolean; stateProxy?: string }> {
    const account = TenderlySimulator.DEFAULT_OWNER;
    const spender = TenderlySimulator.DEFAULT_SPENDER;

    const allowanceSimulationRequest = this.buildAllowanceSimulationRequest(
      chainId,
      token,
      account,
      spender,
    );

    const {
      simulation: { id: simulationId },
    } = await this.simulateTransaction(
      allowanceSimulationRequest,
      true, // force Tenderly simulation API
    );

    const simulationDetails = await this.getSimulatedTransactionDetails(
      simulationId,
    );

    if (!simulationDetails) {
      throw `No simulation with id ${simulationId} details found`;
    }

    const callTrace = simulationDetails.transaction.transaction_info.call_trace;

    // console.log(callTrace);

    const sloadCalls = this.getSLOADCalls(callTrace);
    // token's storage slots that were read during the `allowance` call
    const readSlots = sloadCalls
      .map(call => ({
        slot: call.storage_slot?.[0],
        address: call.storage_address,
        parentCallType: call.parentCall ? call.parentCall.call_type : null,
      }))
      .filter(({ slot }) => !!slot);

    console.log(readSlots);

    const startingPoints = [
      // regular contract
      0n,
      // ERC20Upgradeable
      BigInt(
        '0x52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace00',
      ),
    ];

    for (const init of startingPoints) {
      for (let i = init; i < init + 1000n; i += 1n) {
        const candidateSlot = ethers.utils.defaultAbiCoder.encode(
          ['uint'],
          [i],
        );
        // try solidity
        const solidityAllowanceSlot =
          this.calculateSolidityAddressAllowanceSlot(
            candidateSlot,
            account,
            spender,
          );

        const foundSoliditySlot = readSlots.find(
          ({ slot }) => solidityAllowanceSlot === slot,
        );

        if (foundSoliditySlot) {
          return token.toLowerCase() !== foundSoliditySlot.address &&
            foundSoliditySlot.parentCallType !== 'DELEGATECALL'
            ? {
                slot: candidateSlot,
                stateProxy: foundSoliditySlot.address,
              }
            : {
                slot: candidateSlot,
              };
        }

        // try vyper
        const vyperAllowanceSlot = this.calculateVyperAddressAllowanceSlot(
          candidateSlot,
          account,
          spender,
        );

        const foundVyperSlot = readSlots.find(
          ({ slot }) => vyperAllowanceSlot === slot,
        );

        if (foundVyperSlot) {
          return token.toLowerCase() !== foundVyperSlot.address &&
            foundVyperSlot.parentCallType !== 'DELEGATECALL'
            ? {
                slot: candidateSlot,
                stateProxy: foundVyperSlot.address,
              }
            : {
                slot: candidateSlot,
              };
        }
      }
    }

    throw new Error(
      `Could not find a 'allowance' mapping slot for token ${token} on chain ${chainId}`,
    );
  }

  /**
   * Returns storage slots for the given token contract.
   * @param chainId Token chain ID
   * @param token Token address. Doesn't have to be normalized
   */
  async getTokenStorageSlots(
    chainId: number,
    token: string,
  ): Promise<TokenStorageSlots> {
    const normalizedToken = token.toLowerCase();

    if (normalizedToken === ETHER_ADDRESS) {
      throw new Error('Cannot provide storage slots for native token');
    }

    // check cache
    const cachedSlots = await TokenStorageSlotsCache.getTokenStorageSlots(
      chainId,
      normalizedToken,
    );

    // return if cached
    if (cachedSlots) {
      return cachedSlots;
    }

    // find the slots
    const [balanceSlot, allowanceSlot] = await Promise.all([
      this.findTokenBalanceOfSlot(chainId, token),
      this.findTokenAllowanceSlot(chainId, token),
    ]);

    // save the slots and return
    const slots: TokenStorageSlots = {
      balanceSlot: balanceSlot.slot,
      allowanceSlot: allowanceSlot.slot,
      isVyper: balanceSlot.isVyper,
      stateProxy: balanceSlot.stateProxy,
    };

    // no need to await
    void TokenStorageSlotsCache.setTokenStorageSlots(chainId, token, slots);

    return slots;
  }

  /**
   * Adds native balance override to an existing `StateOverride` object
   * @param stateOverride object to add the override to
   * @param account address to be given the balance
   * @param amount token amount in wei
   */
  addBalanceOverride(
    stateOverride: StateOverride,
    account: string,
    amount: bigint,
  ): void {
    // add the balance override
    stateOverride[account] ||= {};
    stateOverride[account].balance = amount.toString();
  }

  /**
   * Adds token balance override to an existing `StateOverride` object
   * @param stateOverride object to add the override to
   * @param chainId token chain ID
   * @param token token address
   * @param account address to be given the balance
   * @param amount token amount in wei
   */
  async addTokenBalanceOverride(
    stateOverride: StateOverride,
    chainId: number,
    token: string,
    account: string,
    amount: bigint,
  ): Promise<void> {
    // get mapping slots
    const tokenSlots = await this.getTokenStorageSlots(chainId, token);
    // calculate balance slot
    const slotToOverride = this.calculateAddressBalanceSlot(
      tokenSlots.balanceSlot,
      account,
      tokenSlots.isVyper,
    );
    const overrideAddresses = tokenSlots.stateProxy
      ? [tokenSlots.stateProxy, token]
      : [token];

    const seen = new Set<string>();
    for (const address of overrideAddresses) {
      const tokenAddress = address.toLowerCase();
      if (seen.has(tokenAddress)) {
        continue;
      }

      seen.add(tokenAddress);
      stateOverride[address] ||= {};
      stateOverride[address].storage ||= {};
      stateOverride[address].storage[slotToOverride] =
        ethers.utils.defaultAbiCoder.encode(['uint'], [amount]);
    }

    if (tokenSlots.additionalOverrides) {
      merge(stateOverride, tokenSlots.additionalOverrides);
    }
  }

  /**
   * Adds token allowance override to an existing `StateOverride` object
   * @param stateOverride object to add the override to
   * @param chainId token chain ID
   * @param token token address
   * @param account owner address
   * @param spender spender address
   * @param amount token amount in wei
   */
  async addAllowanceOverride(
    stateOverride: StateOverride,
    chainId: number,
    token: string,
    account: string,
    spender: string,
    amount: bigint,
  ): Promise<void> {
    // get mapping slots
    const tokenSlots = await this.getTokenStorageSlots(chainId, token);
    // calculate allowance slot
    const slotToOverride = this.calculateAddressAllowanceSlot(
      tokenSlots.allowanceSlot,
      account,
      spender,
      tokenSlots.isVyper,
    );
    const overrideAddresses = tokenSlots.stateProxy
      ? [tokenSlots.stateProxy, token]
      : [token];

    const seen = new Set<string>();
    for (const address of overrideAddresses) {
      const tokenAddress = address.toLowerCase();
      if (seen.has(tokenAddress)) {
        continue;
      }

      seen.add(tokenAddress);
      stateOverride[address] ||= {};
      stateOverride[address].storage ||= {};
      stateOverride[address].storage[slotToOverride] =
        ethers.utils.defaultAbiCoder.encode(['uint'], [amount]);
    }

    if (tokenSlots.additionalOverrides) {
      merge(stateOverride, tokenSlots.additionalOverrides);
    }
  }
}

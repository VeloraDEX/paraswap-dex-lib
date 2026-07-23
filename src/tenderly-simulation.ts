/* eslint-disable no-console */
import 'dotenv/config';
import axios from 'axios';
import { ethers } from 'ethers';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ETHER_ADDRESS } from './constants';
import { ICache } from './dex-helper/icache';
import { merge } from 'lodash';

let TENDERLY_TOKEN = process.env.TENDERLY_TOKEN!;
let TENDERLY_ACCOUNT_ID = process.env.TENDERLY_ACCOUNT_ID!;
let TENDERLY_PROJECT = process.env.TENDERLY_PROJECT!;
let TENDERLY_VNET_ID = process.env.TENDERLY_VNET_ID!;

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
  // Solady ERC20 layout: `balanceSlot`/`allowanceSlot` hold the Solady slot
  // seeds instead of mapping slots
  isSolady?: boolean;
  // partitioned layout (e.g. ViciERC20): mappings are keyed by a partition
  // (item/token id) in addition to the account, see calculatePartitioned* methods
  partition?: string;
  stateProxy?: string;
  additionalOverrides?: StateOverride;
}

interface FoundSlot {
  slot: string;
  isVyper?: boolean;
  isSolady?: boolean;
  partition?: string;
  stateProxy?: string;
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
  private static cache: ICache | null = null;

  private static TOKEN_FILE_STORAGE_SLOTS: Record<
    number,
    Record<string, TokenStorageSlots>
  > | null = null;
  private static readonly TOKEN_STORAGE_SLOTS_FILEPATH = path.join(
    __dirname,
    '../tests/token-storage-slots.json',
  );

  static setRedisCache(cache: ICache): void {
    TokenStorageSlotsCache.cache = cache ?? null;
  }

  private static redisKey(chainId: number): string {
    return `token_storage_slots_${chainId}`;
  }

  private static async loadTokenFileStorageSlots(): Promise<
    Record<number, Record<string, TokenStorageSlots>>
  > {
    return JSON.parse(
      await fs.readFile(TokenStorageSlotsCache.TOKEN_STORAGE_SLOTS_FILEPATH, {
        encoding: 'utf-8',
      }),
    );
  }

  private static async saveTokenFileStorageSlots(): Promise<void> {
    await fs.writeFile(
      TokenStorageSlotsCache.TOKEN_STORAGE_SLOTS_FILEPATH,
      JSON.stringify(TokenStorageSlotsCache.TOKEN_FILE_STORAGE_SLOTS, null, 2) +
        '\n',
      { encoding: 'utf-8' },
    );
  }

  static async getTokenStorageSlots(
    chainId: number,
    token: string,
  ): Promise<TokenStorageSlots | null> {
    const normalizedToken = token.toLowerCase();

    if (TokenStorageSlotsCache.cache) {
      try {
        const cached = await TokenStorageSlotsCache.cache.hget(
          TokenStorageSlotsCache.redisKey(chainId),
          normalizedToken,
        );
        if (cached) {
          return JSON.parse(cached) as TokenStorageSlots;
        }
      } catch (e) {
        // Redis error — fall through to return null
      }
      return null;
    }

    if (!TokenStorageSlotsCache.TOKEN_FILE_STORAGE_SLOTS) {
      TokenStorageSlotsCache.TOKEN_FILE_STORAGE_SLOTS =
        await TokenStorageSlotsCache.loadTokenFileStorageSlots();
    }

    return (
      TokenStorageSlotsCache.TOKEN_FILE_STORAGE_SLOTS[chainId]?.[
        normalizedToken
      ] ?? null
    );
  }

  static async setTokenStorageSlots(
    chainId: number,
    token: string,
    slots: TokenStorageSlots,
  ): Promise<void> {
    const normalizedToken = token.toLowerCase();

    if (TokenStorageSlotsCache.cache) {
      void TokenStorageSlotsCache.cache.hset(
        TokenStorageSlotsCache.redisKey(chainId),
        normalizedToken,
        JSON.stringify(slots),
      );
      return;
    }

    if (!TokenStorageSlotsCache.TOKEN_FILE_STORAGE_SLOTS) {
      TokenStorageSlotsCache.TOKEN_FILE_STORAGE_SLOTS =
        await TokenStorageSlotsCache.loadTokenFileStorageSlots();
    }

    TokenStorageSlotsCache.TOKEN_FILE_STORAGE_SLOTS ||= {};
    TokenStorageSlotsCache.TOKEN_FILE_STORAGE_SLOTS[chainId] ||= {};
    TokenStorageSlotsCache.TOKEN_FILE_STORAGE_SLOTS[chainId][normalizedToken] =
      slots;

    void TokenStorageSlotsCache.saveTokenFileStorageSlots();
  }
}

export class TenderlySimulator {
  // public constants
  static readonly DEFAULT_OWNER = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  static readonly DEFAULT_SPENDER =
    '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  // distinctive value written into a candidate slot during verification,
  // unlikely to collide with any pre-existing balance/allowance
  static readonly SLOT_VERIFICATION_AMOUNT = 123456789012345678901234567n;
  // Solady ERC20 doesn't use Solidity mappings — balances/allowances live at
  // slots derived from these fixed library constants
  // https://github.com/Vectorized/solady/blob/main/src/tokens/ERC20.sol
  static readonly SOLADY_BALANCE_SLOT_SEED = '0x87a211a2';
  static readonly SOLADY_ALLOWANCE_SLOT_SEED = '0x7f5e9f20';
  // B20 native tokens (Base Beryl upgrade) are Rust precompiles reading
  // regular Solidity mappings under the ERC-7201 `base.b20` namespace
  // (root 0x…434000): balances at offset 4, allowances at offset 5
  // https://github.com/base/base crates/common/precompiles/src/common/core_storage.rs
  static readonly B20_BALANCES_SLOT =
    '0xc78b71fee795ddd74aff64ea9b2474194c938c3196430e10bb5f01ed48434004';
  static readonly B20_ALLOWANCES_SLOT =
    '0xc78b71fee795ddd74aff64ea9b2474194c938c3196430e10bb5f01ed48434005';

  // singleton
  private static instance: TenderlySimulator;

  private constructor() {}

  public static getInstance(
    cache?: ICache,
    tenderlyToken?: string,
    tenderlyProject?: string,
    tenderlyAccountId?: string,
  ): TenderlySimulator {
    if (!TenderlySimulator.instance) {
      TenderlySimulator.instance = new TenderlySimulator();
    }

    if (cache) {
      TokenStorageSlotsCache.setRedisCache(cache);
    }

    if (tenderlyToken) {
      TENDERLY_TOKEN = tenderlyToken;
    }

    if (tenderlyProject) {
      TENDERLY_PROJECT = tenderlyProject;
    }

    if (tenderlyAccountId) {
      TENDERLY_ACCOUNT_ID = tenderlyAccountId;
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
   * @param balanceOfSlot storage slot of `balanceOf` mapping (Solady slot seed if `isSolady`)
   * @param owner account's address
   * @param isVyper `true` if contract is written in Vyper
   * @param isSolady `true` if contract uses Solady ERC20 storage layout
   * @param partition partition key if contract uses partitioned storage layout
   */
  calculateAddressBalanceSlot(
    balanceOfSlot: string,
    owner: string,
    isVyper = false,
    isSolady = false,
    partition?: string,
  ) {
    if (partition) {
      return this.calculatePartitionedAddressBalanceSlot(
        balanceOfSlot,
        owner,
        partition,
      );
    }
    if (isSolady) {
      return this.calculateSoladyAddressBalanceSlot(balanceOfSlot, owner);
    }
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
   * Solady ERC20 stores balances at `keccak256(owner ++ seed)` where the seed
   * is the 12-byte-padded `_BALANCE_SLOT_SEED` library constant
   * @param balanceSlotSeed Solady balance slot seed
   * @param owner account's address
   */
  calculateSoladyAddressBalanceSlot(balanceSlotSeed: string, owner: string) {
    return ethers.utils.keccak256(
      ethers.utils.concat([
        ethers.utils.hexZeroPad(owner, 20),
        ethers.utils.hexZeroPad(balanceSlotSeed, 12),
      ]),
    );
  }

  /**
   * Partitioned layout (e.g. ViciERC20's `balances[partition][owner]`):
   * balance is stored at `keccak256(owner ++ keccak256(partition ++ slot))`
   * @param balanceOfSlot storage slot of the partitioned balances mapping
   * @param owner account's address
   * @param partition partition key (item/token id) as a 32-byte value
   */
  calculatePartitionedAddressBalanceSlot(
    balanceOfSlot: string,
    owner: string,
    partition: string,
  ) {
    return this.calculateSolidityAddressBalanceSlot(
      ethers.utils.keccak256(
        ethers.utils.concat([
          ethers.utils.hexZeroPad(partition, 32),
          balanceOfSlot,
        ]),
      ),
      owner,
    );
  }

  /**
   *
   * @param allowanceSlot storage slot of `allowance` mapping (Solady slot seed if `isSolady`)
   * @param owner account's address
   * @param spender spender's address
   * @param isVyper `true` if contract is written in Vyper
   * @param isSolady `true` if contract uses Solady ERC20 storage layout
   * @param partition partition key if contract uses partitioned storage layout
   */
  calculateAddressAllowanceSlot(
    allowanceSlot: string,
    owner: string,
    spender: string,
    isVyper = false,
    isSolady = false,
    partition?: string,
  ) {
    if (partition) {
      return this.calculatePartitionedAddressAllowanceSlot(
        allowanceSlot,
        owner,
        spender,
        partition,
      );
    }
    if (isSolady) {
      return this.calculateSoladyAddressAllowanceSlot(
        allowanceSlot,
        owner,
        spender,
      );
    }
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

  /**
   * Solady ERC20 stores allowances at `keccak256(owner ++ seed ++ spender)`
   * where the seed is the 12-byte-padded `_ALLOWANCE_SLOT_SEED` library constant
   * @param allowanceSlotSeed Solady allowance slot seed
   * @param owner account's address
   * @param spender spender's address
   */
  calculateSoladyAddressAllowanceSlot(
    allowanceSlotSeed: string,
    owner: string,
    spender: string,
  ) {
    return ethers.utils.keccak256(
      ethers.utils.concat([
        ethers.utils.hexZeroPad(owner, 20),
        ethers.utils.hexZeroPad(allowanceSlotSeed, 12),
        ethers.utils.hexZeroPad(spender, 20),
      ]),
    );
  }

  /**
   * Partitioned layout (e.g. ViciERC20's `allowances[owner][partition][spender]`):
   * allowance is stored at
   * `keccak256(spender ++ keccak256(partition ++ keccak256(owner ++ slot)))`
   * @param allowanceSlot storage slot of the partitioned allowances mapping
   * @param owner account's address
   * @param spender spender's address
   * @param partition partition key (item/token id) as a 32-byte value
   */
  calculatePartitionedAddressAllowanceSlot(
    allowanceSlot: string,
    owner: string,
    spender: string,
    partition: string,
  ) {
    const ownerHash = ethers.utils.keccak256(
      ethers.utils.concat([ethers.utils.hexZeroPad(owner, 32), allowanceSlot]),
    );
    const partitionHash = ethers.utils.keccak256(
      ethers.utils.concat([ethers.utils.hexZeroPad(partition, 32), ownerHash]),
    );
    return ethers.utils.keccak256(
      ethers.utils.concat([
        ethers.utils.hexZeroPad(spender, 32),
        partitionHash,
      ]),
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

  private decodeUintOutput(output: string | undefined): bigint | null {
    if (!output || output === '0x') {
      return null;
    }

    try {
      const [decoded] = ethers.utils.defaultAbiCoder.decode(
        ['uint256'],
        output,
      );
      return decoded.toBigInt();
    } catch (e) {
      return null;
    }
  }

  /**
   * Simulates the given read call with the state override applied and checks
   * that the override actually controls the returned value: the call must
   * succeed and return a non-zero value different from the baseline.
   * With `allowScaled` an exact match with `writtenValue` is not required —
   * tokens with derived balances (e.g. stETH shares, aToken scaled balances)
   * return a scaled value. Without it, only an exact match passes
   */
  private async simulateAndCheckOutput(
    request: SimulateTransactionRequest,
    writtenValue: bigint,
    baselineValue: bigint,
    allowScaled: boolean,
  ): Promise<boolean> {
    try {
      const { transaction, simulation } = await this.simulateTransaction(
        request,
        true, // force Tenderly simulation API
      );

      if (!simulation.status) {
        return false;
      }

      const decoded = this.decodeUintOutput(
        transaction.transaction_info.call_trace.output,
      );

      if (decoded === null || decoded === 0n || decoded === baselineValue) {
        return false;
      }

      if (decoded !== writtenValue) {
        if (!allowScaled) {
          return false;
        }

        console.warn(
          `Slot override verification for token ${request.to}: written value ${writtenValue} but call returned ${decoded} (derived/scaled value), accepting slot`,
        );
      }

      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Verifies a candidate `balanceOf` mapping slot by overriding the derived
   * slot with a distinctive value and checking that `balanceOf` reflects it
   * @param chainId token chain id
   * @param token token address
   * @param foundSlot candidate slot to verify
   * @param baselineValue `balanceOf` result without the override applied
   */
  async verifyTokenBalanceSlot(
    chainId: number,
    token: string,
    foundSlot: FoundSlot,
    baselineValue = 0n,
  ): Promise<boolean> {
    const owner = TenderlySimulator.DEFAULT_OWNER;
    const amount = TenderlySimulator.SLOT_VERIFICATION_AMOUNT;

    const slotToOverride = this.calculateAddressBalanceSlot(
      foundSlot.slot,
      owner,
      foundSlot.isVyper,
      foundSlot.isSolady,
      foundSlot.partition,
    );

    const address = foundSlot.stateProxy ?? token;
    const stateOverride: StateOverride = {
      [address]: {
        storage: {
          [slotToOverride]: ethers.utils.defaultAbiCoder.encode(
            ['uint'],
            [amount],
          ),
        },
      },
    };

    return this.simulateAndCheckOutput(
      {
        ...this.buildBalanceOfSimulationRequest(chainId, token, owner),
        stateOverride,
      },
      amount,
      baselineValue,
      true, // balances can be derived from the stored value (stETH, aTokens)
    );
  }

  /**
   * Verifies a candidate `allowance` mapping slot by overriding the derived
   * slot with a distinctive value and checking that `allowance` reflects it
   * @param chainId token chain id
   * @param token token address
   * @param foundSlot candidate slot to verify
   * @param baselineValue `allowance` result without the override applied
   */
  async verifyTokenAllowanceSlot(
    chainId: number,
    token: string,
    foundSlot: FoundSlot,
    baselineValue = 0n,
  ): Promise<boolean> {
    const owner = TenderlySimulator.DEFAULT_OWNER;
    const spender = TenderlySimulator.DEFAULT_SPENDER;
    const amount = TenderlySimulator.SLOT_VERIFICATION_AMOUNT;

    const slotToOverride = this.calculateAddressAllowanceSlot(
      foundSlot.slot,
      owner,
      spender,
      foundSlot.isVyper,
      foundSlot.isSolady,
      foundSlot.partition,
    );

    const address = foundSlot.stateProxy ?? token;
    const stateOverride: StateOverride = {
      [address]: {
        storage: {
          [slotToOverride]: ethers.utils.defaultAbiCoder.encode(
            ['uint'],
            [amount],
          ),
        },
      },
    };

    return this.simulateAndCheckOutput(
      {
        ...this.buildAllowanceSimulationRequest(chainId, token, owner, spender),
        stateOverride,
      },
      amount,
      baselineValue,
      false, // allowances are stored raw, require an exact match
    );
  }

  /**
   * Builds a `FoundSlot` from a matched SLOAD. `storage_address` is where the
   * read actually happened: if it differs from the token, the state lives on
   * an external contract (state proxy) and overrides must target it
   */
  private buildFoundSlot(
    token: string,
    readSlotAddress: string,
    base: Omit<FoundSlot, 'stateProxy'>,
  ): FoundSlot {
    return readSlotAddress !== token.toLowerCase()
      ? { ...base, stateProxy: readSlotAddress }
      : { ...base };
  }

  /**
   * Finds the slot of the `balanceOf` mapping in given token contract's storage.
   * Supports `Solidity` and `Vyper` contracts.
   * Found slots are verified with an additional simulation before being returned
   * @param chainId token chain id
   * @param token token address
   */
  async findTokenBalanceOfSlot(
    chainId: number,
    token: string,
  ): Promise<FoundSlot> {
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

    // `balanceOf` result without any overrides, used as verification baseline
    const baselineValue = this.decodeUintOutput(callTrace.output) ?? 0n;

    const sloadCalls = this.getSLOADCalls(callTrace);
    // token's storage slots that were read during the `balanceOf` call
    const readSlots = sloadCalls
      .map(call => ({
        slot: call.storage_slot?.[0],
        address: call.storage_address,
      }))
      .filter(({ slot }) => !!slot);

    // try Solady layout: balance slot is derived from a fixed seed, not a mapping
    const soladyBalanceOfSlot = this.calculateSoladyAddressBalanceSlot(
      TenderlySimulator.SOLADY_BALANCE_SLOT_SEED,
      account,
    );
    const foundSoladySlot = readSlots.find(
      ({ slot }) => slot === soladyBalanceOfSlot,
    );
    if (foundSoladySlot) {
      const candidate = this.buildFoundSlot(token, foundSoladySlot.address, {
        slot: TenderlySimulator.SOLADY_BALANCE_SLOT_SEED,
        isSolady: true,
      });

      if (
        await this.verifyTokenBalanceSlot(
          chainId,
          token,
          candidate,
          baselineValue,
        )
      ) {
        return candidate;
      }

      console.warn(
        `Candidate 'balanceOf' slot seed (solady) for token ${token} on chain ${chainId} failed verification, continuing search`,
      );
    }

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
          const candidate = this.buildFoundSlot(
            token,
            foundSoliditySlot.address,
            { slot: candidateSlot },
          );

          if (
            await this.verifyTokenBalanceSlot(
              chainId,
              token,
              candidate,
              baselineValue,
            )
          ) {
            return candidate;
          }

          console.warn(
            `Candidate 'balanceOf' slot ${candidateSlot} for token ${token} on chain ${chainId} failed verification, continuing search`,
          );
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
          const candidate = this.buildFoundSlot(token, foundVyperSlot.address, {
            slot: candidateSlot,
            isVyper: true,
          });

          if (
            await this.verifyTokenBalanceSlot(
              chainId,
              token,
              candidate,
              baselineValue,
            )
          ) {
            return candidate;
          }

          console.warn(
            `Candidate 'balanceOf' slot ${candidateSlot} (vyper) for token ${token} on chain ${chainId} failed verification, continuing search`,
          );
        }
      }
    }

    // try partitioned layout (e.g. ViciERC20's `balances[partition][owner]`),
    // often held on an external state contract
    for (let p = 0n; p < 4n; p += 1n) {
      const partition = ethers.utils.defaultAbiCoder.encode(['uint'], [p]);
      for (let i = 0n; i < 1_000n; i += 1n) {
        const candidateSlot = ethers.utils.defaultAbiCoder.encode(
          ['uint'],
          [i],
        );
        const partitionedBalanceOfSlot =
          this.calculatePartitionedAddressBalanceSlot(
            candidateSlot,
            account,
            partition,
          );
        const foundPartitionedSlot = readSlots.find(
          ({ slot }) => slot === partitionedBalanceOfSlot,
        );
        if (!foundPartitionedSlot) continue;

        const candidate = this.buildFoundSlot(
          token,
          foundPartitionedSlot.address,
          { slot: candidateSlot, partition },
        );

        if (
          await this.verifyTokenBalanceSlot(
            chainId,
            token,
            candidate,
            baselineValue,
          )
        ) {
          return candidate;
        }

        console.warn(
          `Candidate 'balanceOf' slot ${candidateSlot} (partition ${p}) for token ${token} on chain ${chainId} failed verification, continuing search`,
        );
      }
    }

    // B20 native tokens serve `balanceOf` from a Rust precompile that reads
    // the token's storage directly, so no SLOADs appear in the trace — try
    // the known B20 layout blindly and let verification decide
    const b20Candidate: FoundSlot = {
      slot: TenderlySimulator.B20_BALANCES_SLOT,
    };
    if (
      await this.verifyTokenBalanceSlot(
        chainId,
        token,
        b20Candidate,
        baselineValue,
      )
    ) {
      return b20Candidate;
    }

    throw new Error(
      `Could not find a verified 'balanceOf' mapping slot for token ${token} on chain ${chainId}`,
    );
  }

  /**
   * Finds the slot of the `allowance` mapping in given token contract's storage.
   * Supports `Solidity` and `Vyper` contracts.
   * Found slots are verified with an additional simulation before being returned
   * @param chainId token chain id
   * @param token token address
   */
  async findTokenAllowanceSlot(
    chainId: number,
    token: string,
  ): Promise<FoundSlot> {
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

    // `allowance` result without any overrides, used as verification baseline
    const baselineValue = this.decodeUintOutput(callTrace.output) ?? 0n;

    const sloadCalls = this.getSLOADCalls(callTrace);
    // token's storage slots that were read during the `allowance` call
    const readSlots = sloadCalls
      .map(call => ({
        slot: call.storage_slot?.[0],
        address: call.storage_address,
      }))
      .filter(({ slot }) => !!slot);

    // try Solady layout: allowance slot is derived from a fixed seed, not a mapping
    const soladyAllowanceSlot = this.calculateSoladyAddressAllowanceSlot(
      TenderlySimulator.SOLADY_ALLOWANCE_SLOT_SEED,
      account,
      spender,
    );
    const foundSoladySlot = readSlots.find(
      ({ slot }) => slot === soladyAllowanceSlot,
    );
    if (foundSoladySlot) {
      const candidate = this.buildFoundSlot(token, foundSoladySlot.address, {
        slot: TenderlySimulator.SOLADY_ALLOWANCE_SLOT_SEED,
        isSolady: true,
      });

      if (
        await this.verifyTokenAllowanceSlot(
          chainId,
          token,
          candidate,
          baselineValue,
        )
      ) {
        return candidate;
      }

      console.warn(
        `Candidate 'allowance' slot seed (solady) for token ${token} on chain ${chainId} failed verification, continuing search`,
      );
    }

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
          const candidate = this.buildFoundSlot(
            token,
            foundSoliditySlot.address,
            { slot: candidateSlot },
          );

          if (
            await this.verifyTokenAllowanceSlot(
              chainId,
              token,
              candidate,
              baselineValue,
            )
          ) {
            return candidate;
          }

          console.warn(
            `Candidate 'allowance' slot ${candidateSlot} for token ${token} on chain ${chainId} failed verification, continuing search`,
          );
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
          const candidate = this.buildFoundSlot(token, foundVyperSlot.address, {
            slot: candidateSlot,
            isVyper: true,
          });

          if (
            await this.verifyTokenAllowanceSlot(
              chainId,
              token,
              candidate,
              baselineValue,
            )
          ) {
            return candidate;
          }

          console.warn(
            `Candidate 'allowance' slot ${candidateSlot} (vyper) for token ${token} on chain ${chainId} failed verification, continuing search`,
          );
        }
      }
    }

    // try partitioned layout (e.g. ViciERC20's `allowances[owner][partition][spender]`),
    // often held on an external state contract
    for (let p = 0n; p < 4n; p += 1n) {
      const partition = ethers.utils.defaultAbiCoder.encode(['uint'], [p]);
      for (let i = 0n; i < 1_000n; i += 1n) {
        const candidateSlot = ethers.utils.defaultAbiCoder.encode(
          ['uint'],
          [i],
        );
        const partitionedAllowanceSlot =
          this.calculatePartitionedAddressAllowanceSlot(
            candidateSlot,
            account,
            spender,
            partition,
          );
        const foundPartitionedSlot = readSlots.find(
          ({ slot }) => slot === partitionedAllowanceSlot,
        );
        if (!foundPartitionedSlot) continue;

        const candidate = this.buildFoundSlot(
          token,
          foundPartitionedSlot.address,
          { slot: candidateSlot, partition },
        );

        if (
          await this.verifyTokenAllowanceSlot(
            chainId,
            token,
            candidate,
            baselineValue,
          )
        ) {
          return candidate;
        }

        console.warn(
          `Candidate 'allowance' slot ${candidateSlot} (partition ${p}) for token ${token} on chain ${chainId} failed verification, continuing search`,
        );
      }
    }

    // B20 native tokens serve `allowance` from a Rust precompile that reads
    // the token's storage directly, so no SLOADs appear in the trace — try
    // the known B20 layout blindly and let verification decide
    const b20Candidate: FoundSlot = {
      slot: TenderlySimulator.B20_ALLOWANCES_SLOT,
    };
    if (
      await this.verifyTokenAllowanceSlot(
        chainId,
        token,
        b20Candidate,
        baselineValue,
      )
    ) {
      return b20Candidate;
    }

    throw new Error(
      `Could not find a verified 'allowance' mapping slot for token ${token} on chain ${chainId}`,
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
      isSolady: balanceSlot.isSolady,
      partition: balanceSlot.partition,
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
      tokenSlots.isSolady,
      tokenSlots.partition,
    );
    // add the balance override
    const address = tokenSlots.stateProxy ? tokenSlots.stateProxy : token;
    stateOverride[address] ||= {};
    stateOverride[address].storage ||= {};
    stateOverride[address].storage[slotToOverride] =
      ethers.utils.defaultAbiCoder.encode(['uint'], [amount]);

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
      tokenSlots.isSolady,
      tokenSlots.partition,
    );
    // add the allowance override
    const address = tokenSlots.stateProxy ? tokenSlots.stateProxy : token;
    stateOverride[address] ||= {};
    stateOverride[address].storage ||= {};
    stateOverride[address].storage[slotToOverride] =
      ethers.utils.defaultAbiCoder.encode(['uint'], [amount]);

    if (tokenSlots.additionalOverrides) {
      merge(stateOverride, tokenSlots.additionalOverrides);
    }
  }
}

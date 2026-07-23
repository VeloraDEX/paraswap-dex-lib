import { Interface } from '@ethersproject/abi';
import { DeepReadonly } from 'ts-essentials';
import { Contract } from 'web3-eth-contract';
import { Address, Log, Logger } from '../../types';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { getBigIntPow, catchParseLogError } from '../../utils';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { PoolState, PoolConfig } from './types';
import { LitePsmConfig } from './config';
import PsmABI from '../../abi/lite-psm/psm.json';
import VatABI from '../../abi/lite-psm/vat.json';
import { erc20Iface } from '../../lib/tokens/utils';
import DaiABI from '../../abi/lite-psm/dai.json';
import UsdcABI from '../../abi/lite-psm/usdc.json';

const vatInterface = new Interface(VatABI);
const psmInterface = new Interface(PsmABI);
const daiInterface = new Interface(DaiABI);
const usdcInterface = new Interface(UsdcABI);

const bigIntify = (b: any) => BigInt(b.toString());

export async function getOnChainState(
  multiContract: Contract,
  poolConfigs: PoolConfig[],
  vatAddress: Address,
  blockNumber: number | 'latest',
  daiAddress: Address,
): Promise<PoolState[]> {
  const callData = poolConfigs
    .map(c => [
      {
        target: c.psmAddress,
        callData: psmInterface.encodeFunctionData('tin', []),
      },
      {
        target: c.psmAddress,
        callData: psmInterface.encodeFunctionData('tout', []),
      },
      {
        target: vatAddress,
        callData: vatInterface.encodeFunctionData('ilks', [c.identifier]),
      },
      // dai liquidity
      // ceiling for `sellGem`
      {
        target: daiAddress,
        callData: erc20Iface.encodeFunctionData('balanceOf', [c.psmAddress]),
      },
      // gem liquidity
      // ceiling for `buyGem`
      {
        target: c.gem.address,
        callData: erc20Iface.encodeFunctionData('balanceOf', [c.pocketAddress]),
      },
    ])
    .flat();

  const res = await multiContract.methods
    .aggregate(callData)
    .call({}, blockNumber);

  let i = 0;
  const result = poolConfigs.map(c => {
    const tin = bigIntify(
      psmInterface.decodeFunctionResult('tin', res.returnData[i++])[0],
    );
    const tout = bigIntify(
      psmInterface.decodeFunctionResult('tout', res.returnData[i++])[0],
    );
    const ilks = vatInterface.decodeFunctionResult('ilks', res.returnData[i++]);
    const rate = bigIntify(ilks.rate);
    const daiBalance = bigIntify(
      erc20Iface.decodeFunctionResult('balanceOf', res.returnData[i++])[0],
    );
    const gemBalance = bigIntify(
      erc20Iface.decodeFunctionResult('balanceOf', res.returnData[i++])[0],
    );
    const response = {
      tin,
      tout,
      daiBalance,
      gemBalance,
      rate,
    };

    return response;
  });

  return result;
}

export class LitePsmEventPool extends StatefulEventSubscriber<PoolState> {
  handlers: {
    [event: string]: (event: any, pool: PoolState, log: Log) => PoolState;
  } = {};

  logDecoder: (log: Log) => any;

  to18ConversionFactor: bigint;
  bytes32Tout =
    '0x746f757400000000000000000000000000000000000000000000000000000000'; // bytes32('tout')
  bytes32Tin =
    '0x74696e0000000000000000000000000000000000000000000000000000000000'; // bytes32('tin')

  daiAddress: Address;

  constructor(
    parentName: string,
    protected network: number,
    protected dexHelper: IDexHelper,
    logger: Logger,
    public poolConfig: PoolConfig,
    protected vatAddress: Address,
  ) {
    super(parentName, poolConfig.identifier, dexHelper, logger);

    this.daiAddress =
      LitePsmConfig[this.parentName][this.network].dai.address.toLowerCase();
    this.logDecoder = (log: Log) => {
      const logAddress = log.address.toLowerCase();
      if (logAddress === this.daiAddress) {
        return daiInterface.parseLog(log);
      } else if (logAddress === this.poolConfig.gem.address) {
        return usdcInterface.parseLog(log);
      } else {
        return psmInterface.parseLog(log);
      }
    };
    this.addressesSubscribed = [
      poolConfig.psmAddress,
      this.daiAddress,
      this.poolConfig.gem.address,
    ];
    this.to18ConversionFactor = getBigIntPow(18 - poolConfig.gem.decimals);

    // Add handlers
    this.handlers['File'] = this.handleFile.bind(this);
    this.handlers['Transfer'] = this.handleTransfer.bind(this);
  }

  handleFile(event: any, pool: PoolState, log: Log): PoolState {
    if (event.args.what === this.bytes32Tin) {
      pool.tin = bigIntify(event.args.data);
    } else if (event.args.what === this.bytes32Tout) {
      pool.tout = bigIntify(event.args.data);
    }
    return pool;
  }

  handleTransfer(event: any, pool: PoolState, log: Log): PoolState {
    if (log.address.toLowerCase() === this.daiAddress) {
      return this.handleTransferDAI(event, pool, log);
    } else if (log.address.toLowerCase() === this.poolConfig.gem.address) {
      return this.handleTransferGEM(event, pool, log);
    }
    return pool;
  }

  handleTransferDAI(event: any, pool: PoolState, log: Log): PoolState {
    if (event.args?.src?.toLowerCase() === this.poolConfig.psmAddress) {
      pool.daiBalance -= bigIntify(event.args.wad);
    } else if (event.args?.dst?.toLowerCase() === this.poolConfig.psmAddress) {
      pool.daiBalance += bigIntify(event.args.wad);
    }
    return pool;
  }

  handleTransferGEM(event: any, pool: PoolState, log: Log): PoolState {
    if (event.args?.from?.toLowerCase() === this.poolConfig.pocketAddress) {
      pool.gemBalance -= bigIntify(event.args.value);
    } else if (
      event.args?.to?.toLowerCase() === this.poolConfig.pocketAddress
    ) {
      pool.gemBalance += bigIntify(event.args.value);
    }
    return pool;
  }

  getIdentifier(): string {
    return `${this.parentName}_${this.poolConfig.psmAddress}`.toLowerCase();
  }

  protected processLog(
    state: DeepReadonly<PoolState>,
    log: Readonly<Log>,
  ): DeepReadonly<PoolState> | null {
    try {
      const event = this.logDecoder(log);
      if (event.name in this.handlers) {
        return this.handlers[event.name](event, state, log);
      }
      return state;
    } catch (e) {
      catchParseLogError(e, this.logger);
      return null;
    }
  }

  async generateState(
    blockNumber: number | 'latest',
  ): Promise<Readonly<PoolState>> {
    return (
      await getOnChainState(
        this.dexHelper.multiContract,
        [this.poolConfig],
        this.vatAddress,
        blockNumber,
        this.daiAddress,
      )
    )[0];
  }
}

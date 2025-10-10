import { Interface } from '@ethersproject/abi';
import { DeepReadonly } from 'ts-essentials';
import _ from 'lodash';
import { Address, Log, Logger } from '../../types';
import { bigIntify, catchParseLogError } from '../../utils';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { IDexHelper } from '../../dex-helper/idex-helper';
import {
  AllVaultConfigs,
  VaultConfig,
  VaultsStates,
  VaultState,
} from './types';
import CapTokenAbi from '../../abi/cap/CapToken.json';
import PriceOracleAbi from '../../abi/cap/PriceOracle.json';

export class CapPools extends StatefulEventSubscriber<VaultsStates> {
  handlers: {
    [event: string]: (
      event: any,
      state: DeepReadonly<VaultsStates>,
      log: Readonly<Log>,
    ) => DeepReadonly<VaultsStates> | null;
  } = {};

  logDecoder: (log: Log) => any;

  addressesSubscribed: string[];

  constructor(
    readonly parentName: string,
    protected network: number,
    protected dexHelper: IDexHelper,
    logger: Logger,
    protected configs: AllVaultConfigs,
    protected capIface = new Interface(CapTokenAbi),
    protected oracleIface = new Interface(PriceOracleAbi),
  ) {
    super(parentName, 'cap', dexHelper, logger);

    this.logDecoder = (log: Log) => this.capIface.parseLog(log);
    this.addressesSubscribed = [
      ...Object.values(this.configs).map(config => config.vault.address),
    ];

    // Add handlers
    this.handlers['SetFeeData'] = this.handleSetFeeData.bind(this);
    this.handlers['Mint'] = this.handleMint.bind(this);
    this.handlers['Burn'] = this.handleBurn.bind(this);
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
  protected processLog(
    state: DeepReadonly<VaultsStates>,
    log: Readonly<Log>,
  ): DeepReadonly<VaultsStates> | null {
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

  /**
   * The function generates state using on-chain calls. This
   * function is called to regenerate state if the event based
   * system fails to fetch events and the local state is no
   * more correct.
   * @param blockNumber - Blocknumber for which the state should
   * should be generated
   * @returns state of the event subscriber at blocknumber
   */
  public async generateState(
    blockNumber: number,
    poolAddress?: Address,
  ): Promise<DeepReadonly<VaultsStates>> {
    const vaultStates: VaultsStates = {};

    for (const config of Object.values(this.configs)) {
      if (
        poolAddress &&
        config.vault.address.toLowerCase() !== poolAddress.toLowerCase()
      ) {
        continue;
      }

      const vaultState = {
        totalSupply: 0n,
        capPrice: 0n,
        assetPrice: {},
        assetSupply: {},
        assetFeeConfig: {},
      } as VaultState;

      const vault = config.vault;
      const vaultAddress = vault.address.toLowerCase();
      const priceOracle = config.priceOracle;
      const assets = Object.values(config.assets);

      const multicall = [
        {
          target: vaultAddress,
          callData: this.capIface.encodeFunctionData('totalSupply'),
        },
        {
          target: priceOracle,
          callData: this.oracleIface.encodeFunctionData('getPrice', [
            vaultAddress,
          ]),
        },
        ...assets.map(asset => ({
          target: priceOracle,
          callData: this.oracleIface.encodeFunctionData('getPrice', [
            asset.address,
          ]),
        })),
        ...assets.map(asset => ({
          target: vaultAddress,
          callData: this.capIface.encodeFunctionData('totalSupplies', [
            asset.address,
          ]),
        })),
        ...assets.map(asset => ({
          target: vaultAddress,
          callData: this.capIface.encodeFunctionData('getFeeData', [
            asset.address,
          ]),
        })),
      ];

      // on chain call
      const returnData = (
        await this.dexHelper.multiContract.methods
          .aggregate(multicall)
          .call({}, blockNumber)
      ).returnData;

      // split
      const totalSupplyRes = returnData[0];
      const capPriceRes = returnData[1];
      const assetPriceRes = returnData.slice(2, 2 + assets.length);
      const assetSupplyRes = returnData.slice(
        2 + assets.length,
        2 + assets.length * 2,
      );
      const assetFeeConfigRes = returnData.slice(
        2 + assets.length * 2,
        2 + assets.length * 3,
      );

      // Decode
      vaultState.totalSupply = bigIntify(
        this.capIface.decodeFunctionResult('totalSupply', totalSupplyRes)[0],
      );
      vaultState.capPrice = bigIntify(
        this.oracleIface.decodeFunctionResult('getPrice', capPriceRes)[0],
      );

      for (let i = 0; i < assets.length; i++) {
        const asset = assets[i];
        const assetAddress = asset.address.toLowerCase();
        vaultState.assetPrice[assetAddress] = bigIntify(
          this.oracleIface.decodeFunctionResult(
            'getPrice',
            assetPriceRes[i],
          )[0],
        );

        vaultState.assetSupply[assetAddress] = bigIntify(
          this.capIface.decodeFunctionResult(
            'totalSupplies',
            assetSupplyRes[i],
          )[0],
        );

        const { feeData } = this.capIface.decodeFunctionResult(
          'getFeeData',
          assetFeeConfigRes[i],
        );
        vaultState.assetFeeConfig[assetAddress] = {
          minMintFee: bigIntify(feeData.minMintFee),
          slope0: bigIntify(feeData.slope0),
          slope1: bigIntify(feeData.slope1),
          mintKinkRatio: bigIntify(feeData.mintKinkRatio),
          optimalRatio: bigIntify(feeData.optimalRatio),
          burnKinkRatio: bigIntify(feeData.burnKinkRatio),
        };
      }

      vaultStates[vaultAddress] = vaultState;
    }
    return vaultStates;
  }

  handleSetFeeData(
    event: any,
    state: DeepReadonly<VaultsStates>,
    log: Readonly<Log>,
  ): DeepReadonly<VaultsStates> | null {
    const vaultAddress = log.address.toLowerCase();
    const asset = event.args.asset.toLowerCase();
    const feeData = event.args.feeData;

    const newState = _.cloneDeep(state) as VaultsStates;
    newState[vaultAddress].assetFeeConfig[asset.toLowerCase()] = {
      minMintFee: bigIntify(feeData[0]),
      slope0: bigIntify(feeData[1]),
      slope1: bigIntify(feeData[2]),
      mintKinkRatio: bigIntify(feeData[3]),
      optimalRatio: bigIntify(feeData[4]),
      burnKinkRatio: bigIntify(feeData[5]),
    };

    return newState;
  }

  handleMint(
    event: any,
    state: DeepReadonly<VaultsStates>,
    log: Readonly<Log>,
  ): DeepReadonly<VaultsStates> | null {
    const vaultAddress = log.address.toLowerCase();
    const asset = event.args.asset.toLowerCase();
    const amountIn = bigIntify(event.args.amountIn);
    const amountOut = bigIntify(event.args.amountOut);
    const fee = bigIntify(event.args.fee);

    const newState = _.cloneDeep(state) as VaultsStates;
    newState[vaultAddress].assetSupply[asset] += amountIn;
    newState[vaultAddress].totalSupply += amountOut;
    newState[vaultAddress].totalSupply += fee;

    return newState;
  }

  handleBurn(
    event: any,
    state: DeepReadonly<VaultsStates>,
    log: Readonly<Log>,
  ): DeepReadonly<VaultsStates> | null {
    const vaultAddress = log.address.toLowerCase();
    const asset = event.args.asset.toLowerCase();
    const amountIn = bigIntify(event.args.amountIn);
    const amountOut = bigIntify(event.args.amountOut);
    const fee = bigIntify(event.args.fee);

    const newState = _.cloneDeep(state) as VaultsStates;
    newState[vaultAddress].assetSupply[asset] -= amountOut;
    newState[vaultAddress].totalSupply -= amountIn;
    newState[vaultAddress].totalSupply -= fee;

    return newState;
  }

  async getOrGenerateState(blockNumber: number): Promise<VaultsStates> {
    let state = this.getState(blockNumber);
    if (!state) {
      state = await this.generateState(blockNumber);
      this.setState(state, blockNumber);
    }
    return state;
  }
}

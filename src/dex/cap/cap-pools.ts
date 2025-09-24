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
import CapTokenAbi from './abis/CapToken.json';
import PriceOracleAbi from './abis/PriceOracle.json';

export class CapPools extends StatefulEventSubscriber<VaultsStates> {
  RAY_PRECISION = 10n ** 27n;

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

  public async updateOraclePrices(blockNumber: number): Promise<void> {
    const state = this.getState(blockNumber);

    const newState = state
      ? (_.cloneDeep(state) as VaultsStates)
      : Object.values(this.configs).reduce((acc, config) => {
          acc[config.vault.address.toLowerCase()] = {
            totalSupply: 0n,
            capPrice: 0n,
            assetPrice: Object.values(config.assets).reduce((acc, asset) => {
              acc[asset.address.toLowerCase()] = 0n;
              return acc;
            }, {} as VaultState['assetPrice']),
            assetSupply: Object.values(config.assets).reduce((acc, asset) => {
              acc[asset.address.toLowerCase()] = 0n;
              return acc;
            }, {} as VaultState['assetSupply']),
            assetFeeConfig: Object.values(config.assets).reduce(
              (acc, asset) => {
                acc[asset.address.toLowerCase()] = {
                  minMintFee: 0n,
                  slope0: 0n,
                  slope1: 0n,
                  mintKinkRatio: 0n,
                  optimalRatio: 0n,
                  burnKinkRatio: 0n,
                };
                return acc;
              },
              {} as VaultState['assetFeeConfig'],
            ),
          };
          return acc;
        }, {} as VaultsStates);

    for (const config of Object.values(this.configs)) {
      const vault = config.vault;
      const priceOracle = config.priceOracle;
      const assets = Object.values(config.assets);

      const multicall = [
        {
          target: priceOracle,
          callData: this.oracleIface.encodeFunctionData('getPrice', [
            vault.address,
          ]),
        },
        ...assets.map(asset => ({
          target: priceOracle,
          callData: this.oracleIface.encodeFunctionData('getPrice', [
            asset.address,
          ]),
        })),
      ];

      const returnData = (
        await this.dexHelper.multiContract.methods
          .aggregate(multicall)
          .call({}, blockNumber)
      ).returnData;

      // split
      const capPriceRes = returnData[0];
      const assetPriceRes = returnData.slice(1, 1 + assets.length);

      // decode
      newState[vault.address.toLowerCase()].capPrice = bigIntify(
        this.oracleIface.decodeFunctionResult('getPrice', capPriceRes)[0],
      );
      for (let i = 0; i < assets.length; i++) {
        const asset = assets[i];
        newState[vault.address.toLowerCase()].assetPrice[
          asset.address.toLowerCase()
        ] = bigIntify(
          this.oracleIface.decodeFunctionResult(
            'getPrice',
            assetPriceRes[i],
          )[0],
        );
      }
    }

    this._setState(newState, blockNumber, 'updateOraclePrices');
  }

  public getAmountOut(
    config: VaultConfig,
    params: { mint: boolean; asset: Address; amount: bigint },
    blockNumber: number,
  ): { amount: bigint; fee: bigint } {
    const state = this.getState(blockNumber);
    if (!state) {
      return { amount: params.amount, fee: 0n };
    }
    const vaultAddress = config.vault.address.toLowerCase();
    const vaultState = state[vaultAddress];
    if (!vaultState) {
      return { amount: params.amount, fee: 0n };
    }
    const { amountOutBeforeFee, newRatio } = this._amountOutBeforeFees(
      vaultState,
      config,
      params,
    );
    const { amount, fee } = this._applyFeeSlopes(vaultState, {
      asset: params.asset,
      mint: params.mint,
      amount: amountOutBeforeFee,
      ratio: newRatio,
    });
    return { amount, fee };
  }

  _amountOutBeforeFees(
    state: DeepReadonly<VaultState>,
    config: VaultConfig,
    params: { mint: boolean; asset: Address; amount: bigint },
  ): { amountOutBeforeFee: bigint; newRatio: bigint } {
    const assetAddress = params.asset.toLowerCase();
    const assetPrice = state.assetPrice[assetAddress];
    const capPrice = state.capPrice;

    const assetDecimalsPow =
      10n ** BigInt(config.assets[assetAddress].decimals);
    const capDecimalsPow = 10n ** BigInt(config.vault.decimals);

    const capSupply = state.totalSupply;
    const capValue = (capSupply * state.capPrice) / capDecimalsPow;
    const allocationValue =
      (state.assetSupply[assetAddress] * assetPrice) / assetDecimalsPow;

    let amount = 0n;
    let newRatio = 0n;
    if (params.mint) {
      const assetValue = (params.amount * assetPrice) / assetDecimalsPow;
      if (capSupply == 0n) {
        newRatio = 0n;
        amount = (assetValue * capDecimalsPow) / assetPrice;
      } else {
        newRatio =
          ((allocationValue + assetValue) * this.RAY_PRECISION) /
          (capValue + assetValue);
        amount = (assetValue * capDecimalsPow) / capPrice;
      }
    } else {
      const assetValue = (params.amount * capPrice) / capDecimalsPow;
      if (params.amount == capSupply) {
        newRatio = this.RAY_PRECISION;
        amount = (assetValue * assetDecimalsPow) / assetPrice;
      } else {
        if (allocationValue < assetValue || capValue <= assetValue) {
          newRatio = 0n;
        } else {
          newRatio =
            ((allocationValue - assetValue) * this.RAY_PRECISION) /
            (capValue - assetValue);
        }
        amount = (assetValue * assetDecimalsPow) / assetPrice;
      }
    }
    return { amountOutBeforeFee: amount, newRatio };
  }

  _applyFeeSlopes(
    state: DeepReadonly<VaultState>,
    params: {
      asset: Address;
      mint: boolean;
      amount: bigint;
      ratio: bigint;
    },
  ): { amount: bigint; fee: bigint } {
    const assetAddress = params.asset.toLowerCase();
    const fees = state.assetFeeConfig[assetAddress];

    let rate: bigint = 0n;
    if (params.mint) {
      rate = fees.minMintFee;
      if (params.ratio > fees.optimalRatio) {
        if (params.ratio > fees.mintKinkRatio) {
          const excessRatio = params.ratio - fees.mintKinkRatio;
          rate +=
            fees.slope0 +
            (fees.slope1 * excessRatio) /
              (this.RAY_PRECISION - fees.mintKinkRatio);
        } else {
          rate +=
            (fees.slope0 * (params.ratio - fees.optimalRatio)) /
            (fees.mintKinkRatio - fees.optimalRatio);
        }
      }
    } else {
      if (params.ratio < fees.optimalRatio) {
        if (params.ratio < fees.burnKinkRatio) {
          const excessRatio = fees.burnKinkRatio - params.ratio;
          rate = fees.slope0 + (fees.slope1 * excessRatio) / fees.burnKinkRatio;
        } else {
          rate =
            (fees.slope0 * (fees.optimalRatio - params.ratio)) /
            (fees.optimalRatio - fees.burnKinkRatio);
        }
      }
    }

    if (rate > this.RAY_PRECISION) rate = this.RAY_PRECISION;
    const fee = (params.amount * rate) / this.RAY_PRECISION;
    const amount = params.amount - fee;
    return { amount, fee };
  }
}

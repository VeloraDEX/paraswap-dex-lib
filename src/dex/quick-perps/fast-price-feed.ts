import _ from 'lodash';
import { Interface } from '@ethersproject/abi';
import { DeepReadonly } from 'ts-essentials';
import { PartialEventSubscriber } from '../../composed-event-subscriber';
import {
  Address,
  MultiCallInput,
  MultiCallOutput,
  Logger,
  Log,
  BlockHeader,
} from '../../types';
import { FastPriceFeedConfig, FastPriceFeedState } from './types';
import FastPriceFeedAbi from '../../abi/quick-perps/fast-price-feed.json';
import FastPriceEventsAbi from '../../abi/quick-perps/fast-price-events.json';
import { Lens } from '../../lens';

export class FastPriceFeed<State> extends PartialEventSubscriber<
  State,
  FastPriceFeedState
> {
  static readonly interface = new Interface(FastPriceFeedAbi);
  static readonly fastPriceEventsInterface = new Interface(FastPriceEventsAbi);

  BASIS_POINTS_DIVISOR = 10000n;
  protected priceDuration: number;
  protected maxDeviationBasisPoints: bigint;
  protected favorFastPrice: Record<string, boolean>;
  private spreadBasisPointsIfInactive: bigint;
  private spreadBasisPointsIfChainError: bigint;
  private maxPriceUpdateDelay: number;

  constructor(
    private fastPriceFeedAddress: Address,
    fastPriceEventsAddress: Address,
    private tokenAddresses: Address[],
    config: FastPriceFeedConfig,
    lens: Lens<DeepReadonly<State>, DeepReadonly<FastPriceFeedState>>,
    logger: Logger,
  ) {
    super([fastPriceEventsAddress], lens, logger);
    this.priceDuration = config.priceDuration;
    this.maxDeviationBasisPoints = config.maxDeviationBasisPoints;
    this.favorFastPrice = config.favorFastPrice;
    this.spreadBasisPointsIfInactive = config.spreadBasisPointsIfInactive;
    this.spreadBasisPointsIfChainError = config.spreadBasisPointsIfChainError;
    this.maxPriceUpdateDelay = config.maxPriceUpdateDelay;
  }

  public processLog(
    state: DeepReadonly<FastPriceFeedState>,
    log: Readonly<Log>,
    blockHeader: Readonly<BlockHeader>,
  ): DeepReadonly<FastPriceFeedState> | null {
    try {
      const parsed = FastPriceFeed.fastPriceEventsInterface.parseLog(log);
      switch (parsed.name) {
        case 'PriceUpdate': {
          const tokenAddress = parsed.args.token.toLowerCase();
          if (!(tokenAddress in state.prices)) return null;

          return {
            lastUpdatedAt:
              typeof blockHeader.timestamp === 'string'
                ? parseInt(blockHeader.timestamp)
                : blockHeader.timestamp,
            prices: {
              ...state.prices,
              [tokenAddress]: parsed.args.price.toBigInt(),
            },
          };
        }
        default:
          return null;
      }
    } catch (e) {
      this.logger.error('Failed to parse log', e);
      return null;
    }
  }

  getPrice(
    _state: DeepReadonly<State>,
    _token: Address,
    _refPrice: bigint,
    _maximize: boolean,
  ) {
    const state = this.lens.get()(_state);

    const timestamp = Math.floor(Date.now() / 1000);

    if (timestamp > state.lastUpdatedAt + this.maxPriceUpdateDelay) {
      if (_maximize) {
        return (
          (_refPrice *
            (this.BASIS_POINTS_DIVISOR + this.spreadBasisPointsIfChainError)) /
          this.BASIS_POINTS_DIVISOR
        );
      }

      return (
        (_refPrice *
          (this.BASIS_POINTS_DIVISOR - this.spreadBasisPointsIfChainError)) /
        this.BASIS_POINTS_DIVISOR
      );
    }

    if (timestamp > state.lastUpdatedAt + this.priceDuration) {
      if (_maximize) {
        return (
          (_refPrice *
            (this.BASIS_POINTS_DIVISOR + this.spreadBasisPointsIfInactive)) /
          this.BASIS_POINTS_DIVISOR
        );
      }

      return (
        (_refPrice *
          (this.BASIS_POINTS_DIVISOR - this.spreadBasisPointsIfInactive)) /
        this.BASIS_POINTS_DIVISOR
      );
    }

    const fastPrice = state.prices[_token];
    if (fastPrice === 0n) return _refPrice;

    let diffBasisPoints =
      _refPrice > fastPrice ? _refPrice - fastPrice : fastPrice - _refPrice;
    diffBasisPoints = (diffBasisPoints * this.BASIS_POINTS_DIVISOR) / _refPrice;

    // create a spread between the _refPrice and the fastPrice if the maxDeviationBasisPoints is exceeded
    // or if watchers have flagged an issue with the fast price
    const hasSpread =
      !this.favorFastPrice[_token] ||
      diffBasisPoints > this.maxDeviationBasisPoints;

    if (hasSpread) {
      // return the higher of the two prices
      if (_maximize) {
        return _refPrice > fastPrice ? _refPrice : fastPrice;
      }

      // return the lower of the two prices
      return _refPrice < fastPrice ? _refPrice : fastPrice;
    }

    return fastPrice;
  }

  static getConfigMulticallInputs(
    fastPriceFeedAddress: Address,
    tokenAddresses: Address[],
  ): MultiCallInput[] {
    return [
      {
        target: fastPriceFeedAddress,
        callData: FastPriceFeed.interface.encodeFunctionData('priceDuration'),
      },
      {
        target: fastPriceFeedAddress,
        callData: FastPriceFeed.interface.encodeFunctionData(
          'maxDeviationBasisPoints',
        ),
      },
      {
        target: fastPriceFeedAddress,
        callData: FastPriceFeed.interface.encodeFunctionData(
          'spreadBasisPointsIfInactive',
        ),
      },
      {
        target: fastPriceFeedAddress,
        callData: FastPriceFeed.interface.encodeFunctionData(
          'spreadBasisPointsIfChainError',
        ),
      },
      {
        target: fastPriceFeedAddress,
        callData: FastPriceFeed.interface.encodeFunctionData(
          'maxPriceUpdateDelay',
        ),
      },
      ...tokenAddresses.map(t => ({
        target: fastPriceFeedAddress,
        callData: FastPriceFeed.interface.encodeFunctionData('favorFastPrice', [
          t,
        ]),
      })),
    ];
  }

  static getConfig(
    multicallOutputs: MultiCallOutput[],
    tokenAddresses: Address[],
  ): FastPriceFeedConfig {
    return {
      priceDuration: parseInt(
        FastPriceFeed.interface
          .decodeFunctionResult('priceDuration', multicallOutputs[0])[0]
          .toString(),
      ),
      maxDeviationBasisPoints: BigInt(
        FastPriceFeed.interface
          .decodeFunctionResult(
            'maxDeviationBasisPoints',
            multicallOutputs[1],
          )[0]
          .toString(),
      ),
      spreadBasisPointsIfInactive: BigInt(
        FastPriceFeed.interface
          .decodeFunctionResult(
            'spreadBasisPointsIfInactive',
            multicallOutputs[2],
          )[0]
          .toString(),
      ),
      spreadBasisPointsIfChainError: BigInt(
        FastPriceFeed.interface
          .decodeFunctionResult(
            'spreadBasisPointsIfChainError',
            multicallOutputs[3],
          )[0]
          .toString(),
      ),
      maxPriceUpdateDelay: parseInt(
        FastPriceFeed.interface
          .decodeFunctionResult('maxPriceUpdateDelay', multicallOutputs[4])[0]
          .toString(),
      ),
      favorFastPrice: multicallOutputs
        .slice(5)
        .reduce<Record<string, boolean>>((acc, curr, i) => {
          acc[tokenAddresses[i]] = FastPriceFeed.interface.decodeFunctionResult(
            'favorFastPrice',
            curr,
          )[0];
          return acc;
        }, {}),
    };
  }

  public getGenerateStateMultiCallInputs(): MultiCallInput[] {
    const pricesEntries = this.tokenAddresses.map((t: Address) => ({
      target: this.fastPriceFeedAddress,
      callData: FastPriceFeed.interface.encodeFunctionData('prices', [t]),
    }));
    return [
      ...pricesEntries,
      {
        target: this.fastPriceFeedAddress,
        callData: FastPriceFeed.interface.encodeFunctionData('lastUpdatedAt'),
      },
    ];
  }

  public generateState(
    multicallOutputs: MultiCallOutput[],
    blockNumber?: number | 'latest',
  ): DeepReadonly<FastPriceFeedState> {
    let fastPriceFeedState: FastPriceFeedState = {
      prices: {},
      lastUpdatedAt: 0,
    };
    this.tokenAddresses.forEach(
      (t: Address, i: number) =>
        (fastPriceFeedState.prices[t] = BigInt(
          FastPriceFeed.interface
            .decodeFunctionResult('prices', multicallOutputs[i])[0]
            .toString(),
        )),
    );
    fastPriceFeedState.lastUpdatedAt = parseInt(
      FastPriceFeed.interface
        .decodeFunctionResult(
          'lastUpdatedAt',
          multicallOutputs[this.tokenAddresses.length],
        )[0]
        .toString(),
    );
    return fastPriceFeedState;
  }
}

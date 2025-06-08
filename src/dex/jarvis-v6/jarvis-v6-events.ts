import { DeepReadonly } from 'ts-essentials';
import { Logger } from '../../types';
import { ComposedEventSubscriber } from '../../composed-event-subscriber';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { lens } from '../../lens';
import { PoolConfig, PoolState } from './types';
import { getOnChainState } from './utils';
import { Interface } from 'ethers';
import { ChainLinkPriceFeed } from './chainLinkpriceFeed-event';
import { SynthereumPoolEvent } from './syntheteumPool-event';
import { Contract } from 'web3-eth-contract';
import { Address } from '@paraswap/core';
export class JarvisV6EventPool extends ComposedEventSubscriber<PoolState> {
  constructor(
    parentName: string,
    protected network: number,
    protected dexHelper: IDexHelper,
    logger: Logger,
    public poolConfig: PoolConfig,
    public priceFeedAdress: Address,
    public poolInterface: Interface,
    public priceFeedContract: Contract,
  ) {
    const chainLinkEvent = new ChainLinkPriceFeed(
      poolConfig.chainLinkAggregatorAddress,
      lens<DeepReadonly<PoolState>>().priceFeed,
      logger,
    );

    const poolEvent = new SynthereumPoolEvent(
      poolConfig.address,
      poolInterface,
      lens<DeepReadonly<PoolState>>().pool,
      logger,
    );
    super(parentName, 'pool', logger, dexHelper, [chainLinkEvent, poolEvent], {
      priceFeed: {
        usdcPrice: 0n,
      },
      pool: {
        feesPercentage: 0n,
      },
    });
  }

  getIdentifier(): string {
    return `${this.parentName}_${this.poolConfig.address}`.toLowerCase();
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
  async generateState(blockNumber: number): Promise<Readonly<PoolState>> {
    return (
      await getOnChainState(this.dexHelper, [this.poolConfig], blockNumber, {
        poolInterface: this.poolInterface,
        priceFeedContract: this.priceFeedContract,
      })
    )[0];
  }
}

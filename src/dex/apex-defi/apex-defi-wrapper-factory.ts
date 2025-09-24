import { Interface } from '@ethersproject/abi';
import { DeepReadonly } from 'ts-essentials';
import ApexDefiWrapperFactoryABI from '../../abi/apex-defi/ApexDefiWrapperFactory.abi.json';
import ApexDefiWrapperABI from '../../abi/apex-defi/ApexDefiWrapper.abi.json';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { Address, Log, Logger } from '../../types';
import { LogDescription } from 'ethers/lib/utils';

export interface WrapperInfo {
  wrapperAddress: Address;
  originalToken: Address;
  wrappedToken: Address;
  originalTokenDecimals: number;
  wrappedTokenDecimals: number;
}

export type WrapperFactoryState = Record<Address, WrapperInfo>;

export type OnWrapperCreatedCallback = ({
  wrapperInfo,
  blockNumber,
}: {
  wrapperInfo: WrapperInfo;
  blockNumber: number;
}) => Promise<void>;

/*
 * Event subscriber to capture "WrapperCreated" events on new wrappers created.
 * Maintains a cache of all wrapper information for quick lookups.
 */
export class ApexDefiWrapperFactory extends StatefulEventSubscriber<WrapperFactoryState> {
  handlers: {
    [event: string]: (event: any, log: Readonly<Log>) => Promise<void>;
  } = {};

  logDecoder: (log: Log) => any;

  public readonly wrapperFactoryIface = new Interface(
    ApexDefiWrapperFactoryABI,
  );
  public readonly wrapperIface = new Interface(ApexDefiWrapperABI);

  // Cache for quick lookups
  private wrapperCache: Map<Address, WrapperInfo> = new Map();
  private originalTokenToWrapper: Map<Address, Address> = new Map();
  private wrappedTokenToWrapper: Map<Address, Address> = new Map();

  constructor(
    readonly dexHelper: IDexHelper,
    parentName: string,
    protected readonly wrapperFactoryAddress: Address,
    logger: Logger,
    protected readonly onWrapperCreated: OnWrapperCreatedCallback,
  ) {
    super(parentName, `${parentName} WrapperFactory`, dexHelper, logger);

    this.addressesSubscribed = [wrapperFactoryAddress];

    this.logDecoder = (log: Log) => this.wrapperFactoryIface.parseLog(log);

    this.handlers['WrapperCreated'] = this.handleWrapperCreated.bind(this);
  }

  generateState(): WrapperFactoryState {
    return {};
  }

  protected async processLog(
    _: DeepReadonly<WrapperFactoryState>,
    log: Readonly<Log>,
  ): Promise<WrapperFactoryState> {
    const event = this.logDecoder(log);
    if (event.name in this.handlers) {
      await this.handlers[event.name](event, log);
    }

    return {};
  }

  async handleWrapperCreated(event: LogDescription, log: Readonly<Log>) {
    const { originalToken, wrappedToken, wrapperContract } = event.args;

    // Fetch wrapper details
    const wrapperInfo = await this.fetchWrapperInfo(
      wrapperContract.toLowerCase(),
      originalToken.toLowerCase(),
      wrappedToken.toLowerCase(),
    );

    if (wrapperInfo) {
      // Update caches
      // Fix case sensitivity issue in wrapper cache
      // Add to cache - use lowercase for consistency
      this.wrapperCache.set(
        wrapperInfo.wrapperAddress.toLowerCase(),
        wrapperInfo,
      );
      this.originalTokenToWrapper.set(
        wrapperInfo.originalToken,
        wrapperInfo.wrapperAddress.toLowerCase(), // Store lowercase
      );
      this.wrappedTokenToWrapper.set(
        wrapperInfo.wrappedToken,
        wrapperInfo.wrapperAddress.toLowerCase(), // Store lowercase
      );

      await this.onWrapperCreated({
        wrapperInfo,
        blockNumber: log.blockNumber,
      });
    }
  }

  private async fetchWrapperInfo(
    wrapperAddress: Address,
    originalToken: Address,
    wrappedToken: Address,
  ): Promise<WrapperInfo | null> {
    try {
      const blockNumber =
        await this.dexHelper.web3Provider.eth.getBlockNumber();

      const result = await this.dexHelper.multiContract.methods
        .aggregate([
          {
            target: wrapperAddress,
            callData: this.wrapperIface.encodeFunctionData(
              'originalTokenDecimals',
              [],
            ),
          },
          {
            target: wrapperAddress,
            callData: this.wrapperIface.encodeFunctionData(
              'wrappedTokenDecimals',
              [],
            ),
          },
        ])
        .call({}, blockNumber);

      const [originalTokenDecimals, wrappedTokenDecimals] =
        result.returnData.map((data: string, index: number) => {
          const decoded = this.wrapperIface.decodeFunctionResult(
            index === 0 ? 'originalTokenDecimals' : 'wrappedTokenDecimals',
            data,
          );
          return Number(decoded[0]);
        });

      return {
        wrapperAddress,
        originalToken,
        wrappedToken,
        originalTokenDecimals,
        wrappedTokenDecimals,
      };
    } catch (error) {
      this.logger.error(
        `Error fetching wrapper info for ${wrapperAddress}:`,
        error,
      );
      return null;
    }
  }

  // Initialize by fetching all existing wrappers
  async initialize(blockNumber: number): Promise<void> {
    try {
      // Get all wrappers from factory
      const result = await this.dexHelper.multiContract.methods
        .aggregate([
          {
            target: this.wrapperFactoryAddress,
            callData: this.wrapperFactoryIface.encodeFunctionData(
              'getAllWrappers',
              [],
            ),
          },
        ])
        .call({}, blockNumber);

      const wrapperAddresses = this.wrapperFactoryIface.decodeFunctionResult(
        'getAllWrappers',
        result.returnData[0],
      )[0] as Address[];

      // Use tryAggregate for all wrapper info calls
      const wrapperInfoCalls = wrapperAddresses
        .map(wrapperAddress => [
          {
            target: wrapperAddress,
            callData: this.wrapperIface.encodeFunctionData('originalToken', []),
          },
          {
            target: wrapperAddress,
            callData: this.wrapperIface.encodeFunctionData('wrappedToken', []),
          },
          {
            target: wrapperAddress,
            callData: this.wrapperIface.encodeFunctionData(
              'originalTokenDecimals',
              [],
            ),
          },
          {
            target: wrapperAddress,
            callData: this.wrapperIface.encodeFunctionData(
              'wrappedTokenDecimals',
              [],
            ),
          },
        ])
        .flat();

      const tokenResults = await this.dexHelper.multiContract.methods
        .tryAggregate(false, wrapperInfoCalls)
        .call({}, blockNumber);

      // Process results in groups of 4 (originalToken, wrappedToken, originalDecimals, wrappedDecimals)
      for (let i = 0; i < wrapperAddresses.length; i++) {
        const wrapperAddress = wrapperAddresses[i];
        const baseIndex = i * 4;

        const [originalTokenSuccess, originalTokenData] =
          tokenResults[baseIndex];
        const [wrappedTokenSuccess, wrappedTokenData] =
          tokenResults[baseIndex + 1];
        const [originalDecimalsSuccess, originalDecimalsData] =
          tokenResults[baseIndex + 2];
        const [wrappedDecimalsSuccess, wrappedDecimalsData] =
          tokenResults[baseIndex + 3];

        // Check if basic token info succeeded
        if (originalTokenSuccess && wrappedTokenSuccess) {
          const originalToken = this.wrapperIface
            .decodeFunctionResult('originalToken', originalTokenData)[0]
            .toLowerCase();

          const wrappedToken = this.wrapperIface
            .decodeFunctionResult('wrappedToken', wrappedTokenData)[0]
            .toLowerCase();

          // Handle decimals - use fallback for older wrappers
          let originalTokenDecimals: number;
          let wrappedTokenDecimals: number;

          if (originalDecimalsSuccess && wrappedDecimalsSuccess) {
            // New wrapper with decimals functions
            originalTokenDecimals = Number(
              this.wrapperIface.decodeFunctionResult(
                'originalTokenDecimals',
                originalDecimalsData,
              )[0],
            );
            wrappedTokenDecimals = Number(
              this.wrapperIface.decodeFunctionResult(
                'wrappedTokenDecimals',
                wrappedDecimalsData,
              )[0],
            );
          } else {
            // Fallback for older wrappers - assume standard decimals
            originalTokenDecimals = 18; // Default for most ERC20
            wrappedTokenDecimals = 18; // ERC314 always has 18 decimals
          }

          const wrapperInfo: WrapperInfo = {
            wrapperAddress,
            originalToken,
            wrappedToken,
            originalTokenDecimals,
            wrappedTokenDecimals,
          };

          // Add to cache
          this.wrapperCache.set(
            wrapperInfo.wrapperAddress.toLowerCase(),
            wrapperInfo,
          );
          this.originalTokenToWrapper.set(
            wrapperInfo.originalToken,
            wrapperInfo.wrapperAddress.toLowerCase(), // Store lowercase
          );
          this.wrappedTokenToWrapper.set(
            wrapperInfo.wrappedToken,
            wrapperInfo.wrapperAddress.toLowerCase(), // Store lowercase
          );
        }
      }
    } catch (error) {
      this.logger.error('Error initializing wrapper factory:', error);
    }
  }

  // Quick lookup methods
  getWrapperInfo(wrapperAddress: Address): WrapperInfo | undefined {
    const result = this.wrapperCache.get(wrapperAddress.toLowerCase());
    return result;
  }

  getWrapperByOriginalToken(originalToken: Address): Address | undefined {
    const result = this.originalTokenToWrapper.get(originalToken.toLowerCase());
    return result;
  }

  getWrapperByWrappedToken(wrappedToken: Address): Address | undefined {
    return this.wrappedTokenToWrapper.get(wrappedToken.toLowerCase());
  }

  isWrappedToken(tokenAddress: Address): boolean {
    return this.wrappedTokenToWrapper.has(tokenAddress.toLowerCase());
  }

  isOriginalToken(tokenAddress: Address): boolean {
    return this.originalTokenToWrapper.has(tokenAddress.toLowerCase());
  }

  // Get all wrapper infos
  getAllWrappers(): WrapperInfo[] {
    return Array.from(this.wrapperCache.values());
  }

  // ✅ New helper methods for wrapper operations
  /**
   * Check if two tokens form a wrapper pair and return wrapper info
   */
  getWrapperPairInfo(
    srcToken: Address,
    destToken: Address,
  ): {
    wrapperAddress: Address;
    isWrap: boolean;
    wrapperInfo: WrapperInfo;
  } | null {
    // Check if srcToken has a wrapper that matches destToken (wrap operation)
    const srcWrapper = this.getWrapperByOriginalToken(srcToken);
    if (srcWrapper) {
      const wrapperInfo = this.getWrapperInfo(srcWrapper);
      if (
        wrapperInfo &&
        wrapperInfo.wrappedToken.toLowerCase() === destToken.toLowerCase()
      ) {
        return {
          wrapperAddress: srcWrapper,
          isWrap: true,
          wrapperInfo,
        };
      }
    }

    // Check if destToken has a wrapper that matches srcToken (unwrap operation)
    const destWrapper = this.getWrapperByOriginalToken(destToken);
    if (destWrapper) {
      const wrapperInfo = this.getWrapperInfo(destWrapper);
      if (
        wrapperInfo &&
        wrapperInfo.wrappedToken.toLowerCase() === srcToken.toLowerCase()
      ) {
        return {
          wrapperAddress: destWrapper,
          isWrap: false,
          wrapperInfo,
        };
      }
    }

    return null;
  }

  /**
   * Check if two tokens form a wrapper operation
   */
  isWrapperOperation(srcToken: Address, destToken: Address): boolean {
    return this.getWrapperPairInfo(srcToken, destToken) !== null;
  }

  // Release resources
  releaseResources(): void {
    this.wrapperCache.clear();
    this.originalTokenToWrapper.clear();
    this.wrappedTokenToWrapper.clear();
    this.handlers = {};
    this.addressesSubscribed = [];
  }
}

import { UniswapV3Factory } from '../../uniswap-v3-factory';
import { LogDescription } from 'ethers';
import { Interface } from '@ethersproject/abi';
import FactoryABI from '../../../../abi/velodrome-slipstream/VelodromeSlipstreamFactory.abi.json';

export class VelodromeSlipstreamFactory extends UniswapV3Factory {
  public readonly factoryIface = new Interface(FactoryABI);

  async handleNewPool(event: LogDescription) {
    const token0 = event.args.token0.toLowerCase();
    const token1 = event.args.token1.toLowerCase();
    const tickSpacing = event.args.tickSpacing;

    await this.onPoolCreated({ token0, token1, fee: tickSpacing });
  }
}

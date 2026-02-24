import { UniswapV3Factory } from '../../uniswap-v3-factory';
import { LogDescription } from 'ethers/lib/utils';
import { Interface } from '@ethersproject/abi';
import FactoryABI from '../../../../abi/pharaoh-v3/PharaohV3Factory.abi.json';

export class PharaohV3Factory extends UniswapV3Factory {
  public readonly factoryIface = new Interface(FactoryABI);

  async handleNewPool(event: LogDescription) {
    const token0 = event.args.token0.toLowerCase();
    const token1 = event.args.token1.toLowerCase();
    const tickSpacing = event.args.tickSpacing;

    await this.onPoolCreated({ token0, token1, fee: tickSpacing });
  }
}

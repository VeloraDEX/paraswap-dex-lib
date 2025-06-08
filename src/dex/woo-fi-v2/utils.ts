import { Interface } from 'ethers';
import wooPPV2ABI from '../../abi/woo-fi-v2/WooPPV2.abi.json';
import wooOracleV2ABI from '../../abi/woo-fi-v2/WooOracleV2.abi.json';
import wooIntegrationHelper from '../../abi/woo-fi-v2/IntegrationHelper.abi.json';
import { WooFiV2Interfaces } from './types';

export const ifaces: WooFiV2Interfaces = {
  PPV2: new Interface(wooPPV2ABI),
  oracleV2: new Interface(wooOracleV2ABI),
  integrationHelper: new Interface(wooIntegrationHelper),
  chainlink: new Interface([
    'function latestRoundData() view returns (tuple(uint80 roundId, ' +
      'int256 answer, uint256 startedAt, uint256 updatedAt, ' +
      'uint80 answeredInRound))',
  ]),
  erc20BalanceOf: new Interface([
    'function balanceOf(address) view returns (uint256)',
  ]),
};

import dotenv from 'dotenv';
dotenv.config();
import VaultABI from '../../abi/balancer-v2/vault.json';
import { Contract, JsonRpcProvider } from 'ethers';

// Compare retrieve an onchain query result for a single swap
export async function queryOnChain(
  rpcUrl: string,
  blockNumber: number,
  poolId: string,
  kind: 0 | 1,
  assetIn: string,
  assetOut: string,
  amount: BigInt,
): Promise<bigint[]> {
  const provider = new JsonRpcProvider(rpcUrl);
  const vaultAddress = '0xBA12222222228d8Ba445958a75a0704d566BF2C8';
  const vaultContract = new Contract(vaultAddress, VaultABI, provider);

  const funds = {
    sender: '0x0000000000000000000000000000000000000000',
    recipient: '0x0000000000000000000000000000000000000000',
    fromInternalBalance: false,
    toInternalBalance: false,
  };
  const swaps = [
    {
      poolId,
      assetInIndex: 0,
      assetOutIndex: 1,
      amount,
      userData: '0x',
    },
  ];
  const assets = [assetIn, assetOut];
  const deltas = await vaultContract.queryBatchSwap(
    kind,
    swaps,
    assets,
    funds,
    {
      blockTag: blockNumber,
    },
  );
  // console.log(deltas.toString());
  return [deltas[0].toBigInt(), deltas[1].toBigInt()];
}

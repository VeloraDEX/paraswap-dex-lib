// npx ts-node scripts/run-dex-integration-v3.ts
/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Network, SwapSide } from '../src/constants';
import { BalancerV3 } from '../src/dex/balancer-v3/balancer-v3';
import { DummyDexHelper } from '../src/dex-helper/index';
import { BI_POWS } from '../src/bigint-constants';

const stataUSDC = {
  address: '0x8a88124522dbbf1e56352ba3de1d9f78c143751e'.toLowerCase(),
  decimals: 6,
};

const stataDAI = {
  address: '0xde46e43f46ff74a23a65ebb0580cbe3dfe684a17'.toLowerCase(),
  decimals: 18,
};

const stataUSDT = {
  address: '0x978206fae13faf5a8d293fb614326b237684b750'.toLowerCase(),
  decimals: 6,
};

const bal = {
  address: '0xb19382073c7a0addbb56ac6af1808fa49e377b75'.toLowerCase(),
  decimals: 18,
};

const daiAave = {
  address: '0xff34b3d4aee8ddcd6f9afffb6fe49bd371b8a357'.toLowerCase(),
  decimals: 18,
};

const usdcAave = {
  address: '0x94a9d9ac8a22534e3faca9f4e7f2e2cf85d5e4c8'.toLowerCase(),
  decimals: 6,
};

const amounts = [0n, BI_POWS[6], BI_POWS[7], BI_POWS[8]];

async function main() {
  const dexHelper = new DummyDexHelper(Network.SEPOLIA);
  const blocknumber = await dexHelper.web3Provider.eth.getBlockNumber();

  const balancerV3 = new BalancerV3(Network.SEPOLIA, 'BalancerV3', dexHelper);

  await balancerV3.initializePricing(blocknumber);

  // const from = stataUSDC;
  // const to = stataUSDT;
  const from = usdcAave;
  const to = daiAave;

  const pools = await balancerV3.getPoolIdentifiers(
    from,
    to,
    SwapSide.SELL,
    blocknumber,
  );
  console.log('Pool Identifiers: ', from.address, to.address, pools);

  const prices = await balancerV3.getPricesVolume(
    from,
    to,
    amounts,
    SwapSide.SELL,
    blocknumber,
    pools,
  );
  console.log('Pool Prices: ', prices);

  const poolLiquidity = await balancerV3.getTopPoolsForToken(from.address, 10);
  console.log('Top Pools:', poolLiquidity);
}

main();

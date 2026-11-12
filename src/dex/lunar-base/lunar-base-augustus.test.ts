/* eslint-disable no-console */
jest.mock('../../lib/promise-scheduler', () => ({
  PromiseScheduler: class {
    addPromise() {
      throw new Error('Unexpected background RPC retry');
    }
  },
}));
process.env.HTTP_PROVIDER_8453 ??= 'https://base-rpc.publicnode.com';
process.env.HTTP_PROVIDER_56 ??= 'https://bsc-rpc.publicnode.com';
import { DummyDexHelper } from '../../dex-helper';
import { GenericSwapTransactionBuilder } from '../../generic-swap-transaction-builder';
import { PricingHelper } from '../../pricing-helper';
import { LunarBase } from './lunar-base';
import { Weth } from '../weth/weth';
import { Interface, defaultAbiCoder } from '@ethersproject/abi';
import { keccak256 } from '@ethersproject/keccak256';
import { ContractMethod, SwapSide } from '@paraswap/core';
import { LocalParaswapSDK } from '../../implementations/local-paraswap-sdk';
import { Network, ETHER_ADDRESS } from '../../constants';
import { LunarBaseConfig } from './config';
import PoolABI from '../../abi/lunar-base/pool.json';
import AugustusABI from '../../abi/augustus-v6/ABI.json';

// Opt in: exercises deployed Augustus/executors/pools using read-only eth_call.
// Only caller funding, ERC-20 approval and origin blacklist are overridden.
const live = process.env.LUNAR_BASE_RPC_E2E === '1' ? describe : describe.skip;
const USER = '0x00000000000000000000000000000000000a11ce';
const ACCESS = BigInt(
  '0x9832e62c6c6e13b4465b385de9f563995a2974f4f839176dcccf0b12e5c11200',
);
const poolIface = new Interface(PoolABI);
const augustusIface = new Interface(AugustusABI);
const erc20Iface = new Interface([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
]);
const hex = (n: bigint) => '0x' + n.toString(16);
const hex32 = (n: bigint) => '0x' + n.toString(16).padStart(64, '0');
const mapping = (address: string, slot: bigint | string) =>
  keccak256(defaultAbiCoder.encode(['address', 'uint256'], [address, slot]));
const prod = {
  Executor01: '0x006d0e0d006109f0020f3050000a713780b7b000',
  Executor02: '0x082738d007001080a00099a000004f3006152085',
};
const networks = [
  {
    network: Network.BASE,
    url: process.env.HTTP_PROVIDER_8453 || 'https://base-rpc.publicnode.com',
    block: Number(process.env.LUNAR_BASE_E2E_BLOCK_BASE || 53549749),
    balanceSlot: 9n,
    allowanceSlot: 10n,
    usdDecimals: 6,
    threshold: 5_000_000n,
  },
  {
    network: Network.BSC,
    url: process.env.HTTP_PROVIDER_56 || 'https://bsc-rpc.publicnode.com',
    block: Number(process.env.LUNAR_BASE_E2E_BLOCK_BSC || 131832664),
    balanceSlot: 1n,
    allowanceSlot: 2n,
    usdDecimals: 18,
    threshold: 100_000_000n,
  },
];

live.each(networks)('LunarBase Augustus RPC $network', net => {
  let sdk: LocalParaswapSDK;
  let pool: string,
    usd: string,
    wrapped: string,
    augustus: string,
    baseFee: bigint;
  let blacklist = false;
  let originalExecutors: Record<string, string>;
  const blacklistKey = mapping(USER, ACCESS + 2n);
  const poolOverrides = () => ({
    [pool]: { stateDiff: { [blacklistKey]: hex32(blacklist ? 1n : 0n) } },
  });
  const rpc = async (method: string, params: unknown[]) => {
    const response = await fetch(net.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(30_000),
    });
    const result: any = await response.json();
    if (result.error) throw new Error(JSON.stringify(result.error));
    return result.result;
  };

  beforeAll(async () => {
    process.env[`HTTP_PROVIDER_${net.network}`] = net.url;
    const helper = new DummyDexHelper(net.network, net.url);
    jest
      .spyOn(helper.provider as any, 'send')
      .mockImplementation((method: any, params: any) => rpc(method, params));
    const transport: any = {
      send: (payload: any, callback: any) => {
        rpc(payload.method, payload.params).then(
          result => callback(null, { ...payload, result }),
          callback,
        );
      },
    };
    helper.web3Provider.setProvider(transport);
    (helper.multiContract as any).setProvider(transport);
    (helper.multiNonZeroSenderContract as any).setProvider(transport);
    const lunar = new LunarBase(net.network, 'LunarBase', helper);
    const wethKey = Weth.dexKeysWithNetwork.find(d =>
      d.networks.includes(net.network),
    )!.key;
    const weth = new Weth(net.network, wethKey, helper);
    const getDex = (key: string) =>
      key.toLowerCase() === 'lunarbase' ? lunar : weth;
    // Keep real SDK pricing/building, while avoiding unrelated DEX services.
    const service: any = {
      network: net.network,
      dexHelper: helper,
      routeOptimizers: [],
      getDexByKey: getDex,
      getTxBuilderDexByKey: getDex,
      getAllDexKeys: () => ['LunarBase'],
      isDirectFunctionNameV6: () => false,
    };
    sdk = Object.assign(Object.create(LocalParaswapSDK.prototype), {
      network: net.network,
      dexHelper: helper,
      dexAdapterService: service,
      pricingHelper: new PricingHelper(service, helper.getLogger),
      dexKeys: ['LunarBase'],
      transactionBuilder: new GenericSwapTransactionBuilder(
        service,
        undefined,
        undefined,
        undefined,
        true,
      ),
      skipPreProcess: false,
    });
    pool = LunarBaseConfig.LunarBase[net.network].pools[0].address;
    usd = LunarBaseConfig.LunarBase[net.network].pools[0].tokenY.address;
    wrapped = sdk.dexHelper.config.data.wrappedNativeTokenAddress;
    augustus = sdk.dexHelper.config.data.augustusV6Address!;
    originalExecutors = { ...sdk.dexHelper.config.data.executorsAddresses! };
    const provider = sdk.dexHelper.provider;
    const getBlock = provider.getBlock.bind(provider);
    const getStorage = provider.getStorageAt.bind(provider);
    jest.spyOn(provider, 'getBlockNumber').mockResolvedValue(net.block);
    jest
      .spyOn(provider, 'getBlock')
      .mockImplementation(() => getBlock(net.block));
    jest
      .spyOn(provider, 'getStorageAt')
      .mockImplementation((address: any, slot: any, tag: any) =>
        typeof address === 'string' &&
        address.toLowerCase() === pool &&
        slot === blacklistKey
          ? Promise.resolve(hex32(blacklist ? 1n : 0n))
          : getStorage(address, slot, tag),
      );
    jest
      .spyOn(sdk.dexHelper.web3Provider.eth, 'getBlockNumber')
      .mockResolvedValue(net.block);
    const block = await provider.getBlock(net.block);
    baseFee = BigInt(block.baseFeePerGas?.toString() ?? '0');
    await lunar.initializePricing(net.block);
    for (const [token, balanceSlot, allowanceSlot] of [
      [usd, net.balanceSlot, net.allowanceSlot],
      [wrapped, 3n, 4n],
    ] as const) {
      const overrides = {
        [token]: {
          stateDiff: {
            [mapping(USER, balanceSlot)]: hex32(10n ** 30n),
            [mapping(augustus, mapping(USER, allowanceSlot))]: hex32(
              (1n << 256n) - 1n,
            ),
          },
        },
      };
      for (const [method, args, expected] of [
        ['balanceOf', [USER], 10n ** 30n],
        ['allowance', [USER, augustus], (1n << 256n) - 1n],
      ] as const) {
        const raw = await rpc('eth_call', [
          { to: token, data: erc20Iface.encodeFunctionData(method, [...args]) },
          hex(BigInt(net.block)),
          overrides,
        ]);
        expect(
          BigInt(erc20Iface.decodeFunctionResult(method, raw)[0].toString()),
        ).toBe(expected);
      }
    }
  }, 120_000);

  afterAll(async () => {
    await sdk?.releaseResources();
    jest.restoreAllMocks();
  });

  async function buildAndCall(
    direction: string,
    tip: bigint,
    blacklisted: boolean,
    production: boolean,
    split = false,
  ) {
    blacklist = blacklisted;
    Object.assign(
      sdk.dexHelper.config.data.executorsAddresses!,
      production ? prod : originalExecutors,
    );
    const nativeIn = direction === 'native-in',
      wrappedIn = direction === 'wrapped-in';
    const src = nativeIn ? ETHER_ADDRESS : wrappedIn ? wrapped : usd;
    const dst =
      direction === 'native-out'
        ? ETHER_ADDRESS
        : direction === 'wrapped-out'
        ? wrapped
        : usd;
    const xToY = nativeIn || wrappedIn;
    const amount = xToY ? 10n ** 17n : 1000n * 10n ** BigInt(net.usdDecimals);
    const route = await sdk.getPrices(
      { address: src, decimals: xToY ? 18 : net.usdDecimals },
      { address: dst, decimals: xToY ? net.usdDecimals : 18 },
      amount,
      SwapSide.SELL,
      ContractMethod.swapExactAmountIn,
    );
    const chosenExecutor =
      sdk.dexHelper.config.data.executorsAddresses![
        split ? 'Executor02' : 'Executor01'
      ];
    const quoteMethod = xToY ? 'quoteXToY' : 'quoteYToX';
    const gasPrice = baseFee + tip;
    // Independent on-chain quote with msg.sender=executor, tx.origin=USER.
    const forwarder =
      '0x3660006000376000600036600073' +
      pool.slice(2) +
      '5afa3d600060003e3d6000f3';
    const quoteRaw = await rpc('eth_call', [
      {
        from: USER,
        to: chosenExecutor,
        data: poolIface.encodeFunctionData(quoteMethod, [amount.toString()]),
        gas: '0x989680',
        gasPrice: hex(gasPrice),
      },
      hex(BigInt(net.block)),
      {
        ...poolOverrides(),
        [USER]: { balance: hex(10n ** 24n) },
        [chosenExecutor]: { code: forwarder },
      },
    ]);
    const expected = BigInt(
      poolIface.decodeFunctionResult(quoteMethod, quoteRaw)[0].toString(),
    );
    expect(expected).toBeGreaterThan(0n);
    route.destAmount = expected.toString();
    const se = route.bestRoute[0].swaps[0].swapExchanges[0];
    se.destAmount = expected.toString();
    if (split) {
      route.bestRoute[0].swaps[0].swapExchanges = [
        {
          ...se,
          percent: 50,
          srcAmount: (amount / 2n).toString(),
          destAmount: (expected / 2n).toString(),
        },
        {
          ...se,
          percent: 50,
          srcAmount: (amount - amount / 2n).toString(),
          destAmount: (expected - expected / 2n).toString(),
        },
      ];
    }
    const minimum = (expected * 99n) / 100n;
    const tx = await sdk.buildTransaction(route, minimum, USER, {
      gasPrice: gasPrice.toString(),
    });
    const decoded = augustusIface.decodeFunctionData(
      'swapExactAmountIn',
      tx.data,
    );
    expect(decoded.executor.toLowerCase()).toBe(chosenExecutor.toLowerCase());
    const funding: any = { [USER]: { balance: hex(10n ** 24n) } };
    if (!nativeIn) {
      const balanceSlot = wrappedIn ? 3n : net.balanceSlot;
      const allowanceSlot = wrappedIn ? 4n : net.allowanceSlot;
      funding[src] = {
        stateDiff: {
          [mapping(USER, balanceSlot)]: hex32(10n ** 30n),
          [mapping(augustus, mapping(USER, allowanceSlot))]: hex32(
            (1n << 256n) - 1n,
          ),
        },
      };
    }
    const result = await rpc('eth_call', [
      {
        from: USER,
        to: tx.to,
        data: tx.data,
        value: hex(BigInt(tx.value)),
        gas: '0x989680',
        gasPrice: hex(gasPrice),
      },
      hex(BigInt(net.block)),
      { ...poolOverrides(), ...funding },
    ]);
    const received = BigInt(
      augustusIface
        .decodeFunctionResult('swapExactAmountIn', result)
        .receivedAmount.toString(),
    );
    if (split) expect(received).toBeGreaterThanOrEqual(minimum);
    else expect(received).toBe(expected);
  }

  for (const production of [false, true])
    for (const blacklisted of [false, true])
      for (const taxed of [false, true]) {
        for (const direction of [
          'native-in',
          'native-out',
          'wrapped-in',
          'wrapped-out',
        ]) {
          it(`${direction} prod=${production} blacklist=${blacklisted} tax=${taxed}`, async () => {
            await buildAndCall(
              direction,
              taxed ? net.threshold + 1n : 0n,
              blacklisted,
              production,
            );
          }, 90_000);
        }
        it(`Executor02 split prod=${production} blacklist=${blacklisted} tax=${taxed}`, async () => {
          await buildAndCall(
            'native-in',
            taxed ? net.threshold + 1n : 0n,
            blacklisted,
            production,
            true,
          );
        }, 90_000);
      }

  it('rejects the old indicative quote at 1 gwei and 1% slippage', async () => {
    blacklist = false;
    Object.assign(
      sdk.dexHelper.config.data.executorsAddresses!,
      originalExecutors,
    );
    const route = await sdk.getPrices(
      { address: usd, decimals: net.usdDecimals },
      { address: ETHER_ADDRESS, decimals: 18 },
      1000n * 10n ** BigInt(net.usdDecimals),
      SwapSide.SELL,
      ContractMethod.swapExactAmountIn,
    );
    await expect(
      sdk.buildTransaction(
        route,
        (BigInt(route.destAmount) * 99n) / 100n,
        USER,
        { gasPrice: (baseFee + 1_000_000_000n).toString() },
      ),
    ).rejects.toThrow(/slippage/i);
  }, 90_000);
});

// npx jest src/dex/balancer-v3/balancer-test-step-optimisation.test.ts
import dotenv from 'dotenv';
dotenv.config();

import { OptimalRate } from '@paraswap/core';
import { generateConfig } from '../../config';
import {
  ContractsAugustusV6,
  runE2ETest,
} from '../../../tests/v6/utils-e2e-v6';
import { assert } from 'ts-essentials';

// set timeout to 2 min
jest.setTimeout(120000);

describe('e2e route step optimisation test', function () {
  it('previous failing route should pass', async () => {
    // This route was previously failing because of circular steps: https://dashboard.tenderly.co/shared/simulation/db83c309-9a74-43a0-bc16-f480f6ea05d3/debugger?trace=0.4.0.2
    const route = {
      priceRoute: {
        blockNumber: 62926205,
        network: 43114,
        srcToken: '0x49d5c2bdffac6ce2bfdb6640f4f80f226bc10bab',
        srcDecimals: 18,
        srcAmount: '3679328395107495669',
        destToken: '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e',
        destDecimals: 6,
        destAmount: '10000000000',
        bestRoute: [
          {
            percent: 100,
            swaps: [
              {
                srcToken: '0x49d5c2bdffac6ce2bfdb6640f4f80f226bc10bab',
                srcDecimals: 18,
                destToken: '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e',
                destDecimals: 6,
                swapExchanges: [
                  {
                    exchange: 'UniswapV3',
                    srcAmount: '2501706291592120885',
                    destAmount: '6800000000',
                    percent: 68,
                    poolAddresses: [
                      '0x7b602f98d71715916e7c963f51bfebc754ade2d0',
                      '0xfae3f424a0a47706811521e3ee268f00cfb5c45e',
                    ],
                    data: {
                      path: [
                        {
                          tokenIn: '0x49d5c2bdffac6ce2bfdb6640f4f80f226bc10bab',
                          tokenOut:
                            '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7',
                          fee: '500',
                          currentFee: '500',
                        },
                        {
                          tokenIn: '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7',
                          tokenOut:
                            '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e',
                          fee: '500',
                          currentFee: '500',
                        },
                      ],
                      gasUSD: '0.006044',
                    },
                  },
                  {
                    exchange: 'BalancerV3',
                    srcAmount: '73643765444483050',
                    destAmount: '200000000',
                    percent: 2,
                    poolAddresses: [
                      '0x1c39ebe0ee53b52ab24d3945e9cde9e6c09d0851',
                      '0xa4e1b0ddffc0e3aa63dbca462cf370e4f1dc9b8b',
                    ],
                    data: {
                      steps: [
                        {
                          pool: '0xdfd2b2437a94108323045c282ff1916de5ac6af7',
                          isBuffer: true,
                          swapInput: {
                            tokenIn:
                              '0x49d5c2bdffac6ce2bfdb6640f4f80f226bc10bab',
                            tokenOut:
                              '0xdfd2b2437a94108323045c282ff1916de5ac6af7',
                          },
                          poolState: {
                            poolType: 'Buffer',
                            rate: '1034475059805496559',
                            poolAddress:
                              '0xdfd2b2437a94108323045c282ff1916de5ac6af7',
                            tokens: [
                              '0xdfd2b2437a94108323045c282ff1916de5ac6af7',
                              '0x49d5c2bdffac6ce2bfdb6640f4f80f226bc10bab',
                            ],
                            maxDeposit: '4654780188345264720336',
                            maxMint: '4499654336007349435534',
                          },
                        },
                        {
                          pool: '0x1c39ebe0ee53b52ab24d3945e9cde9e6c09d0851',
                          isBuffer: false,
                          swapInput: {
                            tokenIn:
                              '0xdfd2b2437a94108323045c282ff1916de5ac6af7',
                            tokenOut:
                              '0xd7da0de6ef4f51d6206bf2a35fcd2030f54c3f7b',
                          },
                          poolState: {
                            poolAddress:
                              '0x1c39ebe0ee53b52ab24d3945e9cde9e6c09d0851',
                            tokens: [
                              '0xd7da0de6ef4f51d6206bf2a35fcd2030f54c3f7b',
                              '0xdfd2b2437a94108323045c282ff1916de5ac6af7',
                            ],
                            tokensUnderlying: [
                              '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7',
                              '0x49d5c2bdffac6ce2bfdb6640f4f80f226bc10bab',
                            ],
                            weights: ['0', '0'],
                            poolType: 'GYROE',
                            supportsUnbalancedLiquidity: true,
                            paramsAlpha: '5500000000000000',
                            paramsBeta: '15000000000000000',
                            paramsC: '999950003749687527',
                            paramsS: '9999500037496875',
                            paramsLambda: '200000000000000000000',
                            tauAlphaX:
                              '-66894440433238925463515674889048938000',
                            tauAlphaY: '74331244030514175131560768922084630000',
                            tauBetaX: '70705375016684549325975825261456310000',
                            tauBetaY: '70715980822937048189234457735214970000',
                            u: '1375860568442390470754757981931911000',
                            v: '74330882540342434541799348386411720000',
                            w: '-36149017174053863036111383905877107',
                            z: '70691616411000125372993601430688440000',
                            dSq: '99999999999999999931198756577414140000',
                            tokenRates: [
                              '1066497598862175314',
                              '1034475059805496559',
                            ],
                            balancesLiveScaled18: [
                              '9690031810623619853220',
                              '30778958185535733097',
                            ],
                            swapFee: '500000000000000',
                            aggregateSwapFee: '500000000000000000',
                            totalSupply: '49963561079110223811',
                            scalingFactors: ['1', '1'],
                            isPoolPaused: false,
                            erc4626Rates: [
                              '1066497598862175314',
                              '1034475059805496559',
                            ],
                            erc4626MaxDeposit: [
                              '1937056184768238776143221',
                              '4654780188345264720336',
                            ],
                            erc4626MaxMint: [
                              '1816278055229420847749165',
                              '4499654336007349435534',
                            ],
                          },
                        },
                        {
                          pool: '0xd7da0de6ef4f51d6206bf2a35fcd2030f54c3f7b',
                          isBuffer: true,
                          swapInput: {
                            tokenIn:
                              '0xd7da0de6ef4f51d6206bf2a35fcd2030f54c3f7b',
                            tokenOut:
                              '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7',
                          },
                          poolState: {
                            poolType: 'Buffer',
                            rate: '1066497598862175314',
                            poolAddress:
                              '0xd7da0de6ef4f51d6206bf2a35fcd2030f54c3f7b',
                            tokens: [
                              '0xd7da0de6ef4f51d6206bf2a35fcd2030f54c3f7b',
                              '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7',
                            ],
                            maxDeposit: '1937056184768238776143221',
                            maxMint: '1816278055229420847749165',
                          },
                        },
                        {
                          pool: '0xd7da0de6ef4f51d6206bf2a35fcd2030f54c3f7b',
                          isBuffer: true,
                          swapInput: {
                            tokenIn:
                              '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7',
                            tokenOut:
                              '0xd7da0de6ef4f51d6206bf2a35fcd2030f54c3f7b',
                          },
                          poolState: {
                            poolType: 'Buffer',
                            rate: '1066497598862175314',
                            poolAddress:
                              '0xd7da0de6ef4f51d6206bf2a35fcd2030f54c3f7b',
                            tokens: [
                              '0xd7da0de6ef4f51d6206bf2a35fcd2030f54c3f7b',
                              '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7',
                            ],
                            maxDeposit: '1937056184768238776143221',
                            maxMint: '1816278055229420847749165',
                          },
                        },
                        {
                          pool: '0xa4e1b0ddffc0e3aa63dbca462cf370e4f1dc9b8b',
                          isBuffer: false,
                          swapInput: {
                            tokenIn:
                              '0xd7da0de6ef4f51d6206bf2a35fcd2030f54c3f7b',
                            tokenOut:
                              '0xe1bfc96d95badcb10ff013cb0c9c6c737ca07009',
                          },
                          poolState: {
                            poolAddress:
                              '0xa4e1b0ddffc0e3aa63dbca462cf370e4f1dc9b8b',
                            tokens: [
                              '0xd7da0de6ef4f51d6206bf2a35fcd2030f54c3f7b',
                              '0xe1bfc96d95badcb10ff013cb0c9c6c737ca07009',
                            ],
                            tokensUnderlying: [
                              '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7',
                              '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e',
                            ],
                            weights: ['0', '0'],
                            poolType: 'GYROE',
                            supportsUnbalancedLiquidity: true,
                            paramsAlpha: '7500000000000000000',
                            paramsBeta: '45000000000000000000',
                            paramsC: '24992191160203069',
                            paramsS: '999687646408122754',
                            paramsLambda: '30000000000000000000',
                            tauAlphaX:
                              '-95550312908677070784959170355723320000',
                            tauAlphaY: '29498096600524921381211347958709500000',
                            tauBetaX: '8299968683539462235953516161184301000',
                            tauBetaY: '99654957327030471196964876138171490000',
                            u: '2594635392684985222832437413440397000',
                            v: '99611136676982684998620276840548620000',
                            w: '1752826001911444101662466996693476000',
                            z: '-95485447023859946062394167477928100000',
                            dSq: '99999999999999999904129173164956330000',
                            tokenRates: [
                              '1066497598862175314',
                              '1147527817416494493',
                            ],
                            balancesLiveScaled18: [
                              '9349562877802865257043',
                              '269993972620450849321210',
                            ],
                            swapFee: '1000000000000000',
                            aggregateSwapFee: '500000000000000000',
                            totalSupply: '17874647515300997374261',
                            scalingFactors: ['1', '1000000000000'],
                            isPoolPaused: false,
                            erc4626Rates: [
                              '1066497598862175314',
                              '1147527817416494493',
                            ],
                            erc4626MaxDeposit: [
                              '1937056184768238776143221',
                              '162024185243579',
                            ],
                            erc4626MaxMint: [
                              '1816278055229420847749165',
                              '141194124259536',
                            ],
                          },
                        },
                        {
                          pool: '0xe1bfc96d95badcb10ff013cb0c9c6c737ca07009',
                          isBuffer: true,
                          swapInput: {
                            tokenIn:
                              '0xe1bfc96d95badcb10ff013cb0c9c6c737ca07009',
                            tokenOut:
                              '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e',
                          },
                          poolState: {
                            poolType: 'Buffer',
                            rate: '1147527817416494493',
                            poolAddress:
                              '0xe1bfc96d95badcb10ff013cb0c9c6c737ca07009',
                            tokens: [
                              '0xe1bfc96d95badcb10ff013cb0c9c6c737ca07009',
                              '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e',
                            ],
                            maxDeposit: '162024185243579',
                            maxMint: '141194124259536',
                          },
                        },
                      ],
                      gasUSD: '0.015696',
                    },
                  },
                  {
                    exchange: 'TraderJoeV2.1',
                    srcAmount: '1103978338070891734',
                    destAmount: '3000000000',
                    percent: 30,
                    poolAddresses: [
                      '0x1901011a39B11271578a1283D620373aBeD66faA',
                      '0x864d4e5Ee7318e97483DB7EB0912E09F161516EA',
                    ],
                    data: {
                      tokenPath: [
                        '0x49d5c2bdffac6ce2bfdb6640f4f80f226bc10bab',
                        '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7',
                        '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e',
                      ],
                      binSteps: ['10', '10'],
                      versions: ['2', '3'],
                      gasUSD: '0.011090',
                    },
                  },
                ],
              },
            ],
          },
        ],
        gasCostUSD: '0.033409',
        gasCost: '1205010',
        others: [],
        side: 'BUY',
        version: '6.2',
        contractAddress: '0x6a000f20005980200259b80c5102003040001068',
        tokenTransferProxy: '0x6a000f20005980200259b80c5102003040001068',
        contractMethod: 'swapExactAmountOut',
        partnerFee: 0,
        srcUSD: '10038.3484536557',
        destUSD: '9998.0600000000',
        partner: 'anon',
        maxImpactReached: false,
        hmac: 'bf49e87e27b51573832e6f94f698596731a58a81',
      },
      minMaxAmount: '10000000000',
    };

    assert(
      'priceRoute' in route,
      'priceRoute is missing, please dump full TxOpts',
    );
    assert(
      'minMaxAmount' in route,
      'minMaxAmount is missing, please dump full TxOpts',
    );

    const {
      priceRoute: { network },
    } = route;

    const config = generateConfig(network);
    const { augustusV6Address, executorsAddresses: _executorsAddresses } =
      config;

    assert(augustusV6Address, 'augustus should be defined');
    assert(_executorsAddresses, 'executors should be defined');
    assert('Executor01' in _executorsAddresses, 'executor01 should be defined');
    assert('Executor02' in _executorsAddresses, 'executor02 should be defined');
    assert('Executor03' in _executorsAddresses, 'executor03 should be defined');

    const executorsAddresses = _executorsAddresses as Pick<
      ContractsAugustusV6,
      'Executor01' | 'Executor02' | 'Executor03'
    >;

    const contractAddresses: ContractsAugustusV6 = {
      AugustusV6: augustusV6Address,
      ...executorsAddresses,
    };

    await runE2ETest(
      route.priceRoute as OptimalRate,
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      contractAddresses,
    );
  });
});

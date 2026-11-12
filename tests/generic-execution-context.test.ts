import { GenericSwapTransactionBuilder } from '../src/generic-swap-transaction-builder';
import { SwapSide } from '../src/constants';

const user = '0x1111111111111111111111111111111111111111';
const executor = '0x2222222222222222222222222222222222222222';
const token = '0x3333333333333333333333333333333333333333';

describe('GenericSwapTransactionBuilder execution context', () => {
  it('forwards the actual transaction gas parameters and origin', async () => {
    const builder: any = Object.create(GenericSwapTransactionBuilder.prototype);
    builder.dexAdapterService = {
      isDirectFunctionNameV6: () => false,
      dexHelper: { config: { data: { augustusV6Address: executor } } },
    };
    builder._build = jest
      .fn()
      .mockResolvedValue({ encoder: () => '0x', params: [] });
    await builder.build({
      priceRoute: { side: SwapSide.SELL, srcToken: token, destAmount: '10000' },
      minMaxAmount: '9000',
      userAddress: user,
      partnerAddress: user,
      partnerFeePercent: '0',
      uuid: 'id',
      deadline: '1',
      gasPrice: '123',
      getDexParamOptions: {
        executionContext: { txOrigin: user, gasPrice: '999' },
      },
    });
    expect(builder._build.mock.calls[0].at(-1)).toMatchObject({
      executionContext: { txOrigin: user, gasPrice: '123' },
    });
  });
  it('forwards a proportional per-leg minimum to the local adapter', async () => {
    const builder: any = Object.create(GenericSwapTransactionBuilder.prototype);
    const getDexParam = jest.fn().mockResolvedValue({ needWrapNative: false });
    builder.dexAdapterService = {
      getTxBuilderDexByKey: () => ({ needWrapNative: false, getDexParam }),
    };
    builder.getDexCallsParams = () => ({
      srcToken: token,
      destToken: user,
      srcAmount: '100',
      destAmount: '1',
      recipient: executor,
      wethDeposit: 0n,
      wethWithdraw: 0n,
    });
    const exchange = {
      exchange: 'LunarBase',
      srcAmount: '100',
      destAmount: '7501',
      data: {},
    };
    await builder.buildSingleExchangeParam(
      { side: SwapSide.SELL, destAmount: '10000' },
      0,
      {},
      0,
      exchange,
      '9000',
      { getAddress: () => executor },
      { executionContext: { txOrigin: user, gasPrice: '123' } },
    );
    expect(getDexParam.mock.calls[0].at(-1)).toMatchObject({
      executionContext: {
        txOrigin: user,
        gasPrice: '123',
        minimumAmountOut: '6751',
      },
    });
  });
});

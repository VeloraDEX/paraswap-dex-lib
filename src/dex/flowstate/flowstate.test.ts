/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Interface } from '@ethersproject/abi';
import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide, ETHER_ADDRESS } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { Token } from '../../types';
import { FlowState } from './flowstate';
import { FlowStateData } from './types';

/*
  Deterministic unit tests — no network, no live pools. These pin the two
  things that MUST stay correct for safety:

  1. Additivity guards: the module returns []/null for everything except an
     exact-input NATIVE-ETH -> ERC20 SELL. This is what guarantees adding
     FlowState can never perturb an existing Velora route (Kyber included) —
     it only ever contributes a new source on the one shape it serves.

  2. getDexParam calldata: buyFromPool(pool, amount, resellerCode, recipient)
     with amount RE-DERIVED from srcAmount at the quoted 1inch rate (matching
     the contract's checkAmounts band), plus the exact V6 execution flags
     (native ETH, recipient-aware, NO insert-from-amount patch = Flag 9).
*/

const DEX_KEY = 'FlowState';
const ROUTER = '0x93B7C8A5d4F70Bc6158c2A03D77b1B3134224Bb1';

const FLOWSTATE_IFACE = new Interface([
  'function buyFromPool(address pool, uint256 amount, string resellerCode, address buyer) payable',
]);

// An arbitrary ERC20 (WETH address reused purely as a non-native placeholder).
const TOKEN: Token = {
  address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  decimals: 18,
};
const ETH: Token = { address: ETHER_ADDRESS, decimals: 18 };

describe('FlowState (unit)', () => {
  const network = Network.MAINNET;
  const dexHelper = new DummyDexHelper(network);
  const flowState = new FlowState(network, DEX_KEY, dexHelper);
  const blockNumber = 0;

  describe('additivity guards', () => {
    it('getPoolIdentifiers is empty for BUY (exact-output)', async () => {
      const ids = await flowState.getPoolIdentifiers(
        ETH,
        TOKEN,
        SwapSide.BUY,
        blockNumber,
      );
      expect(ids).toEqual([]);
    });

    it('getPoolIdentifiers is empty for non-ETH src (TOKEN -> TOKEN)', async () => {
      const ids = await flowState.getPoolIdentifiers(
        TOKEN,
        TOKEN,
        SwapSide.SELL,
        blockNumber,
      );
      expect(ids).toEqual([]);
    });

    it('getPoolIdentifiers is empty when dest is ETH (TOKEN -> ETH, the sell side we do NOT serve)', async () => {
      const ids = await flowState.getPoolIdentifiers(
        ETH,
        ETH,
        SwapSide.SELL,
        blockNumber,
      );
      expect(ids).toEqual([]);
    });

    it('getPricesVolume returns null for BUY', async () => {
      const prices = await flowState.getPricesVolume(
        ETH,
        TOKEN,
        [0n, BI_POWS[18]],
        SwapSide.BUY,
        blockNumber,
      );
      expect(prices).toBeNull();
    });

    it('getPricesVolume returns null for non-ETH src', async () => {
      const prices = await flowState.getPricesVolume(
        TOKEN,
        TOKEN,
        [0n, BI_POWS[18]],
        SwapSide.SELL,
        blockNumber,
      );
      expect(prices).toBeNull();
    });

    it('getPricesVolume declines when isFirstSwap === false (cannot be an intermediate hop)', async () => {
      const prices = await flowState.getPricesVolume(
        ETH,
        TOKEN,
        [0n, BI_POWS[18]],
        SwapSide.SELL,
        blockNumber,
        undefined, // limitPools
        undefined, // transferFees
        false, // isFirstSwap — engine says we're not the route input
      );
      expect(prices).toBeNull();
    });
  });

  describe('getDexParam (V6 calldata)', () => {
    // rate = weiPerToken. 5e14 wei/token => 1 token costs 0.0005 ETH.
    const rate = 5n * BI_POWS[14];
    const data: FlowStateData = {
      pool: '0xb2281ea3c4e92365abf12666c6057ba61ec41358',
      resellerCode: '',
      rate: rate.toString(),
    };
    const recipient = '0x1111111111111111111111111111111111111111';
    const srcAmount = (3n * BI_POWS[18]).toString(); // 3 ETH in

    const param = flowState.getDexParam(
      ETHER_ADDRESS,
      TOKEN.address,
      srcAmount,
      '0', // destAmount (min) is intentionally ignored by getDexParam
      recipient,
      data,
      SwapSide.SELL,
    );

    it('sets the exact V6 execution flags (native ETH, recipient-aware, no insert-from-amount)', () => {
      expect(param.needWrapNative).toBe(false);
      expect(param.dexFuncHasRecipient).toBe(true);
      expect(param.targetExchange.toLowerCase()).toBe(ROUTER.toLowerCase());
      expect(param.returnAmountPos).toBeUndefined();
      // Flag 9, NOT Flag 18: we must never patch an ETH amount into calldata.
      expect(
        (param as { sendEthButSupportsInsertFromAmount?: boolean })
          .sendEthButSupportsInsertFromAmount,
      ).toBeUndefined();
    });

    it('encodes buyFromPool with amount re-derived from srcAmount at the quoted rate', () => {
      const decoded = FLOWSTATE_IFACE.decodeFunctionData(
        'buyFromPool',
        param.exchangeData,
      );
      // 3 ETH / (0.0005 ETH/token) = 6000 tokens
      const expectedAmount = (3n * BI_POWS[18] * BI_POWS[18]) / rate;
      expect(expectedAmount).toBe(6000n * BI_POWS[18]);
      expect(decoded.pool.toLowerCase()).toBe(data.pool.toLowerCase());
      expect(BigInt(decoded.amount.toString())).toBe(expectedAmount);
      expect(decoded.resellerCode).toBe('');
      expect(decoded.buyer.toLowerCase()).toBe(recipient.toLowerCase());
    });

    it('sends the buyer the tokens directly (buyer arg == recipient)', () => {
      const decoded = FLOWSTATE_IFACE.decodeFunctionData(
        'buyFromPool',
        param.exchangeData,
      );
      expect(decoded.buyer.toLowerCase()).toBe(recipient.toLowerCase());
    });
  });
});

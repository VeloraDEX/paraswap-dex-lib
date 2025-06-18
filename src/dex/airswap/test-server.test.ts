import dotenv from 'dotenv';
dotenv.config();

import { ethers } from 'ethers';
import express from 'express';
import {
  createOrderERC20,
  createOrderERC20Signature,
  toAtomicString,
  toDecimalString,
  getCostFromPricing,
} from '@airswap/utils';
import { Pricing } from '@airswap/types';
import { SmartTokens } from '../../../tests/constants-e2e';
import { PORT_TEST_SERVER } from '../../constants';

const smartTokens = SmartTokens[1];
const Levels: Pricing[] = [
  {
    baseToken: smartTokens.DAI.address,
    quoteToken: smartTokens.WETH.address,
    minimum: '0',
    bid: [['10000000000000000000', '0.9']],
    ask: [['10000000000000000000', '1.1']],
  },
  {
    baseToken: smartTokens.WETH.address,
    quoteToken: smartTokens.DAI.address,
    minimum: '0',
    bid: [['10000000000000000000', '1']],
    ask: [['10000000000000000000', '1']],
  },
];

const EXPIRY = 100000;
const PROTOCOL_FEE = 7;

export function result(id: string, result: any) {
  return {
    jsonrpc: '2.0',
    id,
    result,
  };
}

export function error(id: string, code: any, message: any) {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    error: { code, message },
  });
}

export const startTestServer = (account: ethers.Wallet) => {
  const app = express();
  app.use(express.json({ strict: false }));
  app.post('/', async (req, res) => {
    const id = req.body.id;
    const method = req.body.method;
    const params = req.body.params;
    let response;

    if (method === 'getAllPricingERC20') {
      response = result(id, Levels);
    } else if (
      method === 'getSignerSideOrderERC20' ||
      method === 'getSenderSideOrderERC20'
    ) {
      let { signerToken, senderWallet, senderToken } = params;

      const signerDecimals = 6;
      const senderDecimals = 6;
      let signerAmount;
      let senderAmount;

      try {
        switch (method) {
          case 'getSignerSideOrderERC20':
            senderAmount = toDecimalString(params.senderAmount, senderDecimals);
            signerAmount = getCostFromPricing(
              'buy',
              senderAmount,
              senderToken,
              signerToken,
              Levels,
            );
            break;
          case 'getSenderSideOrderERC20':
            signerAmount = toDecimalString(params.signerAmount, signerDecimals);
            senderAmount = getCostFromPricing(
              'sell',
              signerAmount,
              signerToken,
              senderToken,
              Levels,
            );
            break;
        }

        if (signerAmount && senderAmount) {
          const order = createOrderERC20({
            nonce: String(Date.now()),
            expiry: String(Math.floor(Date.now() / 1000) + Number(EXPIRY)),
            protocolFee: String(PROTOCOL_FEE),
            signerWallet: account.address,
            signerToken,
            signerAmount: toAtomicString(signerAmount, signerDecimals),
            senderWallet,
            senderToken,
            senderAmount: toAtomicString(senderAmount, senderDecimals),
          });

          const signature = await createOrderERC20Signature(
            order,
            account.privateKey,
            params.swapContract,
            params.chainId,
            '4.1',
            'SWAP_ERC20',
          );

          response = result(id, {
            ...order,
            ...signature,
          });
        } else {
          response = error(id, -33601, 'Not serving pair');
        }
      } catch (e: any) {
        response = error(id, -33603, e.message);
      }
    }
    return res.status(200).json(response);
  });

  const server = app.listen(PORT_TEST_SERVER);
  return () => {
    server.close();
  };
};

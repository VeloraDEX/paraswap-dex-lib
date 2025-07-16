import { v4 as uuid } from 'uuid';
import joi from 'joi';
import { Token } from '../../types';
import { validateAndCast } from '../../lib/validators';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { SwapSide } from '../../constants';
import { AirSwapPricingResponse } from './types';

export function getServerPricingKey(url: string): string {
  return `${encodeURIComponent(url)}-PRICING`.toLowerCase();
}

export function getPoolKey(srcAddress: string, destAddress: string): string {
  return `${srcAddress}-${destAddress}-POOL`.toLowerCase();
}

export function getPoolIdentifier(
  dexKey: string,
  srcToken: Token,
  destToken: Token,
  url: string,
): string {
  return `${dexKey}-${destToken.address}-${
    srcToken.address
  }-${encodeURIComponent(url)}`;
}

export async function getAllPricingERC20(options: any, dexHelper: IDexHelper) {
  return await dexHelper.httpRequest.request({
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    data: {
      id: uuid(),
      method: 'getAllPricingERC20',
      params: {},
    },
    ...options,
  });
}

export async function getOrderERC20(
  side: SwapSide,
  dexHelper: IDexHelper,
  url: string,
  chainId: string,
  swapContract: string,
  signerToken: string,
  amount: string,
  senderToken: string,
  senderWallet: string,
  minExpiry: string,
  proxyingFor: string,
) {
  const params: any = {
    chainId,
    swapContract,
    signerToken,
    senderToken,
    senderWallet,
    minExpiry,
    proxyingFor,
  };
  let method;
  if (side === SwapSide.SELL) {
    method = 'getSignerSideOrderERC20';
    params.senderAmount = amount;
  } else {
    method = 'getSenderSideOrderERC20';
    params.signerAmount = amount;
  }
  const response = await dexHelper.httpRequest.request({
    url,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: {
      id: uuid(),
      method,
      params,
    },
  });
  return response.data.result;
}

export function remove(array: string[], item: string) {
  let length = array.length;
  while (length--) {
    if (array[length] === item) {
      array.splice(length, 1);
      break;
    }
  }
  return array;
}

export const pricingResponseValidator = joi.object({
  jsonrpc: joi.string(),
  id: joi.string(),
  result: joi.array().items({
    baseToken: joi.string().required(),
    quoteToken: joi.string().required(),
    minimum: joi.string().optional(),
    bid: joi
      .array()
      .items(
        joi.array().items(joi.string().required(), joi.string().required()),
      ),
    ask: joi
      .array()
      .items(
        joi.array().items(joi.string().required(), joi.string().required()),
      ),
  }),
});

export function caster(data: unknown) {
  return validateAndCast<AirSwapPricingResponse>(
    data,
    pricingResponseValidator,
  );
}

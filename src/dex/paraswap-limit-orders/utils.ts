import { TypedDataEncoder } from 'ethers';
import { Network } from '../../constants';
import { toUnixTimestamp } from '../../utils';
import { BUILD_ORDER_CONSTANTS } from './constant';
import { AugustusOrderWithString } from './types';

export function buildOrderData(
  chainId: Network,
  params: AugustusOrderWithString,
  contractAddress: string,
) {
  const domain = {
    name: BUILD_ORDER_CONSTANTS.NAME,
    version: BUILD_ORDER_CONSTANTS.VERSION,
    chainId: chainId,
    verifyingContract: contractAddress,
  };

  let expiry = 0;
  if (params.expiry.length > 10) {
    expiry = toUnixTimestamp(new Date(params.expiry));
  } else {
    expiry = Number(params.expiry);
  }

  const types = { Order: BUILD_ORDER_CONSTANTS.ORDER_INTERFACE };
  const order = {
    nonceAndMeta: params.nonceAndMeta,
    expiry,
    makerAsset: params.makerAsset,
    takerAsset: params.takerAsset,
    maker: params.maker,
    taker: params.taker,
    makerAmount: params.makerAmount,
    takerAmount: params.takerAmount,
  };

  return { domain, types, order };
}

export function calculateOrderHash(
  chainId: Network,
  params: AugustusOrderWithString,
  contractAddress: string,
) {
  const { domain, types, order } = buildOrderData(
    chainId,
    params,
    contractAddress,
  );
  return TypedDataEncoder.hash(domain, types, order);
}

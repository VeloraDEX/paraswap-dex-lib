import { BytesLike } from 'ethers';
import { generalDecoder } from '../../lib/decoders';
import { MultiResult } from '../../lib/multi-wrapper';
import { DecimalInfo, TokenInfo, TokenState } from './types';

export function tokenInfoDecoder(
  result: MultiResult<BytesLike> | BytesLike,
): TokenInfo {
  return generalDecoder(
    result,
    ['uint192', 'uint16', 'uint128', 'uint128', 'uint192'],
    undefined,
    value => ({
      reserve: value[0].toBigInt(),
      feeRate: BigInt(value[1].toString()),
      maxGamma: value[2].toBigInt(),
      maxNotionalSwap: value[3].toBigInt(),
      capBal: value[4].toBigInt(),
    }),
  );
}

export function decimalInfoDecoder(
  result: MultiResult<BytesLike> | BytesLike,
): DecimalInfo {
  return generalDecoder(
    result,
    ['tuple(uint64 priceDec, uint64 quoteDec, uint64 baseDec)'],
    undefined,
    value => ({
      priceDec: value[0].priceDec.toBigInt(),
      quoteDec: value[0].quoteDec.toBigInt(),
      baseDec: value[0].baseDec.toBigInt(),
    }),
  );
}

// This is state from WooOracleV2 contract
export function stateDecoder(
  result: MultiResult<BytesLike> | BytesLike,
): TokenState {
  return generalDecoder(
    result,
    ['tuple(uint128 price, uint64 spread, uint64 coeff, bool woFeasible)'],
    undefined,
    value => ({
      price: value[0].price.toBigInt(),
      spread: value[0].spread.toBigInt(),
      coeff: value[0].coeff.toBigInt(),
      woFeasible: value[0].woFeasible,
    }),
  );
}

import { BigNumber, constants } from 'ethers';

const TRILLION_ETHER_DECIMAL_PLACE = 30;
const ETHER_DECIMAL_PLACE = 18;
const BPS_DECIMAL_PLACE = 4;

export const mulTruncateBN = (a: BigNumber, b: BigNumber): BigNumber => {
  return a.mul(b).div(constants.WeiPerEther);
};

export const divScaleBN = (a: BigNumber, b: BigNumber): BigNumber => {
  return a.mul(constants.WeiPerEther).div(b);
};

export const mulOneNegative = (val: BigNumber): BigNumber => {
  return mulTruncateBN(val, constants.NegativeOne);
};

export const tetherToEther = (value: BigNumber): BigNumber => {
  return changeDecimalUnit(
    value,
    TRILLION_ETHER_DECIMAL_PLACE,
    ETHER_DECIMAL_PLACE,
  );
};

export const etherToTether = (value: BigNumber): BigNumber => {
  return changeDecimalUnit(
    value,
    ETHER_DECIMAL_PLACE,
    TRILLION_ETHER_DECIMAL_PLACE,
  );
};

export const toAbsoluteBPSRate = (val: BigNumber): BigNumber => {
  const bps: BigNumber = changeDecimalUnit(
    val,
    ETHER_DECIMAL_PLACE,
    BPS_DECIMAL_PLACE,
  );

  return changeDecimalUnit(bps, BPS_DECIMAL_PLACE, ETHER_DECIMAL_PLACE);
};

export const changeDecimalUnit = (
  rawDecimalUnitAmount: BigNumber,
  currentDecimals: number,
  desiredDecimals: number,
): BigNumber => {
  if (currentDecimals === desiredDecimals) {
    return rawDecimalUnitAmount;
  }

  if (currentDecimals > desiredDecimals) {
    const exp: BigNumber = BigNumber.from(10).pow(
      currentDecimals - desiredDecimals,
    );
    return rawDecimalUnitAmount.div(exp);
  }

  const exp: BigNumber = BigNumber.from(10).pow(
    desiredDecimals - currentDecimals,
  );
  return rawDecimalUnitAmount.mul(exp);
};

export function compareAddress(address0: string, address1: string): boolean {
  return compareIgnoreCase(address0, address1);
}

export function compareIgnoreCase(str1: string, str2: string): boolean {
  return str1.toLowerCase() === str2.toLowerCase();
}

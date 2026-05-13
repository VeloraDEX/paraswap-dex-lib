import type { RoutePlan, RoutePosition } from './types';
import { getRoutePlanLegCount, routePositionKey } from './route-plan';

const DECIMAL_AMOUNT_PATTERN = /^\d+$/;
const LOWERCASE_ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/;
// Encoded bytes may come from calldata/permit encoders that preserve hex case.
const HEX_BYTES_PATTERN = /^0x(?:[0-9a-fA-F]{2})*$/;

export function isDecimalAmountString(value: unknown): value is string {
  return typeof value === 'string' && DECIMAL_AMOUNT_PATTERN.test(value);
}

export function assertDecimalAmountString(
  value: unknown,
  fieldName = 'amount',
): asserts value is string {
  if (!isDecimalAmountString(value)) {
    throw new Error(`${fieldName} must be a decimal amount string`);
  }
}

export function isLowercaseAddress(value: unknown): value is string {
  return typeof value === 'string' && LOWERCASE_ADDRESS_PATTERN.test(value);
}

export function assertLowercaseAddress(
  value: unknown,
  fieldName = 'address',
): asserts value is string {
  if (!isLowercaseAddress(value)) {
    throw new Error(
      `${fieldName} must be a lowercase 42-character hex address`,
    );
  }
}

export function isHexBytes(value: unknown): value is string {
  return typeof value === 'string' && HEX_BYTES_PATTERN.test(value);
}

export function assertHexBytes(
  value: unknown,
  fieldName = 'bytes',
): asserts value is string {
  if (!isHexBytes(value)) {
    throw new Error(`${fieldName} must be 0x-prefixed hex bytes`);
  }
}

export function findDuplicateResolvedLegKeys(
  resolvedLegs: readonly RoutePosition[],
): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  resolvedLegs.forEach(resolvedLeg => {
    const key = routePositionKey(resolvedLeg);

    if (seen.has(key)) {
      duplicates.add(key);
      return;
    }

    seen.add(key);
  });

  return [...duplicates];
}

export function assertNoDuplicateResolvedLegs(
  resolvedLegs: readonly RoutePosition[],
): void {
  const duplicates = findDuplicateResolvedLegKeys(resolvedLegs);

  if (duplicates.length > 0) {
    throw new Error(
      `duplicate resolved leg route position(s): ${duplicates.join(', ')}`,
    );
  }
}

export function assertRoutePlanLegCount(
  routePlan: RoutePlan,
  resolvedLegsOrCount: readonly RoutePosition[] | number,
): void {
  const expectedLegCount = getRoutePlanLegCount(routePlan);
  const actualLegCount = Array.isArray(resolvedLegsOrCount)
    ? resolvedLegsOrCount.length
    : resolvedLegsOrCount;

  if (actualLegCount !== expectedLegCount) {
    throw new Error(
      `route-plan leg count mismatch: expected ${expectedLegCount}, got ${actualLegCount}`,
    );
  }
}

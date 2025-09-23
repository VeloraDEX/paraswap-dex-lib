import {
  EventFragment,
  Fragment,
  FunctionFragment,
  Interface,
} from '@ethersproject/abi';
import { HooksConfigMap } from './hooks/balancer-hook-event-subscriber';
import { ReClammApiName } from './reClammPool';
import { Step } from './types';

export function getUniqueHookNames(hooksConfigMap: HooksConfigMap): string {
  // Use Object.values to get all HookConfig objects
  // Then map to extract just the names
  // Use Set to get unique names
  // Convert back to array and join with comma
  // ReClamm pool is a special case where the pool is also its own hook. We don't track hook state as its not needed for pricing so its not in config but it does need to be included for API query
  return Array.from(
    new Set([
      ...Object.values(hooksConfigMap).map(hook => hook.apiName),
      ReClammApiName,
    ]),
  ).join(', ');
}

export function combineInterfaces(interfaces: Interface[]): Interface {
  // Use a Map to store unique fragments, keyed by their string representation
  const uniqueFragments = new Map<string, Fragment>();

  interfaces.forEach((interfaceInstance: Interface) => {
    interfaceInstance.fragments.forEach((fragment: Fragment) => {
      let key: string;

      if (fragment instanceof FunctionFragment) {
        // For functions, use the signature as the key
        // This includes name and parameter types
        key = fragment.format();
      } else if (fragment instanceof EventFragment) {
        // For events, use the signature as the key
        key = fragment.format();
      } else {
        // For other fragment types (like errors), use their string representation
        key = fragment.toString();
      }

      // Only add if we haven't seen this signature before
      if (!uniqueFragments.has(key)) {
        uniqueFragments.set(key, fragment);
      }
    });
  });

  // Convert the Map values back to an array
  const dedupedFragments = Array.from(uniqueFragments.values());

  // Create a new interface with the deduped fragments
  return new Interface(dedupedFragments);
}
/**
 * Removes adjacent pairs of buffer steps that form circular swaps.
 * Only removes pairs where both steps have isBuffer=true and
 * first step's tokenIn equals second step's tokenOut.
 *
 * @param steps - Array of sequential swap steps
 * @returns Filtered array with circular buffer pairs removed
 */
export function removeCircularStepPairs(steps: Step[]): Step[] {
  const result: Step[] = [];
  let i = 0;

  while (i < steps.length) {
    const currentStep = steps[i];
    const nextStep = steps[i + 1];

    // Check if current step and next step form a circular pair AND both are buffer steps
    const isCircularPair =
      nextStep !== undefined &&
      currentStep.swapInput.tokenIn === nextStep.swapInput.tokenOut &&
      currentStep.isBuffer &&
      nextStep.isBuffer;

    if (isCircularPair) {
      // Skip both steps (they cancel each other out)
      i += 2;
    } else {
      // Keep this step
      result.push(currentStep);
      i += 1;
    }
  }

  return result;
}

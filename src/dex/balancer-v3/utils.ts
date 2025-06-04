import { HooksConfigMap } from './hooks/balancer-hook-event-subscriber';
import { ReClammApiName } from './reClammPool';

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

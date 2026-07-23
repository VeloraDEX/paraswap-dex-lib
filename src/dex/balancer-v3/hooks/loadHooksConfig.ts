import { BalancerV3Config } from './../config';
import { HooksConfigMap, HookConfig } from './balancer-hook-event-subscriber';

export function loadHooksConfig(network: number): HooksConfigMap {
  const hooks = BalancerV3Config.BalancerV3[network].hooks;

  if (!hooks) return {};

  // Group hooks by hookAddress to support multiple factories with the same hook address
  const grouped = hooks.reduce((acc, hook) => {
    const key = hook.hookAddress.toLowerCase();
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(hook);
    return acc;
  }, {} as Record<string, HookConfig[]>);

  return grouped;
}

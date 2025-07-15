import { BalancerV3Config } from './../config';
import { HooksConfigMap } from './balancer-hook-event-subscriber';

export function loadHooksConfig(network: number): HooksConfigMap {
  const hooks = BalancerV3Config.BalancerV3[network].hooks;

  if (!hooks) return {};

  return Object.fromEntries(
    hooks.map(hook => [hook.address.toLowerCase(), hook]),
  );
}

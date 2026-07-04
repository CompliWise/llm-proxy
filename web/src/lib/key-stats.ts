import type { RateLimitConfig, RateLimitsResponse } from "../types";
import { redactedRateLimitScopeForKey } from "./key-routes";

export function rateLimitScopeForKey(key: string): string {
  return `key:${key}`;
}

function counterForKeyScope(
  data: RateLimitsResponse | undefined,
  window: "day" | "minute",
  key: string
) {
  const counters = data?.snapshot?.[window]?.counters;
  if (!counters) {
    return;
  }
  return (
    counters[rateLimitScopeForKey(key)] ??
    counters[redactedRateLimitScopeForKey(key)]
  );
}

export function rateLimitUsageForKey(
  data: RateLimitsResponse | undefined,
  key: string
): { window: "day" | "minute"; requests: number; tokens: number }[] {
  return (["day", "minute"] as const)
    .map((window) => {
      const counter = counterForKeyScope(data, window, key);
      return {
        window,
        requests: counter?.requests ?? 0,
        tokens: counter?.tokens ?? 0,
      };
    })
    .filter((row) => row.requests > 0 || row.tokens > 0);
}

export function rateLimitOverrideForKey(
  data: RateLimitsResponse | undefined,
  key: string
): RateLimitConfig | undefined {
  const perKey = data?.overrides?.PerKey;
  if (!perKey) {
    return;
  }
  return perKey[key] ?? perKey[redactedRateLimitScopeForKey(key)];
}

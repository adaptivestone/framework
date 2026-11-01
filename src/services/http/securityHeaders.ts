import type ThttpConfig from '../../config/http.ts';

type HttpConfig = typeof ThttpConfig;

/**
 * The headers every response starts with (`http.securityHeaders`). An adapter
 * sets them before any middleware runs, so every response path — routes, the
 * 404 and 405, error responses — carries them, and a route can still override
 * or remove one. The list is computed once; the returned function re-reads
 * `enabled` on each call, so it can be toggled through config without a reboot.
 */
export function securityHeaders(
  getConfig: () => HttpConfig,
): () => ReadonlyArray<readonly [string, string]> {
  const entries = Object.entries(getConfig().securityHeaders ?? {}).filter(
    (entry): entry is [string, string] =>
      entry[0] !== 'enabled' && typeof entry[1] === 'string',
  );
  return () => (getConfig().securityHeaders?.enabled ? entries : []);
}

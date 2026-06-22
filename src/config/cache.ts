export default {
  /**
   * Cache backend.
   * - `'memory'` (default) — per-process `Map`; needs no external service, so a
   *   plain install never loads `@redis/client`.
   * - `'redis'` — shared/multi-node cache; lazy-loads `@redis/client` (an
   *   optional peer dependency — install it to use this driver).
   *
   * Override per environment via `CACHE_DRIVER`. The cache key namespace is
   * shared with the rate limiter and lives in `config/redis.ts` (`namespace`).
   */
  driver: (process.env.CACHE_DRIVER || 'memory') as 'memory' | 'redis',
};

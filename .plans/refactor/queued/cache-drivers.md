# P1c — Cache drivers

**Status**: ⏸ deferred to v5.1
**Depends on**: P0
**Unblocks**: P2a (caches `getUserByToken`)
**Time**: 1 day
**Parallelizable with**: P1a-runtime, P1a-codegen, P1b

## Goal

Split `Cache.ts` into a driver interface + first-party Memory and Redis drivers, with **Memory as the default** so redis becomes optional. Resolves issues #13 and #10 (zero TTL skip).

**Decision (2026-06-21): redis must not be a required dependency.** Today `Cache.#init()` eagerly `await getRedisClient()` in its constructor, so an app **connects to redis at boot** whether or not it uses cache — that's what makes redis "required." A Memory-default driver removes that eager connection; the redis driver connects lazily, only when configured.

## Files touched

- `src/services/cache/CacheDriver.ts` (new) — interface: `get`, `set`, `del`, `has`, optionally `ping`.
- `src/services/cache/drivers/MemoryDriver.ts` (new) — default. `Map`-backed with TTL via setTimeout.
- `src/services/cache/drivers/RedisDriver.ts` (new) — lazy-imports `@redis/client` only when constructed.
- `src/services/cache/Cache.ts` — orchestrator; namespace handling; `promiseMapping` dedup; JSON-with-bigint serialization. Driver injected via constructor or config.
- `src/config/cache.ts` (new) — `{ driver: 'memory' | 'redis' | CacheDriver, namespace: string, defaultTtlSeconds: number }`. Currently `Cache.ts` reads from `config('redis')` for namespace; that moves here.
- `src/helpers/redis/redisConnection.ts` — kept, but reached **only** via dynamic import from `RedisDriver` (no static importer, so `@redis/client` loads only on the redis path). `Cache.ts` must drop its current static `import { getRedisClient }`.
- `src/config/redis.ts` — kept; only consumed by `RedisDriver`.
- `package.json` — `@redis/client` from `dependencies` to `peerDependenciesMeta` as optional. **Shared flip with [rate-limiter-lazy](./rate-limiter-lazy.md)** — only land it once RateLimiter also lazy-loads redis, otherwise importing RateLimiter still forces the package.

## API change

```ts
// Before — Cache.ts:21-30
async #init() {
  const { namespace } = this.app.getConfig('redis');
  this.redisClient = await getRedisClient();   // hard-imports redis
  this.redisNamespace = namespace;
}

// After — driver injection
class Cache extends Base {
  driver: CacheDriver;
  constructor(app: IApp) {
    super(app);
    const { driver } = app.getConfig('cache');   // 'memory' | 'redis' | CacheDriver instance
    this.driver = resolveDriver(driver);          // lazy-imports redis only if 'redis'
  }
}

// New: zero-TTL short-circuit (issue #10)
async getSetValue(key, onNotFound, storeTime = 60 * 5) {
  if (storeTime === 0) return onNotFound();   // skip cache entirely
  // ...
}
```

## Test plan

- ☐ Existing `Cache.test.ts` passes against both drivers.
- ☐ `MemoryDriver` parity test: same `getSetValue` semantics as `RedisDriver`.
- ☐ Zero-TTL test: `await cache.getSetValue('k', fn, 0)` calls `fn` twice on two consecutive calls (no cache).
- ☐ `npm uninstall @redis/client && app.getConfig('cache') = { driver: 'memory' }` boots without import error.
- ☐ `grep "from '@redis/client'" src/services/cache/Cache.ts` returns zero matches.

## Out of scope

- Caching `getUserByToken` (issue #14 — that's P2a).
- LRU eviction in MemoryDriver (basic Map+TTL is enough).
- Distributed-cache invalidation patterns.
- Per-key compression, etc.

## Done when

Both drivers pass parity tests; zero-TTL test passes; redis is optional.

## Notes

- `MemoryDriver` is per-process — fine for development and single-node deployments. Multi-node setups need redis.
- The `promiseMapping` dedup logic stays in `Cache.ts` (orchestrator), not in drivers — it's a cross-driver concern.
- The `@redis/client` optional-peer goal is shared with [rate-limiter-lazy](./rate-limiter-lazy.md); both must lazy-load redis before the `package.json` flip is safe. `clearNamespace.ts` and `setupVitest.ts` use redis directly but are test-only — redis can stay a `devDependency`.

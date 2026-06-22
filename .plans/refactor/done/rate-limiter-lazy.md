# P1b-extras — RateLimiter: lazy redis (make redis optional)

**Status**: ✅ shipped 2026-06-22 (v5.1, Unreleased) — landed together with [cache-drivers](./cache-drivers.md)
**Depends on**: P1b ✅
**Coordinates with**: [cache-drivers](./cache-drivers.md) (P1c) — the `@redis/client` → optional-peer flip is **shared** and can only land once both this and P1c lazy-load redis.
**Decision (2026-06-21)**: redis must **not** be a required dependency. The RateLimiter half: only the redis *driver* may touch `@redis/client`; the memory (default) and mongo drivers must not.

## Shipped

- `RateLimiter.ts` dropped the top-level `getRedisClientSync` import. The `redis` branch now `await import('redisConnection')` inside an async `initRedisLimiter()` and assigns `this.limiter`; the limiter build is deferred behind a new `whenReady` promise (already-resolved for memory/mongo). `middleware()` `await this.whenReady` before its `!this.limiter` check.
- **Non-blocking by design:** the redis path uses `getRedisClientSync()` (returns immediately, connects in the background) — NOT `await getRedisClient()`, which hangs when redis is down (node-redis retries with backoff). A down redis is absorbed by the existing memory `insuranceLimiter`; an init failure (e.g. `@redis/client` not installed) leaves `this.limiter` undefined → 500, same as an unknown driver.
- `@redis/client` → optional peer + devDependency (shared flip with cache-drivers).
- `setupFramework.ts` made its `createClient` import lazy too (dynamic in `clearTestRedisNamespace`), so a memory-only consumer using the shipped test setup never loads redis.
- Tests: `RateLimiter.test.ts` redis cases `await whenReady` before touching `.limiter`; all three drivers + store-failure paths green.

## Goal

Make `@redis/client` load only when RateLimiter is actually configured with the **redis** driver. Today `RateLimiter.ts` statically imports `getRedisClientSync` (→ `redisConnection.ts` → `@redis/client`), so merely using RateLimiter on *any* driver pulls redis into the import graph.

Scope correction from the earlier draft:
- **Not** about `rate-limiter-flexible` — it ships all backends in one package, and the framework's own `Auth` controller uses it (`Auth.ts` → `['/{*splat}', [GetUserByToken, RateLimiter]]`), so it can't be optional.
- **Not** about `mongoose` — a required core dep (Mongo is required in v5).
- The "build the limiter once" worry is **already satisfied**: the constructor builds `this.limiter` and `middleware()` reuses it. No change needed there.

## Files touched

- `src/services/http/middleware/RateLimiter.ts` — drop the top-level `getRedisClientSync` import; the `redis` branch dynamic-imports `redisConnection.ts` (and thus `@redis/client`) only when `driver === 'redis'`. memory/mongo branches untouched. Since the redis client must exist before the limiter is built, move the redis path to a deferred-init (`whenReady`) like `Cache.ts`, and `await this.whenReady` at the top of `middleware()` (resolves after the first request; ~zero overhead thereafter).
- *(shared with P1c)* `package.json` — `@redis/client` → `peerDependenciesMeta` optional. **Flip only once BOTH this and P1c lazy-load redis**, else importing `Cache` or `RateLimiter` still forces the package.
- *(shared with P1c)* `src/helpers/redis/redisConnection.ts` — must be reachable **only** via dynamic import from a redis code path. After P1c + this land, confirm no static importer remains (`grep -rn "from '.*redisConnection'" src` → only dynamic `import()`).

## Test plan

- ☐ memory driver (default): with `@redis/client` uninstalled in a sandbox, constructing + using RateLimiter doesn't throw and never loads redis.
- ☐ redis driver: limiter still builds (deferred) and rate-limits correctly; built once, reused across requests.
- ☐ `grep -E "getRedisClientSync|@redis/client" src/services/http/middleware/RateLimiter.ts` → no top-level match.
- ☐ `RateLimiter.test.ts` green (all three backends).

## Out of scope

- Making `rate-limiter-flexible` optional (see scope correction).
- mongoose optional (required core dep).
- New rate-limiting features.

## Done when

RateLimiter on memory/mongo loads no redis; the redis driver lazy-loads it; the shared `@redis/client` optional-peer flip lands together with P1c, and a memory-only app boots with `@redis/client` uninstalled.

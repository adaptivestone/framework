# P1b-extras — RateLimiter lazy-init

**Status**: ⏸ deferred to v5.1
**Depends on**: P1b
**Unblocks**: nothing (terminal small task)
**Time**: ~1 day (was ½ — bumped after design fix)

## Goal

`rate-limiter-flexible` and (for the mongo backend) `mongoose` become optional — only loaded when their respective backend is configured. The limiter itself is built **once** at construction time using a `whenReady` deferred-init pattern (mirrors `Cache.ts`'s existing approach), so per-request rate-limiting state survives across requests.

## Files touched

- `src/services/http/middleware/RateLimiter.ts` — switch to deferred-init: constructor stays sync, kicks off `#init()`, exposes `whenReady: Promise<void>`. The `middleware()` method awaits `this.whenReady` before calling `this.limiter.consume(...)`. Imports for `rate-limiter-flexible` and `mongoose` move into `#init()`. The three backends (memory/redis/mongo — see `RateLimiter.ts:36-58`) all dispatch through `#init()`.
- `package.json` — `rate-limiter-flexible` from `dependencies` to `peerDependenciesMeta` as optional. `mongoose` stays as a `dependencies` entry (it's used by the framework for models), but the *RateLimiter*'s mongoose import is removed from the module top.

## API change

```ts
// Before — top-level imports + sync constructor
import mongoose from 'mongoose';
import { RateLimiterMemory, RateLimiterMongo, RateLimiterRedis } from 'rate-limiter-flexible';

class RateLimiter extends AbstractMiddleware {
  limiter!: RateLimiterAbstract;
  constructor(app, params) {
    super(app, params);
    // ... switch on driver, build limiter sync
    this.limiter = new RateLimiterMemory(...);
  }
}

// After — whenReady pattern
class RateLimiter extends AbstractMiddleware {
  limiter!: RateLimiterAbstract;
  whenReady: Promise<void>;

  constructor(app, params) {
    super(app, params);
    this.finalOptions = /* same as today */;
    this.whenReady = this.#init();
  }

  async #init() {
    const rlModule = await import('rate-limiter-flexible');
    switch (this.finalOptions.driver) {
      case 'memory':
        this.limiter = new rlModule.RateLimiterMemory(this.finalOptions.limiterOptions);
        break;
      case 'redis': {
        const { getRedisClientSync } = await import('../../../helpers/redis/redisConnection.ts');
        this.limiter = new rlModule.RateLimiterRedis({
          storeClient: getRedisClientSync(),
          useRedisPackage: true,
          ...this.finalOptions.limiterOptions,
        });
        break;
      }
      case 'mongo': {
        const { default: mongoose } = await import('mongoose');
        this.limiter = new rlModule.RateLimiterMongo({
          storeClient: mongoose.connection,
          disableIndexesCreation: process.env.TEST === 'true',
          ...this.finalOptions.limiterOptions,
        });
        break;
      }
      default:
        this.logger?.error(`Unknown driver ${this.finalOptions.driver}`);
    }
  }

  async middleware(req, res, next) {
    await this.whenReady;        // ← critical: ensures limiter is built once, reused per request
    // ...existing consume logic against this.limiter
  }
}
```

## Test plan

- ☐ `grep -E "^import.*'(rate-limiter-flexible|mongoose)'" src/services/http/middleware/RateLimiter.ts` returns zero matches (top-level imports gone).
- ☐ Existing `RateLimiter` tests pass — *the same `RateLimiter` instance* handles 100 sequential requests; per-key consumption counter increments correctly (proves the limiter isn't re-instantiated per request).
- ☐ Concurrency test: fire 50 parallel requests in the same Promise.all; all share the same limiter (assert `instance.limiter` is referentially identical at request 1 and request 50).
- ☐ Boot test: when `config.rateLimiter.driver === 'memory'`, `npm uninstall @redis/client && npm uninstall mongoose` (in a sandbox) followed by booting RateLimiter doesn't throw. Repeat for `redis` driver with mongoose uninstalled, etc.
- ☐ `vitest run RateLimiter.test.ts` green.

## Out of scope

- New rate-limiting features.
- Custom per-route rate limits (defer to Phase 5+ if at all).
- Replacing `rate-limiter-flexible` with an in-house implementation.

## Done when

Top-level imports gone; the limiter is built once and reused; tests for all three backends pass; uninstall tests prove peer-optional.

## Notes

- The `whenReady` pattern mirrors `Cache.ts:8,18` (existing). Reuse the same convention name (`whenReady`) so the codebase stays consistent.
- The middleware body's `await this.whenReady` only blocks on the first request; all subsequent requests skip past the already-resolved promise (zero meaningful overhead).
- This bullet was originally in P1c (cache drivers) but `RateLimiter` is HTTP middleware, so it lives here. Cross-phase reference only.

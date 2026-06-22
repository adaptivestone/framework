import type cacheConfig from '../../config/cache.ts';
import type redisConfig from '../../config/redis.ts';
import Base from '../../modules/Base.ts';
import type { IApp } from '../../server.ts';
import type { CacheDriver } from './CacheDriver.ts';
import MemoryDriver from './drivers/MemoryDriver.ts';
import RedisDriver from './drivers/RedisDriver.ts';

/**
 * Resolve the configured driver. A `CacheDriver` instance may be injected
 * directly (escape hatch / tests); `'redis'` constructs the lazy redis driver
 * (the only path that loads `@redis/client`); anything else → memory default.
 */
function resolveDriver(driver: unknown): CacheDriver {
  if (driver && typeof driver === 'object') {
    return driver as CacheDriver;
  }
  if (driver === 'redis') {
    return new RedisDriver();
  }
  return new MemoryDriver();
}

class Cache extends Base {
  whenReady: Promise<void>;

  driver: CacheDriver;

  namespace = '';

  promiseMapping = new Map();

  constructor(app: IApp) {
    super(app);
    const { driver } = this.app.getConfig('cache') as typeof cacheConfig;
    // The namespace stays in `config('redis')`: it prefixes every cache AND
    // rate-limiter key regardless of driver, so the two services share one knob
    // (the test helpers' `setTestRedisNamespace` flips both at once).
    const { namespace } = this.app.getConfig('redis') as typeof redisConfig;
    this.namespace = namespace;
    this.driver = resolveDriver(driver);
    this.whenReady = this.driver.whenReady ?? Promise.resolve();
  }

  /**
   * As framework support namespaces all key for cache go through this function
   * Function return new key with added namespace
   * @param key key to add namespace
   */
  getKeyWithNameSpace(key: string) {
    return `${this.namespace}-${key}`;
  }

  /**
   * Get value from cache. Set and get if not eists
   * @param key key to check
   * @param onNotFound callback that will be executed if value not found on cahce
   * @param storeTime how long we should store value on cache
   */
  async getSetValue<T = unknown>(
    keyValue: string,
    onNotFound: () => Promise<T>,
    storeTime = 60 * 5,
  ) {
    // A zero TTL means "don't cache" (issue #10): recompute every call. Short
    // circuit before touching the driver or the in-flight map so a `0` can never
    // write a never-expiring entry.
    if (storeTime === 0) {
      return onNotFound();
    }
    await this.whenReady;
    const key = this.getKeyWithNameSpace(keyValue);
    // 5 mins default
    let resolve = (_value: unknown) => {};
    let reject = (_value: unknown) => {};
    if (this.promiseMapping.has(key)) {
      return this.promiseMapping.get(key);
    }

    const inflight = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    // Concurrent waiters get any rejection via their own `await`; this no-op
    // handler prevents a zero-waiter `unhandledRejection` when `reject` fires.
    inflight.catch(() => {});
    this.promiseMapping.set(key, inflight);

    // One try/finally so the mapping entry ALWAYS settles and clears — a driver
    // failure mid-flight must not leave a forever-pending entry (per-key deadlock
    // that would survive a backend recovery).
    try {
      let parsedResult: T | undefined;

      // A cache outage is NOT a request outage: if the driver read throws,
      // degrade to computing the value via `onNotFound` every call (slow, not
      // broken) rather than failing. Only `onNotFound`'s own errors propagate.
      let cached: string | null = null;
      let cacheUsable = true;
      try {
        cached = await this.driver.get(key);
      } catch (e) {
        cacheUsable = false;
        this.logger?.error(
          `Cache read failed for key '${key}', falling back to onNotFound: ${e}`,
        );
      }

      let cacheHit = false;
      if (cached) {
        try {
          parsedResult = JSON.parse(cached, (_jsonkey, value) => {
            if (typeof value === 'string' && /^\d+n$/.test(value)) {
              return BigInt(value.slice(0, value.length - 1));
            }
            return value;
          });
          cacheHit = true;
          this.logger?.verbose(
            `getSetValueFromCache FROM CACHE key ${key}, value ${cached.substring(
              0,
              100,
            )}`,
          );
        } catch {
          // This class only ever stores `JSON.stringify` output, so a value that
          // won't parse is genuine corruption. Treat it as a miss — recompute
          // and overwrite — rather than returning `undefined` to the caller.
          this.logger?.warn(
            `Corrupt cache value for key '${key}' — recomputing and overwriting`,
          );
        }
      }

      if (!cacheHit) {
        this.logger?.verbose(`getSetValueFromCache not found for key ${key}`);
        parsedResult = await onNotFound();

        const serialized = JSON.stringify(parsedResult, (_jsonkey, value) =>
          typeof value === 'bigint' ? `${value}n` : value,
        );
        // Skip the write when the cache is unreachable, or the value serializes
        // to `undefined` (which the redis client rejects). The write is
        // best-effort: the value is already computed, so a failed write — like a
        // failed read — must not fail the call.
        if (cacheUsable && serialized !== undefined) {
          await this.driver
            .set(key, serialized, storeTime)
            .catch((e) =>
              this.logger?.error(`Cache set failed for key '${key}': ${e}`),
            );
        }
      }

      resolve(parsedResult);
      return parsedResult;
    } catch (e) {
      this.logger?.error(`Cache getSetValue for key '${key}' error: ${e}`);
      reject(e);
      throw e;
    } finally {
      this.promiseMapping.delete(key);
    }
  }

  /**
   * Remove key from cache
   * @param key key to remove
   */
  async removeKey(keyValue: string) {
    await this.whenReady;

    const key = this.getKeyWithNameSpace(keyValue);
    // Fail-soft like the read/write paths: a backend blip during invalidation
    // must not throw into business logic.
    try {
      return await this.driver.del(key);
    } catch (e) {
      this.logger?.error(`Cache removeKey failed for key '${key}': ${e}`);
      return 0;
    }
  }

  static get loggerGroup() {
    return 'Cache_';
  }
}

export default Cache;

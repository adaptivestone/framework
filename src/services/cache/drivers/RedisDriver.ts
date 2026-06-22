import type { RedisClientType } from '@redis/client';
import type { CacheDriver } from '../CacheDriver.ts';

/**
 * Redis cache driver. Lazy-imports the redis connection helper (and thus
 * `@redis/client`) inside `#init`, so the package only loads when this driver is
 * constructed — i.e. only when `config('cache').driver === 'redis'`. Memory-only
 * apps never touch it, which keeps `@redis/client` an optional dependency. (The
 * `import type` above is erased at compile time and loads nothing at runtime.)
 *
 * Every call resolves the live client through the shared helper rather than
 * caching it: after a shutdown/reconnect the helper rebuilds the client, and its
 * single-flight connect avoids the "Socket already opened" race two concurrent
 * callers hit otherwise.
 */
class RedisDriver implements CacheDriver {
  whenReady: Promise<void>;

  #getRedisClient!: () => Promise<RedisClientType>;

  constructor() {
    this.whenReady = this.#init();
  }

  async #init(): Promise<void> {
    // Only the dynamic import is awaited — not a connect. `getRedisClient`
    // connects (single-flight) on first use; awaiting a connect here would hang
    // when redis is down (node-redis retries with backoff), and the Cache
    // orchestrator already degrades fail-soft if the backend is unreachable.
    const { getRedisClient } = await import(
      '../../../helpers/redis/redisConnection.ts'
    );
    this.#getRedisClient = getRedisClient;
  }

  async get(key: string): Promise<string | null> {
    await this.whenReady;
    const client = await this.#getRedisClient();
    return client.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.whenReady;
    const client = await this.#getRedisClient();
    await client.set(key, value, { EX: ttlSeconds });
  }

  async del(key: string): Promise<number> {
    await this.whenReady;
    const client = await this.#getRedisClient();
    return client.del(key);
  }
}

export default RedisDriver;

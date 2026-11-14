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

  #getRedisClientSync!: () => RedisClientType;

  constructor() {
    this.whenReady = this.#init();
  }

  async #init(): Promise<void> {
    // Connect in the background; node-redis retries indefinitely when down.
    const { getRedisClientSync } = await import(
      '../../../helpers/redis/redisConnection.ts'
    );
    this.#getRedisClientSync = getRedisClientSync;
  }

  #readyClient(): RedisClientType {
    const client = this.#getRedisClientSync();
    if (!client.isReady) {
      throw new Error('Redis cache is not ready');
    }
    return client;
  }

  async get(key: string): Promise<string | null> {
    await this.whenReady;
    const client = this.#readyClient();
    return client.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.whenReady;
    const client = this.#readyClient();
    await client.set(key, value, { PX: Math.ceil(ttlSeconds * 1000) });
  }

  async del(key: string): Promise<number> {
    await this.whenReady;
    const client = this.#readyClient();
    return client.del(key);
  }
}

export default RedisDriver;

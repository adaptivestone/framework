import type { RedisClientType } from '@redis/client';
import type redisConfig from '../../config/redis.ts';
import { getRedisClient } from '../../helpers/redis/redisConnection.ts';
import Base from '../../modules/Base.ts';
import type { IApp } from '../../server.ts';

class Cache extends Base {
  whenReady: Promise<void>;

  redisClient!: RedisClientType;

  redisNamespace: string = '';

  promiseMapping = new Map();

  constructor(app: IApp) {
    super(app);
    this.whenReady = this.#init();
  }

  async #init() {
    // todo for now only redis. refactor for drives support in future
    // at least memory and redis drivers should be presented
    // memory drives should works on master process level
    // we should support multiple cashe same time
    const { namespace } = this.app.getConfig('redis') as typeof redisConfig;
    this.redisClient = await getRedisClient();

    this.redisNamespace = namespace;
  }

  /**
   * As framework support namespaces all key for cache go through this function
   * Function return new key with added namespace
   * @param key key to add namespace
   */
  getKeyWithNameSpace(key: string) {
    return `${this.redisNamespace}-${key}`;
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
    await this.whenReady;
    if (!this.redisClient.isOpen) {
      await this.redisClient.connect();
    }
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

    // One try/finally so the mapping entry ALWAYS settles and clears — a redis
    // failure mid-flight must not leave a forever-pending entry (per-key deadlock
    // that would survive redis recovery).
    try {
      let parsedResult: T | undefined;
      const cached = await this.redisClient.get(key);
      if (!cached) {
        this.logger?.verbose(`getSetValueFromCache not found for key ${key}`);
        parsedResult = await onNotFound();

        const serialized = JSON.stringify(parsedResult, (_jsonkey, value) =>
          typeof value === 'bigint' ? `${value}n` : value,
        );
        // `undefined` results serialize to `undefined`, which the redis client
        // rejects — skip the write. The cache write is best-effort either way:
        // the value is already computed, so a failed write must not fail the call.
        if (serialized !== undefined) {
          await this.redisClient
            .set(key, serialized, { EX: storeTime })
            .catch((e) =>
              this.logger?.error(`Cache set failed for key '${key}': ${e}`),
            );
        }
      } else {
        this.logger?.verbose(
          `getSetValueFromCache FROM CACHE key ${key}, value ${cached.substring(
            0,
            100,
          )}`,
        );
        try {
          parsedResult = JSON.parse(cached, (_jsonkey, value) => {
            if (typeof value === 'string' && /^\d+n$/.test(value)) {
              return BigInt(value.slice(0, value.length - 1));
            }
            return value;
          });
        } catch {
          this.logger?.warn(
            'Not able to parse json from redis cache. That can be a normal in case you store string here',
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

    if (!this.redisClient.isOpen) {
      await this.redisClient.connect();
    }
    const key = this.getKeyWithNameSpace(keyValue);
    return this.redisClient.del(key);
  }

  static get loggerGroup() {
    return 'Cache_';
  }
}

export default Cache;

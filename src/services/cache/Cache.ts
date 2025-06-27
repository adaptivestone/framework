import type { RedisClientType } from '@redis/client';
import type redisConfig from '../../config/redis.ts';
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
    const { createClient } = await import('@redis/client');
    const conf = this.app.getConfig('redis') as typeof redisConfig;
    this.redisClient = createClient({
      url: conf.url,
    });

    this.redisNamespace = conf.namespace;

    this.redisClient.on('error', (error, b, c) => {
      this.logger?.error(error, b, c);
    });
    this.redisClient.on('connect', () => {
      this.logger?.info('Redis connection success');
    });
    this.app.events.on('shutdown', () => {
      this.redisClient.quit();
    });
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
  async getSetValue(
    keyValue: string,
    onNotFound: () => Promise<any>,
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

    this.promiseMapping.set(
      key,
      new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      }),
    );

    let result = await this.redisClient.get(key);
    if (!result) {
      this.logger?.verbose(`getSetValueFromCache not found for key ${key}`);
      try {
        result = await onNotFound();
      } catch (e) {
        this.logger?.error(`Cache onNotFound for key '${key}' error: ${e}`);
        this.promiseMapping.delete(key);
        reject(e);
        return Promise.reject(e);
      }

      this.redisClient.set(
        key,
        JSON.stringify(result, (_jsonkey, value) =>
          typeof value === 'bigint' ? `${value}n` : value,
        ),
        {
          EX: storeTime,
        },
      );
    } else {
      this.logger?.verbose(
        `getSetValueFromCache FROM CACHE key ${key}, value ${result.substring(
          0,
          100,
        )}`,
      );
      try {
        result = JSON.parse(result, (_jsonkey, value) => {
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

    resolve(result);
    this.promiseMapping.delete(key);
    return result;
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

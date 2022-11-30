const redis = require('redis');
const Base = require('../../modules/Base');

class Cache extends Base {
  constructor(app) {
    // todo for now only redis. refactor for drives support in future
    // at least memory and redis drivers should be presented
    // memory drives should works on master process level
    // we should support multiple cashe same time
    super(app);
    const conf = this.app.getConfig('redis');
    this.redisClient = redis.createClient({
      url: conf.url,
    });

    this.redisNamespace = conf.namespace;

    this.redisClient.on('error', (error, b, c) => {
      this.logger.error(error, b, c);
    });
    this.redisClient.on('connect', () => {
      this.logger.info('Redis connection success');
    });
    this.app.events.on('shutdown', () => {
      this.redisClient.quit();
    });

    this.promiseMapping = new Map();
  }

  getKeyWithNameSpace(key) {
    return `${this.redisNamespace}-${key}`;
  }

  async getSetValue(keyValue, onNotFound, storeTime = 60 * 5) {
    if (!this.redisClient.isOpen) {
      await this.redisClient.connect();
    }
    const key = this.getKeyWithNameSpace(keyValue);
    // 5 mins default
    let resolve = null;
    let reject = null;
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
      this.logger.verbose(`getSetValueFromCache not found for key ${key}`);
      try {
        result = await onNotFound();
      } catch (e) {
        this.logger.error(
          `Cache onNotFound for key '${key}' error: ${e.message}`,
        );
        this.promiseMapping.delete(key);
        reject(e);
        return Promise.reject(e);
      }

      this.redisClient.setEx(key, storeTime, JSON.stringify(result));
    } else {
      this.logger.verbose(
        `getSetValueFromCache FROM CACHE key ${key}, value ${result}`,
      );
      try {
        result = JSON.parse(result);
      } catch (e) {
        this.logger.warn(
          'Not able to parse json from redis cache. That can be a normal in case you store string here',
        );
      }
    }

    resolve(result);
    this.promiseMapping.delete(key);
    return result;
  }

  async removeKey(keyValue) {
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

module.exports = Cache;

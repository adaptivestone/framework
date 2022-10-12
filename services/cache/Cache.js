const redis = require('redis');
const { promisify } = require('util');
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
      legacyMode: true,
    });

    (async () => {
      await this.redisClient.connect();
    })();

    this.redisNamespace = conf.namespace;

    this.redisClient.on('error', (error, b, c) => {
      this.logger.error(error, b, c);
    });
    this.redisClient.on('connect', () => {
      this.logger.info('Redis connection success');
    });
    // this.app.events.on('shutdown', async () => {
    //   this.redisClient.quit();
    // });
    this.redisGetAsync = promisify(this.redisClient.get).bind(this.redisClient);
    this.promiseMapping = new Map();
  }

  async getSetValue(keyValue, onNotFound, storeTime = 60 * 5) {
    const key = `${this.redisNamespace}${keyValue}`;
    // 5 mins default
    let resolve = null;
    if (this.promiseMapping.has(key)) {
      return this.promiseMapping.get(key);
    }

    this.promiseMapping.set(
      key,
      new Promise((res) => {
        resolve = res;
      }),
    );

    let result = await this.redisGetAsync(key);
    if (!result) {
      this.logger.verbose(`getSetValueFromCache not found for key ${key}`);
      result = await onNotFound();
      this.redisClient.set(key, JSON.stringify(result), 'EX', storeTime);
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

  static get loggerGroup() {
    return 'Cache_';
  }
}

module.exports = Cache;

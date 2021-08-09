const {
  RateLimiterMemory,
  RateLimiterRedis,
  RateLimiterMongo,
} = require('rate-limiter-flexible');
const merge = require('deepmerge');
const redis = require('redis');
const mongoose = require('mongoose');

const AbstractMiddleware = require('./AbstractMiddleware');

class RateLimiter extends AbstractMiddleware {
  constructor(app, params) {
    super(app);
    const limiterOptions = this.app.getConfig('rateLimiter');
    this.finalOptions = merge(limiterOptions, params);

    this.limiter = null;

    switch (this.finalOptions.driver) {
      case 'memory':
        this.limiter = new RateLimiterMemory(this.finalOptions.limiterOptions);
        break;

      case 'redis':
        this.limiter = this.initRedisLimiter();
        break;

      case 'mongo':
        this.limiter = RateLimiterMongo({
          storeClient: mongoose.connection,
          ...this.finalOptions.limiterOptions,
        });
        break;

      default:
        this.logger.error(
          `Unknwon option for driver ${this.finalOptions.driver}`,
        );
        break;
    }
  }

  initRedisLimiter() {
    const redisConfig = this.app.getConfig('redis');
    const redisClient = redis.createClient(redisConfig.url);
    redisClient.on('error', (error, b, c) => {
      this.logger.error(error, b, c);
    });
    redisClient.on('connect', () => {
      this.logger.info('Redis connection success');
    });

    return new RateLimiterRedis({
      storeClient: redisClient,
      ...this.finalOptions.limiterOptions,
    });
  }

  gerenateConsumeKey(req) {
    const { ip, route, user } = this.finalOptions.consumeKeyComponents;

    const key = [];
    if (ip) {
      key.push(req.ip);
    }
    if (route) {
      key.push(req.originalUrl);
    }
    if (user && req.appInfo?.user) {
      key.push(req.appInfo?.user.id);
    }

    return key.join('_');
  }

  async middleware(req, res, next) {
    if (!this.limiter) {
      this.logger.info(
        `RateLimmiter not inited correclty! Please check init logs `,
      );
    }

    const consumeKey = this.gerenateConsumeKey(req);

    const consumeResult = await this.limiter
      .consume(consumeKey, this.finalOptions.consumePoints)
      .catch(() => {
        this.logger.warn(`Too many requests. Consume key: ${consumeKey}`);
      });

    if (consumeResult) {
      return next();
    }
    return res.status(429).send('Too Many Requests');
  }
}

module.exports = RateLimiter;

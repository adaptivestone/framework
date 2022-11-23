const RateLimiter = require('./RateLimiter');

describe('middlewares methods', () => {
  it('can create redis rateLimiter', async () => {
    expect.assertions(1);

    const redisRateLimiter = new RateLimiter(global.server.app, {
      driver: 'redis',
    });

    expect(redisRateLimiter.limiter).toBeDefined();
  });

  it('can not create rateLimiter with unknown driver', async () => {
    expect.assertions(2);

    const redisRateLimiter = new RateLimiter(global.server.app, {
      driver: 'unknown',
    });

    expect(redisRateLimiter.limiter).toBeNull();
  });

  it('generateConsumeKey works correctly', async () => {
    expect.assertions(1);

    const redisRateLimiter = new RateLimiter(global.server.app, {
      driver: 'redis',
    });

    const res = await redisRateLimiter.gerenateConsumeKey({
      ip: '192.168.0.0',
      appInfo: {
        user: {
          id: 'someId',
        },
      },
    });

    expect(res).toBe('192.168.0.0__someId');
  });
});

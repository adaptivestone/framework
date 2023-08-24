const RateLimiter = require('./RateLimiter');

describe('rate limiter methods', () => {
  it('have description fields', async () => {
    expect.assertions(1);
    const middleware = new RateLimiter(global.server.app, {
      driver: 'redis',
    });
    expect(middleware.constructor.description).toBeDefined();
  });

  it('can create redis rateLimiter', async () => {
    expect.assertions(1);

    const redisRateLimiter = new RateLimiter(global.server.app, {
      driver: 'redis',
    });

    expect(redisRateLimiter.limiter).toBeDefined();
  });

  it('can not create rateLimiter with unknown driver', async () => {
    expect.assertions(1);

    const rateLimiter = new RateLimiter(global.server.app, {
      driver: 'unknown',
    });

    expect(rateLimiter.limiter).toBeNull();
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

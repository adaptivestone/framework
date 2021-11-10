const request = require('supertest');

describe('rate limiter', () => {
  it('test routeMiddleware RateLimiter work correctly', async () => {
    expect.assertions(1);
    const resultsPromise = [];

    for (let i = 0; i < 11; i += 1) {
      resultsPromise.push(
        request(global.server.app.httpServer.express).get('/somecontroller/'),
      );
    }

    const results = await Promise.all(resultsPromise);
    const statuses = results.map((res) => res.status);

    expect(statuses.indexOf(429)).not.toBe(-1);
  });
});

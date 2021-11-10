const request = require('supertest');

describe('middlewares correct works', () => {
  it('RateLimiter on route works correct', async () => {
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

  it('CheckFlag middleware works correctly with other middleware', async () => {
    expect.assertions(1);

    const { status } = await request(global.server.app.httpServer.express)
      .get('/somecontroller/someData')
      .send({
        flag: false,
      });

    expect(status).toBe(400);
  });

  it('Middlware with params works correctly', async () => {
    expect.assertions(1);

    const { status } = await request(global.server.app.httpServer.express)
      .get('/somecontroller/someDataWithPermission')
      .send({
        user: {
          role: 'client',
        },
      });

    expect(status).toBe(403);
  });
});

const request = require('supertest');

describe('middlewares correct works', () => {
  it('rateLimiter on route works correct', async () => {
    expect.assertions(1);
    const resultsPromise = [];

    for (let i = 0; i < 11; i += 1) {
      resultsPromise.push(
        request(global.server.app.httpServer.express).get(
          '/test/somecontroller/',
        ),
      );
    }

    const results = await Promise.all(resultsPromise);
    const statuses = results.map((res) => res.status);

    expect(statuses.indexOf(429)).not.toBe(-1);
  });

  it('checkFlag middleware works correctly with other middleware', async () => {
    expect.assertions(1);

    const { status } = await request(global.server.app.httpServer.express)
      .get('/test/somecontroller/someData')
      .send({
        flag: false,
      });

    expect(status).toBe(400);
  });

  it('middlware with params works correctly', async () => {
    expect.assertions(1);

    const { status } = await request(global.server.app.httpServer.express)
      .get('/test/somecontroller/someDataWithPermission')
      .send({
        user: {
          role: 'client',
        },
      });

    expect(status).toBe(403);
  });

  it('route without middlewares', async () => {
    expect.assertions(1);

    const { status } = await request(global.server.app.httpServer.express)
      .post('/test/somecontroller/postInfo')
      .send({
        name: 'Inform post',
        discription: 'news',
      });

    expect(status).toBe(200);
  });

  it('priority middlewares', async () => {
    expect.assertions(1);

    const { status } = await request(global.server.app.httpServer.express)
      .put('/test/somecontroller/putInfo')
      .send({
        field: 'Test',
        user: {
          role: 'client',
        },
      });

    expect(status).toBe(403);
  });
});

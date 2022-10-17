const request = require('supertest');

// eslint-disable-next-line no-promise-executor-return
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('middlewares correct works', () => {
  it('cache work correctly', async () => {
    expect.assertions(3);
    const key = 'someKey';
    await request(global.server.app.httpServer.express)
      .post('/test/somecontroller/someDataItems')
      .send({
        items: ['Value1', 'Value2', 'Value3'],
        key,
      });

    let items = await global.server.app.cache.getSetValue(
      key,
      () => ['v1', 'v2', 'v3'],
      30,
    );

    expect(items).toStrictEqual(['Value1', 'Value2', 'Value3']);

    await delay(1000);

    items = await global.server.app.cache.getSetValue(
      key,
      () => ['v1', 'v2', 'v3'],
      30,
    );

    expect(items).toStrictEqual(['Value1', 'Value2', 'Value3']);

    await delay(5000);

    items = await global.server.app.cache.getSetValue(
      key,
      () => ['v1', 'v2', 'v3'],
      30,
    );

    expect(items).toStrictEqual(['v1', 'v2', 'v3']);
  });

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

  it('request also can grab query paramaters', async () => {
    expect.assertions(2);

    const { status, body } = await request(global.server.app.httpServer.express)
      .post('/test/somecontroller/postQueryParamaters?name=test')
      .send();

    expect(status).toBe(200);
    expect(body.data.name).toBe('test');
  });

  it('request also can grab query paramaters but body have bigger priority', async () => {
    expect.assertions(2);

    const { status, body } = await request(global.server.app.httpServer.express)
      .post('/test/somecontroller/postQueryParamaters?name=test')
      .send({
        name: 'notATest',
      });

    expect(status).toBe(200);
    expect(body.data.name).toBe('notATest');
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

const request = require('supertest');
const { setTimeout } = require('node:timers/promises');

describe('middlewares correct works', () => {
  beforeAll(async () => {
    const User = global.server.app.getModel('User');
    await User.create({
      email: 'testUser1@gmail.com',
      name: {
        first: 'Artem',
        last: 'Testov',
      },
      roles: ['user'],
      sessionTokens: [{ token: 'testUser1' }],
    });
  });
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

    await setTimeout(1000);

    items = await global.server.app.cache.getSetValue(
      key,
      () => ['v1', 'v2', 'v3'],
      30,
    );

    expect(items).toStrictEqual(['Value1', 'Value2', 'Value3']);

    await setTimeout(5000);

    items = await global.server.app.cache.getSetValue(
      key,
      () => ['v1', 'v2', 'v3'],
      30,
    );

    expect(items).toStrictEqual(['v1', 'v2', 'v3']);
  });

  it('authMiddleware on route works correct (without token)', async () => {
    expect.assertions(1);

    const { status } = await request(global.server.app.httpServer.express)
      .patch('/test/somecontroller/userAvatar')
      .send({
        avatar: 'newAvatar',
      });

    expect(status).toBe(401);
  });

  it('authMiddleware on route works correct (with token)', async () => {
    expect.assertions(2);

    const { body, status } = await request(global.server.app.httpServer.express)
      .patch('/test/somecontroller/userAvatar')
      .set({ Authorization: 'testUser1' })
      .send({
        avatar: 'newAvatar',
      });

    expect(status).toBe(200);
    expect(body.data.updatedUser.avatar).toBe('newAvatar');
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

  it('request can grab query paramaters', async () => {
    expect.assertions(2);

    const { status, body } = await request(global.server.app.httpServer.express)
      .get('/test/somecontroller/grabSomeDataFromQuery?name=123')
      .set({ Authorization: 'testUser1' });

    expect(status).toBe(200);
    expect(body.data.name).toBe('123');
  });

  it('request required query param must be provided', async () => {
    expect.assertions(2);

    const { status, body } = await request(global.server.app.httpServer.express)
      .get('/test/somecontroller/grabSomeDataFromQueryWithRequiredParam')
      .set({ Authorization: 'testUser1' });

    expect(status).toBe(400);
    expect(body?.data?.name).toBeUndefined();
  });

  it('request with provided required query param', async () => {
    expect.assertions(2);

    const { status, body } = await request(global.server.app.httpServer.express)
      .get(
        '/test/somecontroller/grabSomeDataFromQueryWithRequiredParam?name=123',
      )
      .set({ Authorization: 'testUser1' });

    expect(status).toBe(200);
    expect(body.data.name).toBe(123);
  });

  it('request can grab query params from Pagination middleware', async () => {
    expect.assertions(2);

    const { status, body } = await request(global.server.app.httpServer.express)
      .get(
        '/test/somecontroller/grabSomeDataFromQueryWithMiddlewareParams?name=123&page=3&limit=50',
      )
      .set({ Authorization: 'testUser1' });

    expect(status).toBe(200);
    expect(body.data).toStrictEqual({
      name: '123',
      page: 3,
      limit: 50,
    });
  });

  it('request can not grab query paramaters', async () => {
    expect.assertions(2);

    const { status, body } = await request(global.server.app.httpServer.express)
      .post('/test/somecontroller/postQueryParamaters?name=test')
      .send();

    expect(status).toBe(200);
    expect(body?.data?.name).toBeUndefined();
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
      .set({ Authorization: 'testUser1' });

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
        field: 'testField',
      })
      .set({ Authorization: 'testUser1' });

    expect(status).toBe(403);
  });
});

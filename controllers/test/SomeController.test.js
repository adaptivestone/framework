import { beforeAll, describe, it, expect } from 'vitest';

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

  it('authMiddleware on route works correctly (without token)', async () => {
    expect.assertions(1);

    const { status } = await fetch(
      global.server.testingGetUrl('/test/somecontroller/userAvatar'),
      {
        method: 'PATCH',
        headers: {
          'Content-type': 'application/json',
        },
        body: JSON.stringify({
          avatar: 'newAvatar',
        }),
      },
    );

    expect(status).toBe(401);
  });

  it('authMiddleware on route works correctly (with token)', async () => {
    expect.assertions(2);

    const response = await fetch(
      global.server.testingGetUrl('/test/somecontroller/userAvatar'),
      {
        method: 'PATCH',
        headers: {
          'Content-type': 'application/json',
          Authorization: 'testUser1',
        },
        body: JSON.stringify({
          avatar: 'newAvatar',
        }),
      },
    );

    const responseBody = await response.json();

    expect(response.status).toBe(200);
    expect(responseBody.data.updatedUser.avatar).toBe('newAvatar');
  });

  it('rateLimiter on route works correctly', async () => {
    expect.assertions(1);
    const requests = Array.from({ length: 11 }, () =>
      fetch(global.server.testingGetUrl('/test/somecontroller/')),
    );

    const responses = await Promise.all(requests);
    const statusCodes = responses.map((response) => response.status);

    expect(statusCodes).toContain(429);
  });

  it('checkFlag middleware works correctly with other middleware', async () => {
    expect.assertions(1);

    const { status } = await fetch(
      global.server.testingGetUrl('/test/somecontroller/someData?flag=false'),
      {
        headers: {
          'Content-type': 'application/json',
        },
      },
    );

    expect(status).toBe(400);
  });

  it('request can grab query parameters', async () => {
    expect.assertions(2);

    const response = await fetch(
      global.server.testingGetUrl(
        '/test/somecontroller/grabSomeDataFromQuery?name=123',
      ),
      {
        headers: {
          'Content-type': 'application/json',
          Authorization: 'testUser1',
        },
      },
    );

    const responseBody = await response.json();

    expect(response.status).toBe(200);
    expect(responseBody.data.name).toBe('123');
  });

  it('request required query parameter must be provided', async () => {
    expect.assertions(2);

    const response = await fetch(
      global.server.testingGetUrl(
        '/test/somecontroller/grabSomeDataFromQueryWithRequiredParam',
      ),
      {
        headers: {
          'Content-type': 'application/json',
          Authorization: 'testUser1',
        },
      },
    );

    const responseBody = await response.json();

    expect(response.status).toBe(400);
    expect(responseBody?.data?.name).toBeUndefined();
  });

  it('request with provided required query parameter', async () => {
    expect.assertions(2);

    const response = await fetch(
      global.server.testingGetUrl(
        '/test/somecontroller/grabSomeDataFromQueryWithRequiredParam?name=123',
      ),
      {
        headers: {
          'Content-type': 'application/json',
          Authorization: 'testUser1',
        },
      },
    );

    const responseBody = await response.json();

    expect(response.status).toBe(200);
    expect(responseBody.data.name).toBe(123);
  });

  it('request can grab query parameters from Pagination middleware', async () => {
    expect.assertions(4);

    const response = await fetch(
      global.server.testingGetUrl(
        '/test/somecontroller/grabSomeDataFromQueryWithMiddlewareParams?name=123&page=3&limit=50',
      ),
      {
        headers: {
          'Content-type': 'application/json',
          Authorization: 'testUser1',
        },
      },
    );

    const responseBody = await response.json();
    expect(response.status).toBe(200);
    expect(responseBody.data.limit).toBe(50);
    expect(responseBody.data.name).toBe('123');
    expect(responseBody.data.page).toBe(3);
  });

  it('request can not grab query parameters', async () => {
    expect.assertions(2);

    const response = await fetch(
      global.server.testingGetUrl(
        '/test/somecontroller/postQueryParamaters?name=test',
      ),
      {
        method: 'POST',
        headers: {
          'Content-type': 'application/json',
        },
      },
    );

    const responseBody = await response.json();

    expect(response.status).toBe(200);
    expect(responseBody?.data?.name).toBeUndefined();
  });

  it('request also can grab query parameters but body has higher priority', async () => {
    expect.assertions(2);

    const response = await fetch(
      global.server.testingGetUrl(
        '/test/somecontroller/postQueryParamaters?name=test',
      ),
      {
        method: 'POST',
        headers: {
          'Content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'notATest',
        }),
      },
    );

    const responseBody = await response.json();

    expect(response.status).toBe(200);
    expect(responseBody.data.name).toBe('notATest');
  });

  it('middleware with params works correctly', async () => {
    expect.assertions(1);

    const { status } = await fetch(
      global.server.testingGetUrl(
        '/test/somecontroller/someDataWithPermission',
      ),
      {
        headers: {
          'Content-type': 'application/json',
          Authorization: 'testUser1',
        },
      },
    );

    expect(status).toBe(403);
  });

  it('route without middlewares', async () => {
    expect.assertions(1);

    const { status } = await fetch(
      global.server.testingGetUrl('/test/somecontroller/postInfo'),
      {
        method: 'POST',
        headers: {
          'Content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Inform post',
          description: 'news',
        }),
      },
    );

    expect(status).toBe(200);
  });

  it('priority middlewares', async () => {
    expect.assertions(1);

    const { status } = await fetch(
      global.server.testingGetUrl('/test/somecontroller/putInfo'),
      {
        method: 'PUT',
        headers: {
          'Content-type': 'application/json',
          Authorization: 'testUser1',
        },
        body: JSON.stringify({
          field: 'testField',
        }),
      },
    );

    expect(status).toBe(403);
  });
});

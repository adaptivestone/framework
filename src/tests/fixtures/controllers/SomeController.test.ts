import { beforeAll, describe, expect, it } from 'vitest';
import { appInstance } from '../../../helpers/appInstance.ts';
import type { TUser } from '../../../models/User.ts';
import { getTestServerURL } from '../../../tests/testHelpers.ts';
import SomeController from './SomeController.ts';

describe('middlewares correct works', () => {
  beforeAll(async () => {
    // Late registration — the adapter reads the registry live on each
    // request, so adding a controller after `startServer` works as long
    // as it lands before the test fires its first HTTP request.
    appInstance.controllerManager?.registerController(SomeController, 'test');
    const User = appInstance.getModel('User') as unknown as TUser;
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
      getTestServerURL('/test/somecontroller/userAvatar'),
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
      getTestServerURL('/test/somecontroller/userAvatar'),
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
      fetch(getTestServerURL('/test/somecontroller/')),
    );

    const responses = await Promise.all(requests);
    const statusCodes = responses.map((response) => response.status);

    expect(statusCodes).toContain(429);
  });

  it('checkFlag middleware works correctly with other middleware', async () => {
    expect.assertions(1);

    const { status } = await fetch(
      getTestServerURL('/test/somecontroller/someData?flag=false'),
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
      getTestServerURL('/test/somecontroller/grabSomeDataFromQuery?name=123'),
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
      getTestServerURL(
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
      getTestServerURL(
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
      getTestServerURL(
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
      getTestServerURL('/test/somecontroller/postQueryParamaters?name=test'),
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
      getTestServerURL('/test/somecontroller/postQueryParamaters?name=test'),
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
      getTestServerURL('/test/somecontroller/someDataWithPermission'),
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
      getTestServerURL('/test/somecontroller/postInfo'),
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
      getTestServerURL('/test/somecontroller/putInfo'),
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

  describe('content-type request map', () => {
    const path = '/test/somecontroller/contentTypeBody';

    it('dispatches to the application/json schema', async () => {
      expect.assertions(2);
      const res = await fetch(getTestServerURL(path), {
        method: 'POST',
        headers: { 'Content-type': 'application/json' },
        body: JSON.stringify({ anything: true }),
      });
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.data).toEqual({
        via: 'json',
        contentType: 'application/json',
      });
    });

    it('dispatches to the urlencoded schema', async () => {
      expect.assertions(2);
      const res = await fetch(getTestServerURL(path), {
        method: 'POST',
        headers: { 'Content-type': 'application/x-www-form-urlencoded' },
        body: 'anything=1',
      });
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.data).toEqual({
        via: 'form',
        contentType: 'application/x-www-form-urlencoded',
      });
    });

    it('returns 415 for an unsupported Content-Type', async () => {
      expect.assertions(1);
      const res = await fetch(getTestServerURL(path), {
        method: 'POST',
        headers: { 'Content-type': 'application/octet-stream' },
        body: 'rawbytes',
      });
      expect(res.status).toBe(415);
    });

    it('matches the Content-Type case-insensitively', async () => {
      expect.assertions(2);
      const res = await fetch(getTestServerURL(path), {
        method: 'POST',
        headers: { 'Content-type': 'APPLICATION/JSON' },
        body: JSON.stringify({ anything: true }),
      });
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.data).toEqual({
        via: 'json',
        contentType: 'application/json',
      });
    });

    it('does not accept or leak internals for prototype-chain Content-Types', async () => {
      expect.assertions(4);
      // `constructor` / `__proto__` resolve to truthy `Object.prototype`
      // members on a plain-object map; the null-prototype lookup must reject
      // them (never 200) and never leak the internal "no driver" message.
      for (const ct of ['constructor', '__proto__']) {
        const res = await fetch(getTestServerURL(path), {
          method: 'POST',
          headers: { 'Content-type': ct },
          body: 'x',
        });
        const text = await res.text();
        expect(res.status).not.toBe(200);
        expect(text).not.toContain('Standard Schema');
      }
    });
  });

  describe('deprecated middleware instance schema (back-compat)', () => {
    const deprecatedPath = '/test/somecontroller/deprecatedMwQuery';

    it('still validates query via the deprecated instance getter', async () => {
      expect.assertions(2);
      const ok = await fetch(getTestServerURL(`${deprecatedPath}?count=5`));
      const bad = await fetch(getTestServerURL(`${deprecatedPath}?count=abc`));
      expect(ok.status).toBe(200);
      expect(bad.status).toBe(400);
    });
  });
});

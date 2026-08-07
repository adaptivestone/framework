import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { appInstance } from '../../../helpers/appInstance.ts';
import type { TUser } from '../../../models/User.ts';
import { hashToken } from '../../../models/User.ts';
import { getTestServerURL } from '../../../tests/testHelpers.ts';
import SomeController from './SomeController.ts';

describe('middlewares correct works', () => {
  before(async () => {
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
      // Tokens are stored hashed with an expiry; the raw token sent in the
      // Authorization header below is 'testUser1'.
      sessionTokens: [
        { token: hashToken('testUser1'), valid: new Date(Date.now() + 60_000) },
      ],
    });
  });

  it('authMiddleware on route works correctly (without token)', async () => {
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

    assert.strictEqual(status, 401);
  });

  it('authMiddleware on route works correctly (with token)', async () => {
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

    assert.strictEqual(response.status, 200);
    assert.strictEqual(responseBody.data.updatedUser.avatar, 'newAvatar');
  });

  it('rateLimiter on route works correctly', async () => {
    const requests = Array.from({ length: 11 }, () =>
      fetch(getTestServerURL('/test/somecontroller/')),
    );

    const responses = await Promise.all(requests);
    const statusCodes = responses.map((response) => response.status);

    assert.ok(statusCodes.includes(429));
  });

  it('checkFlag middleware works correctly with other middleware', async () => {
    const { status } = await fetch(
      getTestServerURL('/test/somecontroller/someData?flag=false'),
      {
        headers: {
          'Content-type': 'application/json',
        },
      },
    );

    assert.strictEqual(status, 400);
  });

  it('request can grab query parameters', async () => {
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

    assert.strictEqual(response.status, 200);
    assert.strictEqual(responseBody.data.name, '123');
  });

  it('request required query parameter must be provided', async () => {
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

    assert.strictEqual(response.status, 400);
    assert.strictEqual(responseBody?.data?.name, undefined);
  });

  it('request with provided required query parameter', async () => {
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

    assert.strictEqual(response.status, 200);
    assert.strictEqual(responseBody.data.name, 123);
  });

  it('request can grab query parameters from Pagination middleware', async () => {
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

    assert.strictEqual(response.status, 200);
    assert.strictEqual(responseBody.data.limit, 50);
    assert.strictEqual(responseBody.data.name, '123');
    assert.strictEqual(responseBody.data.page, 3);
  });

  it('request can not grab query parameters', async () => {
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

    assert.strictEqual(response.status, 200);
    assert.strictEqual(responseBody?.data?.name, undefined);
  });

  it('request also can grab query parameters but body has higher priority', async () => {
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

    assert.strictEqual(response.status, 200);
    assert.strictEqual(responseBody.data.name, 'notATest');
  });

  it('middleware with params works correctly', async () => {
    const { status } = await fetch(
      getTestServerURL('/test/somecontroller/someDataWithPermission'),
      {
        headers: {
          'Content-type': 'application/json',
          Authorization: 'testUser1',
        },
      },
    );

    assert.strictEqual(status, 403);
  });

  it('route without middlewares', async () => {
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

    assert.strictEqual(status, 200);
  });

  it('priority middlewares', async () => {
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

    assert.strictEqual(status, 403);
  });

  describe('content-type request map', () => {
    const path = '/test/somecontroller/contentTypeBody';

    it('dispatches to the application/json schema', async () => {
      const res = await fetch(getTestServerURL(path), {
        method: 'POST',
        headers: { 'Content-type': 'application/json' },
        body: JSON.stringify({ anything: true }),
      });
      const body = await res.json();
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(body.data, {
        via: 'json',
        contentType: 'application/json',
      });
    });

    it('dispatches to the urlencoded schema', async () => {
      const res = await fetch(getTestServerURL(path), {
        method: 'POST',
        headers: { 'Content-type': 'application/x-www-form-urlencoded' },
        body: 'anything=1',
      });
      const body = await res.json();
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(body.data, {
        via: 'form',
        contentType: 'application/x-www-form-urlencoded',
      });
    });

    it('returns 415 for an unsupported Content-Type', async () => {
      const res = await fetch(getTestServerURL(path), {
        method: 'POST',
        headers: { 'Content-type': 'application/octet-stream' },
        body: 'rawbytes',
      });
      assert.strictEqual(res.status, 415);
    });

    it('matches the Content-Type case-insensitively', async () => {
      const res = await fetch(getTestServerURL(path), {
        method: 'POST',
        headers: { 'Content-type': 'APPLICATION/JSON' },
        body: JSON.stringify({ anything: true }),
      });
      const body = await res.json();
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(body.data, {
        via: 'json',
        contentType: 'application/json',
      });
    });

    it('does not accept or leak internals for prototype-chain Content-Types', async () => {
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
        assert.notStrictEqual(res.status, 200);
        assert.ok(!text.includes('Standard Schema'));
      }
    });
  });

  describe('deprecated middleware instance schema (back-compat)', () => {
    const deprecatedPath = '/test/somecontroller/deprecatedMwQuery';

    it('still validates query via the deprecated instance getter', async () => {
      const ok = await fetch(getTestServerURL(`${deprecatedPath}?count=5`));
      const bad = await fetch(getTestServerURL(`${deprecatedPath}?count=abc`));
      assert.strictEqual(ok.status, 200);
      assert.strictEqual(bad.status, 400);
    });
  });
});

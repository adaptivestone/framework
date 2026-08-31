import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { describe, it, mock } from 'node:test';
import type { NextFunction, Response } from 'express';
import { appInstance } from '../../../helpers/appInstance.ts';
import { defaultAuthToken } from '../../../tests/testHelpers.ts';
import type { FrameworkRequest } from '../HttpServer.ts';
import GetUserByToken, {
  type GetUserByTokenAppInfo,
} from './GetUserByToken.ts';
import RequestParser from './RequestParser.ts';

describe('getUserByToken middleware methods', () => {
  it('have description fields', async () => {
    // const middleware = new GetUserByToken(appInstance);

    assert.notStrictEqual(GetUserByToken.description, undefined);
  });

  it('have description usedAuthParameters', async () => {
    const middleware = new GetUserByToken(appInstance);
    const params = middleware.usedAuthParameters;

    assert.strictEqual(params.length, 2);
    assert.strictEqual(params[0].name, 'Authorization');
  });

  it('should not called twice', async () => {
    const middleware = new GetUserByToken(appInstance);
    let isCalled = false;
    const nextFunction = () => {
      isCalled = true;
    };
    const req = {
      appInfo: {
        user: {},
      },
    };
    await middleware.middleware(
      req as unknown as FrameworkRequest,
      {} as Response,
      nextFunction,
    );

    assert.ok(isCalled);
  });

  it('should not getuser without token', async () => {
    const middleware = new GetUserByToken(appInstance);
    let isCalled = false;
    const nextFunction = () => {
      isCalled = true;
    };
    const req = {
      appInfo: {},
      body: {},
      get: () => {},
    };

    await middleware.middleware(
      req as unknown as FrameworkRequest,
      {} as Response,
      nextFunction,
    );

    assert.ok(isCalled);
  });

  it('should not getuser with a wrong token', async () => {
    const middleware = new GetUserByToken(appInstance);
    let isCalled = false;
    const nextFunction = () => {
      isCalled = true;
    };
    const req = {
      appInfo: {
        user: undefined,
      },
      body: {
        token: 'fake',
      },
      get: () => {},
    };
    await middleware.middleware(
      req as unknown as FrameworkRequest,
      {} as Response,
      nextFunction,
    );

    assert.ok(isCalled);
    assert.strictEqual(req.appInfo.user, undefined);
  });

  it('should not getuser with a good token in body', async () => {
    const middleware = new GetUserByToken(appInstance);
    let isCalled = false;
    const nextFunction = () => {
      isCalled = true;
    };
    const req = {
      appInfo: {
        user: undefined,
      },
      body: {
        token: defaultAuthToken,
      },
      get: () => {},
    };

    await middleware.middleware(
      req as unknown as FrameworkRequest,
      {} as Response,
      nextFunction,
    );

    assert.ok(isCalled);
    assert.notStrictEqual(req.appInfo.user, undefined);
  });

  it('should not getuser with a good token in header', async () => {
    const middleware = new GetUserByToken(appInstance);
    let isCalled = false;
    const nextFunction = () => {
      isCalled = true;
    };
    const req = {
      appInfo: {
        user: undefined,
      },
      body: {},
      get: () => defaultAuthToken,
    };

    await middleware.middleware(
      req as unknown as FrameworkRequest,
      {} as Response,
      nextFunction,
    );

    assert.ok(isCalled);
    assert.notStrictEqual(req.appInfo.user, undefined);
  });

  // End-to-end belt-and-braces for doc 18: a urlencoded token reaches
  // GetUserByToken as a scalar (RequestParser normalizes formidable's array),
  // so `token.replace(...)` no longer throws a 500. Pins the original symptom.
  it('resolves a urlencoded token end-to-end (RequestParser → GetUserByToken)', async () => {
    const status = await new Promise<number>((resolve) => {
      const server = createServer((req, res) => {
        const frReq = req as unknown as FrameworkRequest &
          GetUserByTokenAppInfo;
        frReq.appInfo = {
          app: appInstance,
          request: {},
          query: {},
          params: {},
        };
        frReq.body = {};
        // GetUserByToken reads req.get('Authorization') (logging + fallback).
        frReq.get = (() => undefined) as FrameworkRequest['get'];

        new RequestParser(appInstance).middleware(
          frReq,
          { once: () => {} } as unknown as Response,
          (() => {
            new GetUserByToken(appInstance).middleware(
              frReq,
              {} as Response,
              (() => {
                const code = frReq.appInfo.user ? 200 : 401;
                res.writeHead(code);
                res.end();
                resolve(code);
              }) as NextFunction,
            );
          }) as NextFunction,
        );
      });
      server.listen(null, async () => {
        const address = server.address();
        const port = typeof address === 'string' ? 0 : address?.port;
        await fetch(`http://localhost:${port}/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `token=${defaultAuthToken}`,
        }).catch(() => {});
        server.close();
      });
    });

    assert.strictEqual(status, 200);
  });

  // A non-string body token (JSON `{"token": 123}`, or a repeated form field
  // parsed as an array) reaches resolveToken before schema validation. It must
  // be treated as absent — no `token.replace(...)` on a non-string, no 500.
  it('treats a number body token as absent, not a 500', async () => {
    const middleware = new GetUserByToken(appInstance);
    let isCalled = false;
    const nextFunction = () => {
      isCalled = true;
    };
    const req = {
      appInfo: {
        user: undefined,
      },
      body: {
        token: 123,
      },
      get: () => undefined,
    };

    await middleware.middleware(
      req as unknown as FrameworkRequest,
      {} as Response,
      nextFunction,
    );

    assert.ok(isCalled);
    assert.strictEqual(req.appInfo.user, undefined);
  });

  it('treats an array body token as absent, not a 500', async () => {
    const middleware = new GetUserByToken(appInstance);
    let isCalled = false;
    const nextFunction = () => {
      isCalled = true;
    };
    const req = {
      appInfo: {
        user: undefined,
      },
      body: {
        token: ['a', 'b'],
      },
      get: () => undefined,
    };

    await middleware.middleware(
      req as unknown as FrameworkRequest,
      {} as Response,
      nextFunction,
    );

    assert.ok(isCalled);
    assert.strictEqual(req.appInfo.user, undefined);
  });

  it('never logs the token value (doc 20)', async () => {
    const middleware = new GetUserByToken(appInstance);
    const spy = mock.method(middleware.logger, 'verbose');
    const SECRET = 'super-secret-token-value-xyz';

    await middleware.middleware(
      {
        appInfo: {},
        body: { token: SECRET },
        get: () => undefined,
      } as unknown as FrameworkRequest,
      {} as Response,
      (() => {}) as NextFunction,
    );

    const logged = spy.mock.calls
      .map((call) => String(call.arguments[0]))
      .join('\n');
    spy.mock.restore();
    assert.ok(!logged.includes(SECRET));
  });

  it('should getuser with a Bearer token in header', async () => {
    const middleware = new GetUserByToken(appInstance);
    let isCalled = false;
    const nextFunction = () => {
      isCalled = true;
    };
    const req = {
      appInfo: {
        user: undefined,
      },
      body: {},
      get: (name: string) =>
        name === 'Authorization' ? `Bearer ${defaultAuthToken}` : undefined,
    };

    await middleware.middleware(
      req as unknown as FrameworkRequest,
      {} as Response,
      nextFunction,
    );

    assert.ok(isCalled);
    assert.notStrictEqual(req.appInfo.user, undefined);
  });
});

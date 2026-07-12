import { createServer } from 'node:http';
import type { NextFunction, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { appInstance } from '../../../helpers/appInstance.ts';
import { defaultAuthToken } from '../../../tests/testHelpers.ts';
import type { FrameworkRequest } from '../HttpServer.ts';
import GetUserByToken, {
  type GetUserByTokenAppInfo,
} from './GetUserByToken.ts';
import RequestParser from './RequestParser.ts';

describe('getUserByToken middleware methods', () => {
  it('have description fields', async () => {
    expect.assertions(1);

    // const middleware = new GetUserByToken(appInstance);

    expect(GetUserByToken.description).toBeDefined();
  });

  it('have description usedAuthParameters', async () => {
    expect.assertions(2);

    const middleware = new GetUserByToken(appInstance);
    const params = middleware.usedAuthParameters;

    expect(params).toHaveLength(2);
    expect(params[0].name).toBe('Authorization');
  });

  it('should not called twice', async () => {
    expect.assertions(1);

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

    expect(isCalled).toBeTruthy();
  });

  it('should not getuser without token', async () => {
    expect.assertions(1);

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

    expect(isCalled).toBeTruthy();
  });

  it('should not getuser with a wrong token', async () => {
    expect.assertions(2);

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

    expect(isCalled).toBeTruthy();
    expect(req.appInfo.user).toBeUndefined();
  });

  it('should not getuser with a good token in body', async () => {
    expect.assertions(2);

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

    expect(isCalled).toBeTruthy();
    expect(req.appInfo.user).toBeDefined();
  });

  it('should not getuser with a good token in header', async () => {
    expect.assertions(2);

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

    expect(isCalled).toBeTruthy();
    expect(req.appInfo.user).toBeDefined();
  });

  // End-to-end belt-and-braces for doc 18: a urlencoded token reaches
  // GetUserByToken as a scalar (RequestParser normalizes formidable's array),
  // so `token.replace(...)` no longer throws a 500. Pins the original symptom.
  it('resolves a urlencoded token end-to-end (RequestParser → GetUserByToken)', async () => {
    expect.assertions(1);

    const status = await new Promise<number>((resolve) => {
      const server = createServer((req, res) => {
        const frReq = req as unknown as FrameworkRequest &
          GetUserByTokenAppInfo;
        frReq.appInfo = { app: appInstance, request: {}, query: {} };
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

    expect(status).toBe(200);
  });

  // A non-string body token (JSON `{"token": 123}`, or a repeated form field
  // parsed as an array) reaches resolveToken before schema validation. It must
  // be treated as absent — no `token.replace(...)` on a non-string, no 500.
  it('treats a number body token as absent, not a 500', async () => {
    expect.assertions(2);

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

    expect(isCalled).toBeTruthy();
    expect(req.appInfo.user).toBeUndefined();
  });

  it('treats an array body token as absent, not a 500', async () => {
    expect.assertions(2);

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

    expect(isCalled).toBeTruthy();
    expect(req.appInfo.user).toBeUndefined();
  });

  it('never logs the token value (doc 20)', async () => {
    expect.assertions(1);

    const middleware = new GetUserByToken(appInstance);
    const spy = vi.spyOn(middleware.logger, 'verbose');
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

    const logged = spy.mock.calls.map((c) => String(c[0])).join('\n');
    spy.mockRestore();
    expect(logged).not.toContain(SECRET);
  });

  it('should getuser with a Bearer token in header', async () => {
    expect.assertions(2);

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

    expect(isCalled).toBeTruthy();
    expect(req.appInfo.user).toBeDefined();
  });
});

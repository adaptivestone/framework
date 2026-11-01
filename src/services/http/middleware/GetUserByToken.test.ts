import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { describe, it, mock } from 'node:test';
import { appInstance } from '../../../helpers/appInstance.ts';
import { createTestContext } from '../../../tests/createTestContext.ts';
import { defaultAuthToken } from '../../../tests/testHelpers.ts';
import { HttpResponse } from '../responses.ts';
import GetUserByToken, { type UserContext } from './GetUserByToken.ts';
import RequestParser from './RequestParser.ts';

/** Run the middleware on a test context; reports whether it continued. */
const run = async (init: {
  body?: unknown;
  headers?: Record<string, string>;
  appInfo?: Record<string, unknown>;
}) => {
  const ctx = createTestContext<UserContext['appInfo']>(init);
  let passed = false;
  await new GetUserByToken(appInstance).middleware(ctx, async () => {
    passed = true;
    return HttpResponse.empty(204);
  });
  return { passed, user: ctx.appInfo.user };
};

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

  it('declares its schemes as authSchemes, with the old static name as an alias', () => {
    assert.strictEqual(GetUserByToken.authSchemes.length, 2);
    assert.deepStrictEqual(
      GetUserByToken.usedAuthParameters,
      GetUserByToken.authSchemes,
    );
  });

  it('should not called twice', async () => {
    const existing = { id: 'already' };
    const { passed, user } = await run({ appInfo: { user: existing } });
    assert.ok(passed);
    assert.strictEqual(user, existing);
  });

  it('should not getuser without token', async () => {
    const { passed, user } = await run({ body: {} });
    assert.ok(passed);
    assert.strictEqual(user, undefined);
  });

  it('should not getuser with a wrong token', async () => {
    const { passed, user } = await run({ body: { token: 'fake' } });
    assert.ok(passed);
    assert.strictEqual(user, undefined);
  });

  it('should not getuser with a good token in body', async () => {
    const { passed, user } = await run({ body: { token: defaultAuthToken } });
    assert.ok(passed);
    assert.notStrictEqual(user, undefined);
  });

  it('should not getuser with a good token in header', async () => {
    const { passed, user } = await run({
      body: {},
      headers: { authorization: defaultAuthToken },
    });
    assert.ok(passed);
    assert.notStrictEqual(user, undefined);
  });

  // End-to-end belt-and-braces for doc 18: a urlencoded token reaches
  // GetUserByToken as a scalar (RequestParser normalizes formidable's array),
  // so `token.replace(...)` no longer throws a 500. Pins the original symptom.
  it('resolves a urlencoded token end-to-end (RequestParser → GetUserByToken)', async () => {
    const status = await new Promise<number>((resolve) => {
      const server = createServer(async (req, res) => {
        // The parser fills the context's body; GetUserByToken reads it next.
        const ctx = createTestContext<UserContext['appInfo']>({
          method: 'POST',
          headers: req.headers,
          incoming: req,
          body: {},
          appInfo: {
            app: appInstance,
            request: {},
            query: {},
            params: {},
          } as never,
        });
        await new RequestParser(appInstance).middleware(ctx, () =>
          new GetUserByToken(appInstance).middleware(ctx, async () => {
            const code = ctx.appInfo.user ? 200 : 401;
            res.writeHead(code);
            res.end();
            resolve(code);
            return HttpResponse.empty(204);
          }),
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
    const { passed, user } = await run({ body: { token: 123 } });
    assert.ok(passed);
    assert.strictEqual(user, undefined);
  });

  it('treats an array body token as absent, not a 500', async () => {
    const { passed, user } = await run({ body: { token: ['a', 'b'] } });
    assert.ok(passed);
    assert.strictEqual(user, undefined);
  });

  it('never logs the token value (doc 20)', async () => {
    const middleware = new GetUserByToken(appInstance);
    const spy = mock.method(middleware.logger, 'verbose');
    const SECRET = 'super-secret-token-value-xyz';

    await middleware.middleware(
      createTestContext({
        body: { token: SECRET },
        headers: { authorization: SECRET },
      }),
      async () => HttpResponse.empty(204),
    );

    const logged = spy.mock.calls
      .map((call) => String(call.arguments[0]))
      .join('\n');
    spy.mock.restore();
    assert.ok(!logged.includes(SECRET));
  });

  it('should getuser with a Bearer token in header', async () => {
    const { passed, user } = await run({
      body: {},
      headers: { authorization: `Bearer ${defaultAuthToken}` },
    });
    assert.ok(passed);
    assert.notStrictEqual(user, undefined);
  });

  it('resolveToken reads a request and a context alike', () => {
    const fromReq = GetUserByToken.resolveToken({
      body: {},
      header: (name: string) =>
        name === 'authorization' ? 'Bearer abc' : undefined,
    });
    const fromCtx = GetUserByToken.resolveToken(
      createTestContext({ headers: { authorization: 'Bearer abc' } }),
    );
    assert.strictEqual(fromReq, 'abc');
    assert.strictEqual(fromCtx, 'abc');
  });
});

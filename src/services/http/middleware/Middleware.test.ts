import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { IApp } from '../../../server.ts';
import { createTestContext } from '../../../tests/createTestContext.ts';
import { UnauthorizedError } from '../httpErrors.ts';
import { composeChain, middlewareLayer } from '../pipeline.ts';
import type { Next, RequestContext } from '../RequestContext.ts';
import { HttpResponse } from '../responses.ts';
import AbstractMiddleware from './AbstractMiddleware.ts';
import BaseMiddleware from './BaseMiddleware.ts';
import Middleware from './Middleware.ts';

const app = { logger: console } as unknown as IApp;

class Auth extends Middleware {
  static get requiresAuth() {
    return true;
  }

  middleware(ctx: RequestContext, next: Next) {
    if (!(ctx.appInfo as { user?: unknown }).user) {
      throw new UnauthorizedError({ code: 'AUTH001', message: 'Log in first' });
    }
    return next();
  }
}

// Compile-time contract: a forgotten `return next()` does not type-check
// against the real base (checked by `npm run check:types:tests`).
class ForgotSync extends Middleware {
  // @ts-expect-error — returns void instead of a response
  middleware(_ctx: RequestContext, next: Next) {
    next();
  }
}
class ForgotAsync extends Middleware {
  // @ts-expect-error — resolves to void instead of a response
  async middleware(_ctx: RequestContext, next: Next) {
    await next();
  }
}
class ForgotBranch extends Middleware {
  // @ts-expect-error — one branch resolves to undefined
  async middleware(ctx: RequestContext, next: Next) {
    if (ctx.header('x-go')) {
      return next();
    }
  }
}

describe('Middleware (v2 base)', () => {
  it('runs in the pipeline as a layer', async () => {
    const chain = composeChain([middlewareLayer(new Auth(app))], () =>
      HttpResponse.empty(204),
    );
    const allowed = await chain(createTestContext({ appInfo: { user: 'u1' } }));
    assert.strictEqual(allowed.status, 204);
    await assert.rejects(chain(createTestContext()), UnauthorizedError);
  });

  it('a layer is named after its class', () => {
    assert.strictEqual(middlewareLayer(new Auth(app)).name, 'Auth');
  });

  it('shares static metadata and construction with AbstractMiddleware', () => {
    assert.ok(new Auth(app, { roles: ['admin'] }) instanceof BaseMiddleware);
    assert.ok(AbstractMiddleware.prototype instanceof BaseMiddleware);
    assert.deepStrictEqual(new Auth(app, { a: 1 }).params, { a: 1 });
    assert.strictEqual(Auth.requiresAuth, true);
    assert.deepStrictEqual(Middleware.authSchemes, []);
    assert.strictEqual(Middleware.relatedQueryParameters, null);
    assert.strictEqual(Middleware.loggerGroup, 'middleware');
    // The v1 class keeps its deprecated aliases.
    assert.deepStrictEqual(AbstractMiddleware.usedAuthParameters, []);
  });

  it('the forgotten-return classes exist only for the type check', () => {
    assert.ok([ForgotSync, ForgotAsync, ForgotBranch].length === 3);
  });
});

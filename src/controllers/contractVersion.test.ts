/**
 * `contractVersion: 2` over HTTP: controller handlers and error handlers take
 * the request's `RequestContext`.
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { Response } from 'express';
import Transport from 'winston-transport';
import { appInstance } from '../helpers/appInstance.ts';
import AbstractController from '../modules/AbstractController.ts';
import type { FrameworkRequest } from '../services/http/HttpServer.ts';
import { NotFoundError } from '../services/http/httpErrors.ts';
import AbstractMiddleware from '../services/http/middleware/AbstractMiddleware.ts';
import Middleware from '../services/http/middleware/Middleware.ts';
import { type Next, RequestContext } from '../services/http/RequestContext.ts';
import { requestContext } from '../services/http/requestScope.ts';
import { HttpResponse } from '../services/http/responses.ts';
import type { StandardSchemaV1 } from '../services/validate/types.ts';
import { getTestServerURL } from '../tests/testHelpers.ts';

const requiredName: StandardSchemaV1 = {
  '~standard': {
    version: 1,
    vendor: 'contract-test',
    validate: (value) => {
      const name = (value as { name?: unknown } | null)?.name;
      return typeof name === 'string'
        ? { value: { name } }
        : { issues: [{ message: 'name is required', path: ['name'] }] };
    },
  },
};

const seen: { ctx?: unknown; scoped?: unknown; tenant?: unknown } = {};

class Tenant extends Middleware {
  middleware(ctx: RequestContext, next: Next) {
    (ctx.appInfo as { tenant?: string }).tenant = 'acme';
    ctx.response.setHeader('x-tenant', 'acme');
    return next();
  }
}

/** A 5.x controller whose methods a v2 subclass inherits. */
class LegacyBase extends AbstractController {
  get routes() {
    return {};
  }

  async legacy(_req: FrameworkRequest, res: Response) {
    return res.status(200).json({ contract: 1 });
  }

  static get middleware() {
    return new Map();
  }
}

class ContractTwoController extends LegacyBase {
  static get contractVersion() {
    return 2 as const;
  }

  get routes() {
    return {
      post: {
        '/create': { handler: this.create, request: requiredName },
      },
      get: {
        '/item/:id': this.item,
        '/missing': this.missing,
        '/forgot': this.forgot,
        '/legacy': this.legacy,
        '/tenant': { handler: this.tenant, middleware: [Tenant] },
      },
    };
  }

  async create(ctx: RequestContext) {
    seen.ctx = ctx;
    seen.scoped = requestContext();
    return HttpResponse.json(201, { name: ctx.appInfo.request.name });
  }

  async item(ctx: RequestContext) {
    return HttpResponse.json(200, {
      id: ctx.params.id,
      route: ctx.route,
      method: ctx.method,
    });
  }

  async missing(): Promise<HttpResponse> {
    throw new NotFoundError('Nothing here');
  }

  async forgot(ctx: RequestContext) {
    void ctx;
    return { not: 'a response' };
  }

  async tenant(ctx: RequestContext) {
    seen.tenant = (ctx.appInfo as { tenant?: string }).tenant;
    return HttpResponse.empty(204);
  }
}

class CaptureTransport extends Transport {
  messages: string[] = [];
  override log(info: { message: unknown }, next: () => void) {
    this.messages.push(String(info.message));
    next();
  }
}

describe('contractVersion 2 controllers', () => {
  const base = '/test/contracttwocontroller';
  const get = (path: string) => fetch(getTestServerURL(`${base}${path}`));
  const post = (path: string, body: unknown) =>
    fetch(getTestServerURL(`${base}${path}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  let capture: CaptureTransport;
  let silenced: Transport[] = [];

  before(() => {
    appInstance.controllerManager?.registerController(
      ContractTwoController,
      'test',
    );
    capture = new CaptureTransport();
    appInstance.logger.add(capture);
    silenced = appInstance.logger.transports.filter((t) => t !== capture);
    for (const t of silenced) {
      t.silent = true;
    }
  });

  after(() => {
    for (const t of silenced) {
      t.silent = false;
    }
    appInstance.logger.remove(capture);
  });

  beforeEach(() => {
    capture.messages.length = 0;
    delete seen.ctx;
    delete seen.scoped;
    delete seen.tenant;
  });

  it('a handler gets the context with the validated input', async () => {
    const res = await post('/create', { name: 'Ada', extra: 'dropped' });
    assert.strictEqual(res.status, 201);
    assert.deepStrictEqual(await res.json(), { name: 'Ada' });
    assert.ok(seen.ctx instanceof RequestContext);
    assert.strictEqual(seen.scoped, seen.ctx);
  });

  it('rejected input keeps the validation 400', async () => {
    const res = await post('/create', {});
    assert.strictEqual(res.status, 400);
    assert.deepStrictEqual(await res.json(), {
      error: 'VALIDATION_FAILED',
      message: 'Validation failed',
      errors: { name: ['name is required'] },
    });
    assert.strictEqual(seen.ctx, undefined);
  });

  it('the context reads path params and the route template', async () => {
    const res = await get('/item/42');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), {
      id: '42',
      route: '/test/contracttwocontroller/item/:id',
      method: 'GET',
    });
  });

  it('a thrown error goes through the error-handler registry', async () => {
    const res = await get('/missing');
    assert.strictEqual(res.status, 404);
    assert.deepStrictEqual(await res.json(), { message: 'Nothing here' });
  });

  it('a handler that returns no HttpResponse is a logged 500', async () => {
    const res = await get('/forgot');
    assert.strictEqual(res.status, 500);
    assert.ok(
      capture.messages.some((m) =>
        m.includes('ContractTwoController.forgot must return an HttpResponse'),
      ),
      JSON.stringify(capture.messages),
    );
  });

  it('an inherited 5.x method keeps (req, res)', async () => {
    const res = await get('/legacy');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), { contract: 1 });
  });

  it('a v2 middleware shares appInfo and staged headers with the handler', async () => {
    const res = await get('/tenant');
    assert.strictEqual(res.status, 204);
    assert.strictEqual(res.headers.get('x-tenant'), 'acme');
    assert.strictEqual(seen.tenant, 'acme');
  });
});

// ─── error handlers registered with { contractVersion: 2 } ───

class ContextFailure extends Error {}

class FailsInMiddleware extends AbstractMiddleware {
  async middleware(_req: unknown, _res: unknown, next: (e?: unknown) => void) {
    next(new ContextFailure('from a 5.x middleware'));
  }
}

/** A 5.x controller: its errors reach the handler through `req`-only code. */
class LegacyFailing extends AbstractController {
  get routes() {
    return {
      get: {
        '/fails': this.fails,
        '/mw-fails': { handler: this.fails, middleware: [FailsInMiddleware] },
      },
    };
  }

  async fails(_req: FrameworkRequest, _res: Response): Promise<void> {
    throw new ContextFailure('from a 5.x handler');
  }

  static get middleware() {
    return new Map();
  }
}

class ContextFailing extends AbstractController {
  static get contractVersion() {
    return 2 as const;
  }

  get routes() {
    return { get: { '/fails': this.fails } };
  }

  async fails(ctx: RequestContext): Promise<HttpResponse> {
    seen.ctx = ctx;
    throw new ContextFailure('from a ctx handler');
  }

  static get middleware() {
    return new Map();
  }
}

describe('error handlers with { contractVersion: 2 }', () => {
  const handled: RequestContext[] = [];
  let unregister: (() => void) | undefined;

  before(() => {
    appInstance.controllerManager?.registerController(LegacyFailing, 'test');
    appInstance.controllerManager?.registerController(ContextFailing, 'test');
    unregister = appInstance.httpServer?.registerErrorHandler(
      ContextFailure,
      (err, ctx) => {
        handled.push(ctx);
        ctx.response.setHeader('x-handled', 'ctx');
        return HttpResponse.json(409, { path: ctx.path, message: err.message });
      },
      { contractVersion: 2, logLevel: 'verbose' },
    );
  });

  after(() => unregister?.());

  beforeEach(() => {
    handled.length = 0;
    delete seen.ctx;
  });

  // Compile-time: without the option the handler gets `req`, not a context.
  const typeOnly = () =>
    appInstance.httpServer?.registerErrorHandler(ContextFailure, (_e, req) => {
      // @ts-expect-error — `req` has no `onFinish`; register with `{ contractVersion: 2 }`
      req.onFinish(() => {});
      return null;
    });
  void typeOnly;

  it('a ctx handler error: the handler gets the same context, its header is sent', async () => {
    const res = await fetch(getTestServerURL('/test/contextfailing/fails'));
    assert.strictEqual(res.status, 409);
    assert.deepStrictEqual(await res.json(), {
      path: '/test/contextfailing/fails',
      message: 'from a ctx handler',
    });
    assert.strictEqual(res.headers.get('x-handled'), 'ctx');
    assert.strictEqual(handled.length, 1);
    assert.strictEqual(handled[0], seen.ctx);
  });

  for (const [name, path, message] of [
    ['a 5.x handler', '/fails', 'from a 5.x handler'],
    ['a 5.x middleware', '/mw-fails', 'from a 5.x middleware'],
  ] as const) {
    it(`an error from ${name} still gets a context, and its header is sent`, async () => {
      const res = await fetch(getTestServerURL(`/test/legacyfailing${path}`));
      assert.strictEqual(res.status, 409);
      assert.deepStrictEqual(await res.json(), {
        path: `/test/legacyfailing${path}`,
        message,
      });
      assert.strictEqual(res.headers.get('x-handled'), 'ctx');
      assert.ok(handled[0] instanceof RequestContext);
    });
  }
});

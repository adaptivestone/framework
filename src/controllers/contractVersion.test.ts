/**
 * `static contractVersion = 2` controllers over HTTP: handlers take the
 * request's `RequestContext` and return an `HttpResponse`.
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { Response } from 'express';
import Transport from 'winston-transport';
import { appInstance } from '../helpers/appInstance.ts';
import AbstractController from '../modules/AbstractController.ts';
import type { FrameworkRequest } from '../services/http/HttpServer.ts';
import { NotFoundError } from '../services/http/httpErrors.ts';
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

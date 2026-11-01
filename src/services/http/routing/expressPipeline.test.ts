import assert from 'node:assert/strict';
import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';
import express, { type Request, type Response } from 'express';
import type { IApp } from '../../../server.ts';
import { ValidationError } from '../../validate/ValidationError.ts';
import { markValidationStage } from '../answerError.ts';
import { HttpError } from '../httpErrors.ts';
import AbstractMiddleware from '../middleware/AbstractMiddleware.ts';
import Middleware from '../middleware/Middleware.ts';
import type { FinishResult, Next, RequestContext } from '../RequestContext.ts';
import { requestContext } from '../requestScope.ts';
import { HttpResponse } from '../responses.ts';
import { createExpressAdapter } from './ExpressAdapter.ts';
import type { HandlerEntry, MiddlewareClass } from './RouteNode.ts';
import { RouteRegistry } from './RouteRegistry.ts';

// ─── a small app: a fake error registry that maps HttpError and strings ───

const logged: string[] = [];
const fakeApp = {
  getConfig: () => ({}),
  logger: {
    error: (m: unknown) => logged.push(String(m)),
    warn: () => {},
    verbose: () => {},
    info: () => {},
  },
  httpServer: {
    resolveError: async (err: unknown) => {
      if (err instanceof HttpError) {
        return {
          status: err.status,
          body: { error: 'HTTP' },
          response: HttpResponse.json(err.status, { error: 'HTTP' }),
          logLevel: 'verbose',
        };
      }
      if (typeof err === 'string') {
        return {
          status: 418,
          body: { raw: err },
          response: HttpResponse.json(418, { raw: err }),
          logLevel: 'verbose',
        };
      }
      return null;
    },
  },
} as unknown as IApp;

let server: Server;
let origin: string;
let registry: RouteRegistry;

before(async () => {
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { appInfo: object }).appInfo = {};
    next();
  });
  app.use((req, res, next) =>
    createExpressAdapter(registry, fakeApp)(req, res, next),
  );
  app.use((err: unknown, _req: Request, res: Response, _next: () => void) => {
    if (!res.headersSent) {
      res.status(599).json({ sink: String(err) });
    }
  });
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  registry = new RouteRegistry();
  logged.length = 0;
});

const route = (
  middlewares: MiddlewareClass[],
  handler: HandlerEntry['handler'],
  rawHandler?: HandlerEntry['rawHandler'],
) => {
  registry.registerRoute('GET', '/r', {
    handler,
    rawHandler,
    middlewares: middlewares.map((Class) => ({ Class })),
  });
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── middleware used by the cases ───

const events: string[] = [];
let finishes: FinishResult[] = [];
let lastCtx: RequestContext | undefined;

class Stage extends Middleware {
  middleware(ctx: RequestContext, next: Next) {
    lastCtx = ctx;
    ctx.response.setHeader('x-staged', 'yes');
    ctx.onFinish((r) => finishes.push(r));
    return next();
  }
}
class Deny extends Middleware {
  middleware() {
    return HttpResponse.json(403, { error: 'NO_ACCESS' });
  }
}
let txLog: string[] = [];
class Transaction extends Middleware {
  async middleware(_ctx: RequestContext, next: Next) {
    txLog.push('begin');
    try {
      const response = await next();
      txLog.push(`commit ${response.kind}`);
      return response;
    } catch (err) {
      txLog.push('rollback');
      throw err;
    } finally {
      txLog.push('end');
    }
  }
}
class LegacyPass extends AbstractMiddleware {
  async middleware(_req: unknown, _res: unknown, next: (e?: unknown) => void) {
    events.push('legacy');
    next();
    events.push('legacy after next');
  }
}
class LegacyAnswers extends AbstractMiddleware {
  async middleware(_req: unknown, res: Response) {
    res.status(202).json({ legacy: true });
  }
}
class LegacyFailsWithString extends AbstractMiddleware {
  async middleware(_req: unknown, _res: unknown, next: (e?: unknown) => void) {
    next('plain failure');
  }
}
class LateStager extends Middleware {
  async middleware(ctx: RequestContext, next: Next) {
    const response = await next();
    try {
      ctx.response.setHeader('x-late', '1');
    } catch (err) {
      events.push(`late staging refused: ${(err as Error).message}`);
    }
    return response;
  }
}

beforeEach(() => {
  events.length = 0;
  finishes = [];
  txLog = [];
  lastCtx = undefined;
});

describe('v2 chain on Express — contract', () => {
  it('a v2 middleware stops the request with a response', async () => {
    let ran = false;
    route([Stage, Deny], () => {
      ran = true;
    });
    const response = await fetch(`${origin}/r`);
    assert.strictEqual(response.status, 403);
    assert.deepStrictEqual(await response.json(), { error: 'NO_ACCESS' });
    assert.strictEqual(response.headers.get('x-staged'), 'yes');
    assert.strictEqual(ran, false);
  });

  it('a returned response gets the staged headers; onFinish reports it; requestContext() works in the handler', async () => {
    let seen: unknown;
    route([Stage], () => {
      seen = requestContext();
      return HttpResponse.json(201, { ok: true });
    });
    const response = await fetch(`${origin}/r`);
    assert.strictEqual(response.status, 201);
    assert.strictEqual(response.headers.get('x-staged'), 'yes');
    await sleep(10);
    assert.strictEqual(seen, lastCtx);
    assert.strictEqual(finishes.length, 1);
    assert.strictEqual(finishes[0]?.outcome, 'finished');
    assert.strictEqual(finishes[0]?.status, 201);
  });

  it('the context reads the Express request', async () => {
    let read: unknown;
    route([Stage], () => {
      const ctx = lastCtx as RequestContext;
      read = {
        method: ctx.method,
        path: ctx.path,
        route: ctx.route,
        query: { ...ctx.query }, // Express 5 builds it without a prototype
        href: ctx.url.pathname + ctx.url.search,
        header: ctx.header('x-test'),
      };
      return HttpResponse.empty(204);
    });
    await fetch(`${origin}/r?a=1`, { headers: { 'x-test': 'v' } });
    assert.deepStrictEqual(read, {
      method: 'GET',
      path: '/r',
      route: '/r',
      query: { a: '1' },
      href: '/r?a=1',
      header: 'v',
    });
  });
});

describe('v2 chain on Express — errors', () => {
  it('a handler error rolls back the v2 transaction and is resolved once at the top', async () => {
    route(
      [Transaction],
      async () => HttpResponse.json(500, { wrapped: 'would have caught' }),
      async () => {
        throw new HttpError(409, 'conflict');
      },
    );
    const response = await fetch(`${origin}/r`);
    assert.strictEqual(response.status, 409);
    assert.deepStrictEqual(await response.json(), { error: 'HTTP' });
    assert.deepStrictEqual(txLog, ['begin', 'rollback', 'end']);
  });

  it('a validation error keeps the 400 fallback', async () => {
    route(
      [Stage],
      async () => HttpResponse.empty(204),
      async () => {
        const err = new ValidationError({ name: ['required'] });
        markValidationStage(err);
        throw err;
      },
    );
    const response = await fetch(`${origin}/r`);
    assert.strictEqual(response.status, 400);
    const body = (await response.json()) as { errors: unknown };
    assert.deepStrictEqual(body.errors, { name: ['required'] });
    assert.strictEqual(response.headers.get('x-staged'), 'yes');
  });

  it('an unknown error is a logged 500', async () => {
    route(
      [Stage],
      async () => HttpResponse.empty(204),
      async () => {
        throw new Error('broken');
      },
    );
    const response = await fetch(`${origin}/r`);
    assert.strictEqual(response.status, 500);
    assert.ok(logged.some((m) => m.includes('broken')));
  });
});

describe('v2 chain on Express — 5.x code inside', () => {
  it('a v1 middleware that calls next() continues, after its own synchronous code', async () => {
    route([Stage, LegacyPass], () => {
      events.push('handler');
      return HttpResponse.empty(204);
    });
    const response = await fetch(`${origin}/r`);
    assert.strictEqual(response.status, 204);
    assert.deepStrictEqual(events, ['legacy', 'legacy after next', 'handler']);
  });

  it("a v1 middleware's next(error) keeps the original value", async () => {
    route([Stage, LegacyFailsWithString], () => HttpResponse.empty(204));
    const response = await fetch(`${origin}/r`);
    assert.strictEqual(response.status, 418);
    assert.deepStrictEqual(await response.json(), { raw: 'plain failure' });
  });

  it('a v1 middleware that answers yields "sent"; staged headers are flushed into its response', async () => {
    let ran = false;
    route([Transaction, Stage, LegacyAnswers], () => {
      ran = true;
    });
    const response = await fetch(`${origin}/r`);
    assert.strictEqual(response.status, 202);
    assert.deepStrictEqual(await response.json(), { legacy: true });
    assert.strictEqual(response.headers.get('x-staged'), 'yes');
    assert.strictEqual(ran, false);
    assert.deepStrictEqual(txLog, ['begin', 'commit sent', 'end']);
  });

  it('a handler that writes res yields "sent"; staging after the commit is refused', async () => {
    route([LateStager, Stage], (_req: Request, res: Response) => {
      res.status(200).json({ legacy: 'handler' });
    });
    const response = await fetch(`${origin}/r`);
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers.get('x-staged'), 'yes');
    assert.strictEqual(response.headers.get('x-late'), null);
    await sleep(10);
    assert.ok(events.some((e) => e.startsWith('late staging refused')));
    assert.strictEqual(finishes[0]?.outcome, 'finished');
  });
});

describe('v2 chain on Express — misuse', () => {
  it('replacing a response 5.x code already sent is reported, not written twice', async () => {
    class Replacer extends Middleware {
      async middleware(_ctx: RequestContext, next: Next) {
        await next();
        return HttpResponse.json(500, { replaced: true });
      }
    }
    route([Replacer, LegacyAnswers], () => HttpResponse.empty(204));
    const response = await fetch(`${origin}/r`);
    assert.strictEqual(response.status, 202);
    assert.deepStrictEqual(await response.json(), { legacy: true });
    await sleep(10);
    assert.ok(
      logged.some((m) => m.includes('replaced a response')),
      JSON.stringify(logged),
    );
  });
});

describe('v2 chain on Express — client abort', () => {
  it('a client that leaves while the handler runs: signal aborts, onFinish reports aborted', async () => {
    let aborted = false;
    route([Stage], async () => {
      const ctx = lastCtx as RequestContext;
      ctx.signal.addEventListener('abort', () => {
        aborted = true;
      });
      await sleep(200);
      return HttpResponse.empty(204);
    });
    const controller = new AbortController();
    const pending = fetch(`${origin}/r`, { signal: controller.signal }).catch(
      () => undefined,
    );
    await sleep(50);
    controller.abort();
    await pending;
    await sleep(250);
    assert.strictEqual(aborted, true);
    assert.strictEqual(finishes[0]?.outcome, 'aborted');
  });
});

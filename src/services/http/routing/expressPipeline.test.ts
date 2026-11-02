import assert from 'node:assert/strict';
import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';
import express, { type Request, type Response } from 'express';
import type { IApp } from '../../../server.ts';
import { ValidationError } from '../../validate/ValidationError.ts';
import { markValidationStage } from '../answerError.ts';
import { ExpressResponseWriter } from '../ExpressResponseWriter.ts';
import { HttpError } from '../httpErrors.ts';
import AbstractMiddleware from '../middleware/AbstractMiddleware.ts';
import Middleware from '../middleware/Middleware.ts';
import type { FinishResult, Next, RequestContext } from '../RequestContext.ts';
import { requestContext } from '../requestScope.ts';
import { HttpResponse } from '../responses.ts';
import { createExpressAdapter } from './ExpressAdapter.ts';
import { expressMiddleware } from './expressPipeline.ts';
import type {
  HandlerEntry,
  MiddlewareClass,
  MiddlewareEntry,
} from './RouteNode.ts';
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
/** A writer for the next request (`undefined`: the adapter's default). */
let writer: ExpressResponseWriter | undefined;
/** App-wide middleware for the next request (the `Server` option). */
let appMiddleware: MiddlewareEntry[] = [];

before(async () => {
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { appInfo: object }).appInfo = {};
    next();
  });
  app.use((req, res, next) =>
    createExpressAdapter(registry, fakeApp, writer, { appMiddleware })(
      req,
      res,
      next,
    ),
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
  writer = undefined;
  appMiddleware = [];
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

describe('v2 chain on Express — 5.x outcomes (every row of the bridge table)', () => {
  it('a v1 next() runs the rest inside the v2 wrapper and its request scope', async () => {
    let scoped: unknown;
    route([Stage, Transaction, LegacyPass], () => {
      scoped = requestContext();
      return HttpResponse.json(200, { ok: true });
    });
    const response = await fetch(`${origin}/r`);
    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(txLog, ['begin', 'commit json', 'end']);
    assert.strictEqual(scoped, lastCtx);
  });

  it('a v1 handler that returns before writing: the wrapper waits for the write', async () => {
    route([Stage, Transaction], (_req: Request, res: Response) => {
      setTimeout(() => {
        txLog.push('write');
        res.status(200).json({ late: true });
      }, 20);
    });
    const response = await fetch(`${origin}/r`);
    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(await response.json(), { late: true });
    await sleep(10);
    assert.deepStrictEqual(txLog, ['begin', 'write', 'commit sent', 'end']);
    assert.strictEqual(finishes[0]?.status, 200);
  });

  it('a response 5.x code wrote finishes once and skips transformResponse', async () => {
    let transformed = 0;
    writer = new ExpressResponseWriter({
      transform: (response) => {
        transformed += 1;
        return response;
      },
    });
    route([Stage, LegacyAnswers], () => HttpResponse.empty(500));
    const response = await fetch(`${origin}/r`);
    assert.strictEqual(response.status, 202);
    await sleep(10);
    assert.strictEqual(finishes.length, 1);
    assert.strictEqual(finishes[0]?.outcome, 'finished');
    assert.strictEqual(transformed, 0);
  });

  it('a client that leaves while 5.x code writes: rollback, aborted, signal aborted', async () => {
    route([Transaction, Stage], async (_req: Request, res: Response) => {
      res.write('partial');
      await sleep(200);
      res.end();
    });
    const controller = new AbortController();
    const pending = fetch(`${origin}/r`, { signal: controller.signal })
      .then((r) => r.text())
      .catch(() => undefined);
    await sleep(50);
    controller.abort();
    await pending;
    await sleep(250);
    assert.ok(txLog.includes('rollback'), JSON.stringify(txLog));
    assert.strictEqual(finishes[0]?.outcome, 'aborted');
    assert.strictEqual(lastCtx?.signal.aborted, true);
  });

  it('an outer middleware that throws after 5.x code sent the response: logged, not re-answered', async () => {
    class LateThrow extends Middleware {
      async middleware(
        _ctx: RequestContext,
        next: Next,
      ): Promise<HttpResponse> {
        await next();
        throw new Error('late failure');
      }
    }
    route([LateThrow, Stage, LegacyAnswers], () => HttpResponse.empty(500));
    const response = await fetch(`${origin}/r`);
    assert.strictEqual(response.status, 202);
    assert.deepStrictEqual(await response.json(), { legacy: true });
    await sleep(10);
    assert.ok(
      logged.some((m) =>
        m.includes('Request failed after the response started'),
      ),
      JSON.stringify(logged),
    );
    assert.strictEqual(finishes.length, 1);
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

describe('v2 chain on Express — cookies', () => {
  let read: string | undefined;
  class Session extends Middleware {
    middleware(ctx: RequestContext, next: Next) {
      read = ctx.cookies.get('in');
      ctx.response.setCookie('sid', 'abc');
      return next();
    }
  }
  const staged = 'sid=abc; Path=/; HttpOnly; SameSite=Lax';

  it('a staged cookie reaches a returned response, after its own Set-Cookie', async () => {
    route([Session], () =>
      HttpResponse.json(
        200,
        { ok: true },
        { headers: { 'set-cookie': 'theme=dark' } },
      ),
    );
    const response = await fetch(`${origin}/r`, {
      headers: { cookie: 'in=hello%20there' },
    });
    assert.strictEqual(response.status, 200);
    assert.strictEqual(read, 'hello there');
    assert.deepStrictEqual(response.headers.getSetCookie(), [
      staged,
      'theme=dark',
    ]);
  });

  it('a staged cookie reaches an error response', async () => {
    route(
      [Session],
      async () => HttpResponse.empty(204),
      async () => {
        throw new HttpError(409, 'conflict');
      },
    );
    const response = await fetch(`${origin}/r`);
    assert.strictEqual(response.status, 409);
    assert.deepStrictEqual(response.headers.getSetCookie(), [staged]);
  });

  it('a staged cookie reaches a response 5.x code writes, next to its own', async () => {
    class LegacyCookie extends AbstractMiddleware {
      async middleware(_req: unknown, res: Response) {
        res.cookie('legacy', '1');
        res.status(202).json({ legacy: true });
      }
    }
    route([Session, LegacyCookie], () => HttpResponse.empty(204));
    const response = await fetch(`${origin}/r`);
    assert.strictEqual(response.status, 202);
    assert.deepStrictEqual(response.headers.getSetCookie().sort(), [
      'legacy=1; Path=/',
      staged,
    ]);
  });

  it('deleteCookie sends an expired cookie', async () => {
    class Logout extends Middleware {
      middleware(ctx: RequestContext) {
        ctx.response.deleteCookie('sid');
        return HttpResponse.empty(204);
      }
    }
    route([Logout], () => HttpResponse.empty(500));
    const response = await fetch(`${origin}/r`);
    assert.deepStrictEqual(response.headers.getSetCookie(), [
      'sid=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax',
    ]);
  });
});

describe('transformResponse gets the request context', () => {
  it('on a v2 route: the context the middleware saw, staging closed', async () => {
    let seen: unknown;
    let refused = false;
    writer = new ExpressResponseWriter({
      transform: (response, { ctx }) => {
        seen = ctx;
        try {
          ctx.response.setHeader('x-in-transform', '1');
        } catch {
          refused = true;
        }
        return response;
      },
    });
    route([Stage], () => HttpResponse.json(200, { ok: true }));
    const response = await fetch(`${origin}/r`);
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers.get('x-staged'), 'yes');
    assert.strictEqual(response.headers.get('x-in-transform'), null);
    assert.strictEqual(seen, lastCtx);
    assert.strictEqual(refused, true);
  });

  it('on a 5.x route: a context made on first read, with onFinish', async () => {
    let seenRoute: string | undefined;
    writer = new ExpressResponseWriter({
      transform: (response, { ctx }) => {
        seenRoute = ctx.route;
        ctx.onFinish((r) => finishes.push(r));
        return response;
      },
    });
    route([], () => HttpResponse.json(201, { ok: true }));
    const response = await fetch(`${origin}/r`);
    assert.strictEqual(response.status, 201);
    await sleep(10);
    assert.strictEqual(seenRoute, '/r');
    assert.strictEqual(finishes.length, 1);
    assert.strictEqual(finishes[0]?.outcome, 'finished');
    assert.strictEqual(finishes[0]?.status, 201);
  });
});

describe('app-wide middleware (the Server `middleware` option)', () => {
  class Outer extends Middleware {
    async middleware(ctx: RequestContext, next: Next) {
      events.push('outer in');
      ctx.response.setHeader('x-outer', 'yes');
      try {
        const response = await next();
        events.push(`outer out ${response.kind} ${response.status}`);
        return response;
      } catch (err) {
        events.push('outer caught');
        throw err;
      }
    }
  }
  class Gate extends Middleware {
    middleware(ctx: RequestContext, next: Next) {
      return ctx.header('authorization')
        ? next()
        : HttpResponse.json(401, { error: 'NO_TOKEN' });
    }
  }

  it('wraps a route with only 5.x code: runs first, sees the response, adds its header', async () => {
    appMiddleware = [{ Class: Outer }];
    route([LegacyPass], (_req: Request, res: Response) => {
      events.push('handler');
      res.status(200).json({ legacy: true });
    });
    const response = await fetch(`${origin}/r`);
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers.get('x-outer'), 'yes');
    await sleep(10);
    assert.deepStrictEqual(events, [
      'outer in',
      'legacy',
      'legacy after next',
      'handler',
      'outer out sent 200',
    ]);
  });

  it('wraps the 404, the 405 and the malformed-URL 400', async () => {
    appMiddleware = [{ Class: Outer }];
    route([], () => HttpResponse.empty(204));
    const missing = await fetch(`${origin}/nope`);
    assert.strictEqual(missing.status, 404);
    assert.deepStrictEqual(await missing.json(), {
      error: 'NOT_FOUND',
      message: 'Not found',
    });
    assert.strictEqual(missing.headers.get('x-outer'), 'yes');

    const notAllowed = await fetch(`${origin}/r`, { method: 'DELETE' });
    assert.strictEqual(notAllowed.status, 405);
    assert.strictEqual(notAllowed.headers.get('allow'), 'GET, HEAD');
    assert.strictEqual(notAllowed.headers.get('x-outer'), 'yes');

    const malformed = await fetch(`${origin}/r/%E0%A4%A`);
    assert.strictEqual(malformed.status, 400);
    assert.strictEqual(malformed.headers.get('x-outer'), 'yes');
    assert.deepStrictEqual(events, [
      'outer in',
      'outer out json 404',
      'outer in',
      'outer out json 405',
      'outer in',
      'outer out json 400',
    ]);
  });

  it('runs in order and can answer before routing', async () => {
    appMiddleware = [{ Class: Outer }, { Class: Gate }];
    let ran = false;
    route([Stage], () => {
      ran = true;
      return HttpResponse.empty(204);
    });
    const denied = await fetch(`${origin}/r`);
    assert.strictEqual(denied.status, 401);
    assert.strictEqual(denied.headers.get('x-outer'), 'yes');
    assert.strictEqual(ran, false);

    const allowed = await fetch(`${origin}/r`, {
      headers: { authorization: 'Bearer x' },
    });
    assert.strictEqual(allowed.status, 204);
    assert.strictEqual(allowed.headers.get('x-staged'), 'yes');
    assert.strictEqual(ran, true);
  });

  it('a route error reaches it before the error handlers answer', async () => {
    appMiddleware = [{ Class: Outer }];
    route([], async () => {
      throw new HttpError(409, 'conflict');
    });
    const response = await fetch(`${origin}/r`);
    assert.strictEqual(response.status, 409);
    assert.deepStrictEqual(await response.json(), { error: 'HTTP' });
    assert.strictEqual(response.headers.get('x-outer'), 'yes');
    assert.deepStrictEqual(events, ['outer in', 'outer caught']);
  });
});

describe('a Middleware mounted on Express (the global built-ins)', () => {
  /** A plain Express app: the bridged middleware, then 5.x code. */
  const serve = async (
    instance: Middleware,
    after: (req: Request, res: Response) => void,
  ) => {
    const app = express();
    app.use(expressMiddleware(fakeApp, new ExpressResponseWriter(), instance));
    app.use(after);
    app.use((err: unknown, _req: Request, res: Response, _next: () => void) => {
      res.status(599).json({ sink: String(err) });
    });
    const bridged = http.createServer(app);
    await new Promise<void>((resolve) => bridged.listen(0, resolve));
    const url = `http://127.0.0.1:${(bridged.address() as AddressInfo).port}/`;
    const close = () => {
      bridged.closeAllConnections();
      return new Promise((resolve) => bridged.close(resolve));
    };
    return { url, close };
  };

  it('next() continues to 5.x code, in the request scope, with one appInfo', async () => {
    let inside: { same?: boolean; shared?: unknown } = {};
    let finished: FinishResult | undefined;
    class Mark extends Middleware {
      middleware(ctx: RequestContext, next: Next) {
        lastCtx = ctx;
        (ctx.appInfo as { mark?: string }).mark = 'set by ctx';
        ctx.response.setHeader('x-mark', '1');
        ctx.onFinish((r) => {
          finished = r;
        });
        return next();
      }
    }
    const { url, close } = await serve(new Mark(fakeApp), (req, res) => {
      inside = {
        same: requestContext() === lastCtx,
        shared: (req as unknown as { appInfo: { mark?: string } }).appInfo.mark,
      };
      res.status(200).json({ ok: true });
    });
    try {
      const response = await fetch(url);
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.headers.get('x-mark'), '1');
      await sleep(10);
      assert.deepStrictEqual(inside, { same: true, shared: 'set by ctx' });
      assert.strictEqual(finished?.outcome, 'finished');
    } finally {
      await close();
    }
  });

  it('a returned response is written with the staged headers; later code does not run', async () => {
    let ran = false;
    class Answer extends Middleware {
      middleware(ctx: RequestContext) {
        ctx.response.setHeader('x-mark', '1');
        return HttpResponse.json(418, { teapot: true });
      }
    }
    const { url, close } = await serve(new Answer(fakeApp), () => {
      ran = true;
    });
    try {
      const response = await fetch(url);
      assert.strictEqual(response.status, 418);
      assert.strictEqual(response.headers.get('x-mark'), '1');
      assert.deepStrictEqual(await response.json(), { teapot: true });
      assert.strictEqual(ran, false);
    } finally {
      await close();
    }
  });

  it('a throw goes to the Express error handler', async () => {
    class Fail extends Middleware {
      middleware(): never {
        throw new Error('bridge failure');
      }
    }
    const { url, close } = await serve(new Fail(fakeApp), () => {});
    try {
      const response = await fetch(url);
      assert.strictEqual(response.status, 599);
      assert.deepStrictEqual(await response.json(), {
        sink: 'Error: bridge failure',
      });
    } finally {
      await close();
    }
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

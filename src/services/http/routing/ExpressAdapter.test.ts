import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { IApp } from '../../../server.ts';
import { createExpressAdapter } from './ExpressAdapter.ts';
import { RouteRegistry } from './RouteRegistry.ts';

// ─── minimal mocks ───────────────────────────────────────────────────

const fakeApp = {} as IApp;

interface MockRes extends EventEmitter {
  statusCode: number;
  headersSent: boolean;
  writableEnded: boolean;
  headers: Record<string, string>;
  body?: unknown;
  status(code: number): MockRes;
  setHeader(k: string, v: string): void;
  getHeader(k: string): string | undefined;
  json(obj: unknown): MockRes;
  end(): MockRes;
}

const makeRes = (): MockRes => {
  const res = new EventEmitter() as MockRes;
  res.statusCode = 200;
  res.headersSent = false;
  res.writableEnded = false;
  res.headers = {};
  res.status = function (code) {
    this.statusCode = code;
    return this;
  };
  res.setHeader = function (k, v) {
    this.headers[k.toLowerCase()] = v;
  };
  res.getHeader = function (k) {
    return this.headers[k.toLowerCase()];
  };
  res.json = function (obj) {
    this.body = obj;
    this.writableEnded = true;
    this.emit('finish');
    return this;
  };
  res.end = function () {
    this.writableEnded = true;
    this.emit('finish');
    return this;
  };
  return res;
};

const makeReq = (method: string, path: string) =>
  ({
    method,
    path,
    url: path,
    headers: {},
    params: {},
    // biome-ignore lint/suspicious/noExplicitAny: minimal request stub
  }) as any;

// ─── tests ───────────────────────────────────────────────────────────

describe('createExpressAdapter — 404 fallthrough', () => {
  it('calls next() when no path matches', async () => {
    const r = new RouteRegistry();
    r.registerRoute('GET', '/users', { handler: async () => {} });

    const adapter = createExpressAdapter(r, fakeApp);
    const next = vi.fn();
    await adapter(makeReq('GET', '/missing'), makeRes(), next);
    expect(next).toHaveBeenCalledWith();
  });
});

describe('createExpressAdapter — 405 with Allow', () => {
  it('returns 405 + Allow header when method is not registered', async () => {
    const r = new RouteRegistry();
    r.registerRoute('GET', '/users', { handler: async () => {} });
    r.registerRoute('POST', '/users', { handler: async () => {} });

    const adapter = createExpressAdapter(r, fakeApp);
    const res = makeRes();
    await adapter(makeReq('DELETE', '/users'), res, vi.fn());
    expect(res.statusCode).toBe(405);
    const allow = res.getHeader('allow');
    expect(allow).toMatch(/GET/);
    expect(allow).toMatch(/POST/);
  });
});

describe('createExpressAdapter — successful match', () => {
  it('invokes the handler with req and res', async () => {
    const handler = vi.fn(async (_req, res) => {
      res.json({ ok: true });
    });
    const r = new RouteRegistry();
    r.registerRoute('GET', '/users', { handler });

    const adapter = createExpressAdapter(r, fakeApp);
    const res = makeRes();
    await adapter(makeReq('GET', '/users'), res, vi.fn());
    expect(handler).toHaveBeenCalled();
    expect(res.body).toEqual({ ok: true });
  });

  it('populates req.params with matched params', async () => {
    let captured: unknown = null;
    const r = new RouteRegistry();
    r.registerRoute('GET', '/users/:id', {
      handler: async (req, res) => {
        captured = req.params;
        res.end();
      },
    });

    const adapter = createExpressAdapter(r, fakeApp);
    await adapter(makeReq('GET', '/users/42'), makeRes(), vi.fn());
    expect(captured).toEqual({ id: '42' });
  });

  it('attaches routeMeta with bodyParsing and handler meta', async () => {
    let captured: unknown = null;
    const r = new RouteRegistry();
    r.registerRoute('POST', '/webhook', {
      handler: async (req, res) => {
        // biome-ignore lint/suspicious/noExplicitAny: routeMeta is runtime extension
        captured = (req as any).routeMeta;
        res.end();
      },
      bodyParsing: 'raw',
      meta: { methodName: 'webhookHandler' },
    });

    const adapter = createExpressAdapter(r, fakeApp);
    await adapter(makeReq('POST', '/webhook'), makeRes(), vi.fn());
    expect(captured).toEqual({
      bodyParsing: 'raw',
      methodName: 'webhookHandler',
    });
  });
});

describe('createExpressAdapter — middleware order + short-circuit', () => {
  it('runs middlewares in registered order before the handler', async () => {
    const order: string[] = [];
    class FirstMw {
      readonly _kind = 'mw';
      // biome-ignore lint/suspicious/noExplicitAny: minimal mw shape for test
      async middleware(_req: any, _res: any, next: any) {
        order.push('first');
        next();
      }
    }
    class SecondMw {
      readonly _kind = 'mw';
      // biome-ignore lint/suspicious/noExplicitAny: minimal mw shape for test
      async middleware(_req: any, _res: any, next: any) {
        order.push('second');
        next();
      }
    }

    const r = new RouteRegistry();
    r.root.middlewares.push({
      // biome-ignore lint/suspicious/noExplicitAny: synthetic mw class
      Class: FirstMw as any,
      source: { kind: 'package', spec: 't' },
    });
    r.registerRoute('GET', '/x', {
      handler: async (_req, res) => {
        order.push('handler');
        res.end();
      },
      middlewares: [
        {
          // biome-ignore lint/suspicious/noExplicitAny: synthetic mw class for tests
          Class: SecondMw as any,
          source: { kind: 'package', spec: 't' },
        },
      ],
    });

    const adapter = createExpressAdapter(r, fakeApp);
    await adapter(makeReq('GET', '/x'), makeRes(), vi.fn());
    expect(order).toEqual(['first', 'second', 'handler']);
  });

  it('short-circuits when a middleware ends the response', async () => {
    const order: string[] = [];
    class ShortCircuitMw {
      readonly _kind = 'mw';
      // biome-ignore lint/suspicious/noExplicitAny: minimal mw shape for test
      async middleware(_req: any, res: any) {
        order.push('mw');
        res.status(401).json({ message: 'unauthorized' });
        // does NOT call next
      }
    }

    const r = new RouteRegistry();
    r.root.middlewares.push({
      // biome-ignore lint/suspicious/noExplicitAny: synthetic mw class
      Class: ShortCircuitMw as any,
      source: { kind: 'package', spec: 't' },
    });
    r.registerRoute('GET', '/protected', {
      handler: async () => {
        order.push('handler');
      },
    });

    const adapter = createExpressAdapter(r, fakeApp);
    const res = makeRes();
    await adapter(makeReq('GET', '/protected'), res, vi.fn());
    expect(order).toEqual(['mw']); // handler did NOT run
    expect(res.statusCode).toBe(401);
  });
});

describe('createExpressAdapter — error propagation', () => {
  it('passes thrown errors to next(err)', async () => {
    const r = new RouteRegistry();
    r.registerRoute('GET', '/boom', {
      handler: async () => {
        throw new Error('handler exploded');
      },
    });

    const adapter = createExpressAdapter(r, fakeApp);
    const next = vi.fn();
    await adapter(makeReq('GET', '/boom'), makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(next.mock.calls[0]?.[0]?.message).toBe('handler exploded');
  });

  it('passes middleware errors to next(err)', async () => {
    class FailingMw {
      readonly _kind = 'mw';
      async middleware() {
        throw new Error('mw exploded');
      }
    }

    const r = new RouteRegistry();
    r.root.middlewares.push({
      // biome-ignore lint/suspicious/noExplicitAny: synthetic mw class
      Class: FailingMw as any,
      source: { kind: 'package', spec: 't' },
    });
    r.registerRoute('GET', '/x', { handler: async () => {} });

    const adapter = createExpressAdapter(r, fakeApp);
    const next = vi.fn();
    await adapter(makeReq('GET', '/x'), makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(next.mock.calls[0]?.[0]?.message).toBe('mw exploded');
  });
});

describe('createExpressAdapter — malformed URL', () => {
  it('returns 400 on malformed encoding', async () => {
    const r = new RouteRegistry();
    r.registerRoute('GET', '/users', { handler: async () => {} });

    const adapter = createExpressAdapter(r, fakeApp);
    const res = makeRes();
    await adapter(makeReq('GET', '/users/%'), res, vi.fn());
    expect(res.statusCode).toBe(400);
  });
});

describe('createExpressAdapter — middleware instance caching', () => {
  it('reuses the same middleware instance across requests', async () => {
    let constructCount = 0;
    class CountedMw {
      readonly _kind = 'mw';
      constructor() {
        constructCount += 1;
      }
      // biome-ignore lint/suspicious/noExplicitAny: minimal mw shape for test
      async middleware(_req: any, _res: any, next: any) {
        next();
      }
    }

    const r = new RouteRegistry();
    r.root.middlewares.push({
      // biome-ignore lint/suspicious/noExplicitAny: synthetic mw class
      Class: CountedMw as any,
      source: { kind: 'package', spec: 't' },
    });
    r.registerRoute('GET', '/x', {
      handler: async (_req, res) => {
        res.end();
      },
    });

    const adapter = createExpressAdapter(r, fakeApp);
    await adapter(makeReq('GET', '/x'), makeRes(), vi.fn());
    await adapter(makeReq('GET', '/x'), makeRes(), vi.fn());
    await adapter(makeReq('GET', '/x'), makeRes(), vi.fn());

    expect(constructCount).toBe(1);
  });

  it('shares one instance across concurrent requests (no double-construct)', async () => {
    let constructCount = 0;
    class CountedMw {
      readonly _kind = 'mw';
      constructor() {
        constructCount += 1;
      }
      // biome-ignore lint/suspicious/noExplicitAny: minimal mw shape for test
      async middleware(_req: any, _res: any, next: any) {
        // Simulate small async work so several requests overlap.
        await new Promise((resolve) => setTimeout(resolve, 5));
        next();
      }
    }

    const r = new RouteRegistry();
    r.root.middlewares.push({
      // biome-ignore lint/suspicious/noExplicitAny: synthetic mw class
      Class: CountedMw as any,
      source: { kind: 'package', spec: 't' },
    });
    r.registerRoute('GET', '/x', {
      handler: async (_req, res) => {
        res.end();
      },
    });

    const adapter = createExpressAdapter(r, fakeApp);
    await Promise.all(
      Array.from({ length: 10 }, () =>
        adapter(makeReq('GET', '/x'), makeRes(), vi.fn()),
      ),
    );

    expect(constructCount).toBe(1);
  });
});

describe('createExpressAdapter — match throws non-MalformedPathError', () => {
  it('forwards unknown errors to next(err)', async () => {
    const r = new RouteRegistry();
    r.registerRoute('GET', '/users', { handler: async () => {} });
    const explosion = new Error('registry exploded');
    // biome-ignore lint/suspicious/noExplicitAny: stub for test
    (r as any).match = () => {
      throw explosion;
    };

    const adapter = createExpressAdapter(r, fakeApp);
    const next = vi.fn();
    await adapter(makeReq('GET', '/users'), makeRes(), next);
    expect(next).toHaveBeenCalledWith(explosion);
  });
});

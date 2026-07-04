/**
 * Integration tests for `ControllerManager` translation logic — driven
 * through the public `registerController` entry point. Replaces the
 * earlier unit tests against a free `translateController` function.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Transport from 'winston-transport';
import { appInstance } from '../helpers/appInstance.ts';
import AbstractController from '../modules/AbstractController.ts';
import type { IApp } from '../server.ts';
import type { MiddlewareSpec } from '../services/http/routing/middlewareNormalization.ts';
import type {
  HttpMethod,
  RouteNode,
} from '../services/http/routing/RouteNode.ts';
import { RouteRegistry } from '../services/http/routing/RouteRegistry.ts';
import SafetyNetController from '../tests/fixtures/controllers/SafetyNetController.ts';
import { getTestServerURL } from '../tests/testHelpers.ts';
import ControllerManager from './index.ts';

// ─── fixtures ────────────────────────────────────────────────────────

const fakeApp = (registry: RouteRegistry): IApp =>
  ({
    httpServer: { routeRegistry: registry },
    logger: { child: () => ({ warn() {}, verbose() {}, error() {} }) },
    // biome-ignore lint/suspicious/noExplicitAny: minimal IApp stub for translation tests
  }) as any;

const setup = () => {
  const registry = new RouteRegistry();
  const cm = new ControllerManager(fakeApp(registry));
  return { registry, cm };
};

const handlerStub = async () => {};

class FakeMw {
  readonly _kind = 'mw';
}
class OtherMw {
  readonly _kind = 'mw';
}

// Walk a registered subtree (prefixed under `/<lowercased-classname>`)
// down to a node by static segments / `:param` / `*splat`.
const findNode = (
  registry: RouteRegistry,
  controllerName: string,
  segments: string[],
): RouteNode | null => {
  let n: RouteNode | undefined = registry.root.children.get(
    controllerName.toLowerCase(),
  );
  for (const seg of segments) {
    if (!n) {
      return null;
    }
    if (seg.startsWith(':')) {
      n = n.paramChild;
    } else if (seg.startsWith('*')) {
      n = n.splatChild;
    } else {
      n = n.children.get(seg);
    }
  }
  return n ?? null;
};

// ─── routes ──────────────────────────────────────────────────────────

describe('ControllerManager — routes', () => {
  it('places a handler at the right tree position', () => {
    class C extends AbstractController {
      get routes() {
        return { post: { '/login': { handler: handlerStub } } };
      }
      static get middleware() {
        return new Map();
      }
    }
    const { registry, cm } = setup();
    cm.registerController(C);

    const node = findNode(registry, 'C', ['login']);
    expect(node?.methods?.POST?.handler).toBeDefined();
  });

  it('handles bare-function shorthand', () => {
    class C extends AbstractController {
      get routes() {
        return { get: { '/me': handlerStub } };
      }
      static get middleware() {
        return new Map();
      }
    }
    const { registry, cm } = setup();
    cm.registerController(C);

    const node = findNode(registry, 'C', ['me']);
    expect(node?.methods?.GET?.handler).toBeDefined();
  });

  it('multiple methods on the same path coexist', () => {
    class C extends AbstractController {
      get routes() {
        return {
          get: { '/users': { handler: handlerStub } },
          post: { '/users': { handler: handlerStub } },
        };
      }
      static get middleware() {
        return new Map();
      }
    }
    const { registry, cm } = setup();
    cm.registerController(C);

    const node = findNode(registry, 'C', ['users']);
    expect(node?.methods?.GET).toBeDefined();
    expect(node?.methods?.POST).toBeDefined();
  });

  it('handles deep paths with multiple params', () => {
    class C extends AbstractController {
      get routes() {
        return {
          get: {
            '/:platform/:channelID/idea/:ideaId/thumbnail-status': {
              handler: handlerStub,
            },
          },
        };
      }
      static get middleware() {
        return new Map();
      }
    }
    const { registry, cm } = setup();
    cm.registerController(C);

    const node = findNode(registry, 'C', [
      ':platform',
      ':channelID',
      'idea',
      ':ideaId',
      'thumbnail-status',
    ]);
    expect(node?.methods?.GET?.handler).toBeDefined();
  });
});

// ─── path syntax conversion ──────────────────────────────────────────

describe('ControllerManager — path syntax conversion', () => {
  it('converts {*splat} to *splat', () => {
    class C extends AbstractController {
      get routes() {
        return { get: { '/api/{*rest}': { handler: handlerStub } } };
      }
      static get middleware() {
        return new Map();
      }
    }
    const { registry, cm } = setup();
    cm.registerController(C);

    const apiNode = findNode(registry, 'C', ['api']);
    expect(apiNode?.splatChild?.segment).toBe('*rest');
    expect(apiNode?.splatChild?.methods?.GET?.handler).toBeDefined();
  });

  it('keeps existing :name params untouched', () => {
    class C extends AbstractController {
      get routes() {
        return { get: { '/users/:id': { handler: handlerStub } } };
      }
      static get middleware() {
        return new Map();
      }
    }
    const { registry, cm } = setup();
    cm.registerController(C);

    const usersNode = findNode(registry, 'C', ['users']);
    expect(usersNode?.paramChild?.segment).toBe(':id');
  });
});

// ─── middleware Map: splat scope (root-level) ────────────────────────

describe('ControllerManager — middleware Map: splat scope (root-level)', () => {
  it("'/{*splat}' attaches mws to the controller subtree root", () => {
    class C extends AbstractController {
      get routes() {
        return { get: { '/users': { handler: handlerStub } } };
      }
      static get middleware() {
        return new Map([['/{*splat}', [FakeMw as unknown as MiddlewareSpec]]]);
      }
    }
    const { registry, cm } = setup();
    cm.registerController(C);

    const subtreeRoot = registry.root.children.get('c');
    expect(subtreeRoot?.middlewares).toHaveLength(1);
    expect(subtreeRoot?.middlewares[0]?.Class).toBe(FakeMw);
  });

  it("'ALL/{*splat}' is equivalent to '/{*splat}'", () => {
    class C extends AbstractController {
      get routes() {
        return { get: { '/users': { handler: handlerStub } } };
      }
      static get middleware() {
        return new Map([
          ['ALL/{*splat}', [FakeMw as unknown as MiddlewareSpec]],
        ]);
      }
    }
    const { registry, cm } = setup();
    cm.registerController(C);

    const subtreeRoot = registry.root.children.get('c');
    expect(subtreeRoot?.middlewares).toHaveLength(1);
    expect(subtreeRoot?.middlewares[0]?.Class).toBe(FakeMw);
  });
});

// ─── middleware Map: per-handler scope ───────────────────────────────

describe('ControllerManager — middleware Map: per-handler scope', () => {
  it("'POST/login' attaches mw only to the POST handler", () => {
    class C extends AbstractController {
      get routes() {
        return {
          post: { '/login': { handler: handlerStub } },
          get: { '/login': { handler: handlerStub } },
        };
      }
      static get middleware() {
        return new Map([['POST/login', [FakeMw as unknown as MiddlewareSpec]]]);
      }
    }
    const { registry, cm } = setup();
    cm.registerController(C);

    const node = findNode(registry, 'C', ['login']);
    expect(node?.methods?.POST?.middlewares?.[0]?.Class).toBe(FakeMw);
    expect(node?.methods?.GET?.middlewares).toBeUndefined();
  });

  it("'GET/users/:id' attaches to the GET handler at /:id", () => {
    class C extends AbstractController {
      get routes() {
        return { get: { '/users/:id': { handler: handlerStub } } };
      }
      static get middleware() {
        return new Map([
          ['GET/users/:id', [FakeMw as unknown as MiddlewareSpec]],
        ]);
      }
    }
    const { registry, cm } = setup();
    cm.registerController(C);

    const idNode = findNode(registry, 'C', ['users', ':id']);
    expect(idNode?.methods?.GET?.middlewares?.[0]?.Class).toBe(FakeMw);
  });
});

// ─── middleware Map: tuple form ──────────────────────────────────────

describe('ControllerManager — middleware Map: tuple form', () => {
  it('supports [Class, params] in middleware list', () => {
    class C extends AbstractController {
      get routes() {
        return { get: { '/admin': { handler: handlerStub } } };
      }
      static get middleware() {
        return new Map([
          [
            '/{*splat}',
            [[FakeMw, { roles: ['admin'] }] as unknown as MiddlewareSpec],
          ],
        ]);
      }
    }
    const { registry, cm } = setup();
    cm.registerController(C);

    const subtreeRoot = registry.root.children.get('c');
    expect(subtreeRoot?.middlewares[0]?.Class).toBe(FakeMw);
    expect(subtreeRoot?.middlewares[0]?.params).toEqual({ roles: ['admin'] });
  });
});

// ─── handler-level middleware on route ───────────────────────────────

describe('ControllerManager — handler-level middleware on route', () => {
  it("attaches handler.middleware at the route's HandlerEntry", () => {
    class C extends AbstractController {
      get routes() {
        return {
          post: {
            '/login': {
              handler: handlerStub,
              middleware: [FakeMw, OtherMw] as unknown as MiddlewareSpec[],
            },
          },
        };
      }
      static get middleware() {
        return new Map();
      }
    }
    const { registry, cm } = setup();
    cm.registerController(C);

    const node = findNode(registry, 'C', ['login']);
    const mws = node?.methods?.POST?.middlewares;
    expect(mws).toHaveLength(2);
    expect(mws?.[0]?.Class).toBe(FakeMw);
    expect(mws?.[1]?.Class).toBe(OtherMw);
  });
});

// ─── bodyParsing pass-through ────────────────────────────────────────

describe('ControllerManager — bodyParsing pass-through', () => {
  it("propagates 'raw' bodyParsing onto the HandlerEntry", () => {
    class C extends AbstractController {
      get routes() {
        return {
          post: {
            '/webhook': { handler: handlerStub, bodyParsing: 'raw' as const },
          },
        };
      }
      static get middleware() {
        return new Map();
      }
    }
    const { registry, cm } = setup();
    cm.registerController(C);

    const node = findNode(registry, 'C', ['webhook']);
    expect(node?.methods?.POST?.bodyParsing).toBe('raw');
  });
});

// ─── handler binding ─────────────────────────────────────────────────

describe('ControllerManager — handler binding', () => {
  it('preserves the original method name in meta (despite bind)', () => {
    function postLogin() {}
    class C extends AbstractController {
      get routes() {
        return { post: { '/login': { handler: postLogin } } };
      }
      static get middleware() {
        return new Map();
      }
    }
    const { registry, cm } = setup();
    cm.registerController(C);

    const node = findNode(registry, 'C', ['login']);
    expect(node?.methods?.POST?.meta?.methodName).toBe('postLogin');
  });
});

// ─── combined production-style ───────────────────────────────────────

describe('ControllerManager — combined production-style example', () => {
  it('builds a realistic Auth-controller subtree', () => {
    class Auth extends AbstractController {
      get routes() {
        return {
          post: {
            '/login': { handler: handlerStub },
            '/register': { handler: handlerStub },
            '/logout': { handler: handlerStub },
          },
          get: {
            '/me': { handler: handlerStub },
          },
        };
      }
      static get middleware() {
        return new Map([
          ['/{*splat}', [FakeMw as unknown as MiddlewareSpec]],
          ['POST/login', [OtherMw as unknown as MiddlewareSpec]],
        ]);
      }
    }
    const { registry, cm } = setup();
    cm.registerController(Auth);

    const subtreeRoot = registry.root.children.get('auth');
    expect(subtreeRoot?.middlewares.map((m) => m.Class.name)).toEqual([
      'FakeMw',
    ]);

    const findHandler = (segs: string[], m: HttpMethod) =>
      findNode(registry, 'Auth', segs)?.methods?.[m];
    expect(findHandler(['login'], 'POST')).toBeDefined();
    expect(findHandler(['register'], 'POST')).toBeDefined();
    expect(findHandler(['logout'], 'POST')).toBeDefined();
    expect(findHandler(['me'], 'GET')).toBeDefined();
    // Per-handler middleware on POST /login
    expect(findHandler(['login'], 'POST')?.middlewares?.[0]?.Class).toBe(
      OtherMw,
    );
  });

  it('end-to-end: registry mounts subtree, match returns accumulated middlewares', () => {
    class Auth extends AbstractController {
      get routes() {
        return { post: { '/login': { handler: handlerStub } } };
      }
      static get middleware() {
        return new Map([
          ['/{*splat}', [FakeMw as unknown as MiddlewareSpec]],
          ['POST/login', [OtherMw as unknown as MiddlewareSpec]],
        ]);
      }
    }
    const { registry, cm } = setup();
    cm.registerController(Auth);

    const m = registry.match('POST', '/auth/login');
    expect(m?.entry?.handler).toBeDefined();
    expect(m?.middlewares.map((mw) => mw.Class.name)).toEqual([
      'FakeMw',
      'OtherMw',
    ]);
  });
});

// ─── cross-controller middleware bleed ───────────────────────────────

describe('ControllerManager — cross-controller middleware', () => {
  // A controller mounted at `/` has its `'/{*splat}'` middleware attached
  // to the registry root, which means it propagates to every other
  // controller's routes via tree-walk accumulation. This is consistent
  // with the prior Express-router behavior and is documented; this test
  // captures the semantic so future changes don't break it silently.
  it("a `/`-mounted controller's `/{*splat}` mw propagates to other controllers", () => {
    class Home extends AbstractController {
      get routes() {
        return { get: { '/': { handler: handlerStub } } };
      }
      static get middleware() {
        return new Map([['/{*splat}', [FakeMw as unknown as MiddlewareSpec]]]);
      }
      getHttpPath() {
        return '/';
      }
    }
    class Auth extends AbstractController {
      get routes() {
        return { post: { '/login': { handler: handlerStub } } };
      }
      static get middleware() {
        return new Map([['/{*splat}', [OtherMw as unknown as MiddlewareSpec]]]);
      }
    }

    const { registry, cm } = setup();
    cm.registerController(Home);
    cm.registerController(Auth);

    // POST /auth/login walks: root (Home's FakeMw) → /auth (Auth's OtherMw) → /login
    const m = registry.match('POST', '/auth/login');
    expect(m?.middlewares.map((mw) => mw.Class.name)).toEqual([
      'FakeMw',
      'OtherMw',
    ]);
  });
});

// ─── Mongoose validation safety net (P1o) ────────────────────────────
//
// Real HTTP behavior of the wrapped-handler catch: an escaped Mongoose
// `ValidationError` becomes a 400 with per-field detail ONLY when every failing
// model path is a field the client actually sent; renamed/internal/mixed
// failures stay an honest 500.

describe('ControllerManager — Mongoose validation safety net', () => {
  const base = '/test/safetynetcontroller';
  const post = (path: string, body?: unknown) =>
    fetch(getTestServerURL(`${base}${path}`), {
      method: 'POST',
      headers: { 'Content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  // Observe which level the safety net emits without mocking the code under
  // test: a capturing transport on the root logger records real log records
  // (child loggers funnel into it), while the existing (console) transports are
  // silenced so the intentional errors below don't clutter test output.
  interface LogRecord {
    level: string;
    message: string;
  }
  class CaptureTransport extends Transport {
    records: LogRecord[] = [];
    override log(info: LogRecord, next: () => void) {
      this.records.push({ level: info.level, message: String(info.message) });
      next();
    }
  }

  let capture: CaptureTransport;
  let silenced: Transport[] = [];
  // The Mongoose error for the fixture model — how safety-net logs are picked
  // out of the ambient request logging captured on the shared root logger.
  const netLogs = () =>
    capture.records.filter((r) =>
      /SafetyNetFixture validation/.test(r.message),
    );

  beforeAll(() => {
    appInstance.controllerManager?.registerController(
      SafetyNetController,
      'test',
    );
    capture = new CaptureTransport();
    appInstance.logger.add(capture);
    silenced = appInstance.logger.transports.filter((t) => t !== capture);
    for (const t of silenced) {
      t.silent = true;
    }
  });

  afterAll(() => {
    for (const t of silenced) {
      t.silent = false;
    }
    appInstance.logger.remove(capture);
  });

  beforeEach(() => {
    capture.records.length = 0;
  });

  it('matched field → 400 with per-field detail, warn (not error) logged', async () => {
    const res = await post('/matched', { name: 'toolong' });
    const body = await res.json();

    expect(res.status).toBe(400);
    // Only the public, client-sent path appears — value is the Mongoose message.
    expect(Object.keys(body.errors)).toEqual(['name']);
    expect(typeof body.errors.name).toBe('string');
    // Handled → warn, not error.
    expect(netLogs().map((r) => r.level)).toEqual(['warn']);
  });

  it('matched via a query-sourced key → 400 (request ∪ query union)', async () => {
    const res = await post('/queryMatched?name=toolong');
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(Object.keys(body.errors)).toEqual(['name']);
    expect(netLogs().map((r) => r.level)).toEqual(['warn']);
  });

  it('renamed field (model path not sent by client) → 500', async () => {
    const res = await post('/renamed', { name: 'toolong' });

    expect(res.status).toBe(500);
    expect(netLogs().map((r) => r.level)).toEqual(['error']);
  });

  it('internal required field failing → 500', async () => {
    const res = await post('/internal', { name: 'ok' });

    expect(res.status).toBe(500);
    expect(netLogs().map((r) => r.level)).toEqual(['error']);
  });

  it('mixed (one matched + one internal) → 500, full detail in log', async () => {
    const res = await post('/mixed', { name: 'toolong' });

    expect(res.status).toBe(500);
    // Logged as an error, carrying BOTH failing paths for the developer.
    const [entry] = netLogs();
    expect(entry?.level).toBe('error');
    expect(entry?.message).toContain('name');
    expect(entry?.message).toContain('secret');
  });

  it('no route schema → no input keys → nothing matches → 500', async () => {
    const res = await post('/noSchema');

    expect(res.status).toBe(500);
    expect(netLogs().map((r) => r.level)).toEqual(['error']);
  });

  it('route-level ValidationError still handled by the pre-handler 400 path', async () => {
    // Missing a required route field: caught before the handler runs, so the
    // framework `ValidationError` never crosses into the safety-net catch. Its
    // wire shape is the path-keyed payload (arrays), distinct from the safety
    // net's string messages.
    const res = await post('/routeValidation', {});
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(Array.isArray(body.errors.mustHave)).toBe(true);
  });

  it('headersSent → next(err): a throw after the response keeps the 200', async () => {
    const res = await post('/afterSend', { name: 'toolong' });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.saved).toBe('already');
  });
});

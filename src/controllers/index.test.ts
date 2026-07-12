/**
 * Integration tests for `ControllerManager` translation logic — driven
 * through the public `registerController` entry point. Replaces the
 * earlier unit tests against a free `translateController` function.
 */

import mongoose from 'mongoose';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import Transport from 'winston-transport';
import { appInstance } from '../helpers/appInstance.ts';
import AbstractController from '../modules/AbstractController.ts';
import type { IApp } from '../server.ts';
import type { FrameworkRequest } from '../services/http/HttpServer.ts';
import { HttpError, NotFoundError } from '../services/http/httpErrors.ts';
import type { MiddlewareSpec } from '../services/http/routing/middlewareNormalization.ts';
import type {
  HttpMethod,
  RouteNode,
} from '../services/http/routing/RouteNode.ts';
import { RouteRegistry } from '../services/http/routing/RouteRegistry.ts';
import ErrorRegistryController, {
  FakeDriverError,
  HandlerCrashError,
} from '../tests/fixtures/controllers/ErrorRegistryController.ts';
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

// A capturing winston transport used by the HTTP-level describes below to
// assert which level a handled error is logged at, without mocking the code
// under test: it records real log records off the shared root logger (child
// loggers funnel into it) while the console transports are silenced so the
// intentional errors don't clutter test output.
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

// ─── mixed-case path segments ────────────────────────────────────────
//
// The subtree assembler must key static children exactly as `RouteRegistry`
// and the matcher do (lowercase), or nested mixed-case routes become
// unreachable and method-scoped middleware silently misses its handler.

describe('ControllerManager — mixed-case path segments', () => {
  it('a deep mixed-case route matches both case variants', () => {
    class C extends AbstractController {
      get routes() {
        return { get: { '/user/Profile': { handler: handlerStub } } };
      }
      static get middleware() {
        return new Map();
      }
    }
    const { registry, cm } = setup();
    cm.registerController(C);

    // Matching is case-insensitive by design; both variants must resolve to
    // the same handler at depth ≥ 2 (mounted under `/c`).
    expect(
      registry.match('GET', '/c/user/Profile')?.entry?.handler,
    ).toBeDefined();
    expect(
      registry.match('GET', '/c/user/profile')?.entry?.handler,
    ).toBeDefined();
  });

  it("a case-variant method-scoped key ('POST/Login' vs /login) attaches", () => {
    class C extends AbstractController {
      get routes() {
        return { post: { '/login': { handler: handlerStub } } };
      }
      static get middleware() {
        return new Map([['POST/Login', [FakeMw as unknown as MiddlewareSpec]]]);
      }
    }
    const { registry, cm } = setup();
    cm.registerController(C);

    const node = findNode(registry, 'C', ['login']);
    expect(node?.methods?.POST?.middlewares?.[0]?.Class).toBe(FakeMw);
  });

  it('a nested case-variant method-scoped key attaches at depth', () => {
    class C extends AbstractController {
      get routes() {
        return { get: { '/user/Profile': { handler: handlerStub } } };
      }
      static get middleware() {
        return new Map([
          ['GET/User/profile', [FakeMw as unknown as MiddlewareSpec]],
        ]);
      }
    }
    const { registry, cm } = setup();
    cm.registerController(C);

    const node = findNode(registry, 'C', ['user', 'profile']);
    expect(node?.methods?.GET?.middlewares?.[0]?.Class).toBe(FakeMw);
  });

  it('warns when a method-scoped key targets a nonexistent route', () => {
    const registry = new RouteRegistry();
    const warn = vi.fn();
    const app = {
      httpServer: { routeRegistry: registry },
      logger: { child: () => ({ warn, verbose() {}, error() {} }) },
    } as unknown as IApp;
    const cm = new ControllerManager(app);

    class GhostRouteController extends AbstractController {
      get routes() {
        return { post: { '/login': { handler: handlerStub } } };
      }
      static get middleware() {
        return new Map([['GET/ghost', [FakeMw as unknown as MiddlewareSpec]]]);
      }
    }
    cm.registerController(GhostRouteController);

    expect(warn).toHaveBeenCalledTimes(1);
    const msg = warn.mock.calls[0]?.[0] as string;
    expect(msg).toContain('GhostRouteController');
    expect(msg).toContain('GET/ghost');
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
    // Only the public, client-sent path appears.
    expect(Object.keys(body.errors)).toEqual(['name']);
    // Message is rebuilt from the `maxlength` kind + bound, NOT the raw Mongoose
    // template — so it carries the constant (5) but never the submission.
    expect(body.errors.name).toBe('Must be at most 5 characters');
    expect(body.errors.name).not.toContain('toolong');
    // Handled → warn, not error.
    expect(netLogs().map((r) => r.level)).toEqual(['warn']);
  });

  it('maxlength overflow → message carries the bound, never the value', async () => {
    const overflow = 'S3cr3t-PII-do-not-log';
    const res = await post('/matched', { name: overflow });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.errors.name).toBe('Must be at most 5 characters');
    // The value must not appear anywhere in the serialized 400 body…
    expect(JSON.stringify(body)).not.toContain(overflow);
    // …nor in the warn log line (the Sentry/retention vector): the logged
    // error is rebuilt with the same kind-based texts (`toLoggableError`).
    const [entry] = netLogs();
    expect(entry?.level).toBe('warn');
    expect(entry?.message).toContain('Must be at most 5 characters');
    expect(entry?.message).not.toContain(overflow);
  });

  it('cast failure (string → Number) → typed message, value not echoed', async () => {
    const res = await post('/cast', { age: '+7 (900) 123-45-67' });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(Object.keys(body.errors)).toEqual(['age']);
    expect(body.errors.age).toBe('Must be a number');
    expect(JSON.stringify(body)).not.toContain('900');
    expect(netLogs().map((r) => r.level)).toEqual(['warn']);
    // The CastError template ("Cast to Number failed for value …") embeds the
    // PII — the sanitized log line must not.
    for (const r of netLogs()) {
      expect(r.message).not.toContain('900');
    }
  });

  it('enum violation → lists the allowed set, never the rejected value', async () => {
    const res = await post('/enum', { role: 'superhacker' });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(Object.keys(body.errors)).toEqual(['role']);
    expect(body.errors.role).toBe('Must be one of: admin, user');
    expect(JSON.stringify(body)).not.toContain('superhacker');
  });

  it('custom model message embedding {VALUE} is rebuilt generically', async () => {
    const secret = 'hunter2-leak-me';
    const res = await post('/custom', { nickname: secret });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(Object.keys(body.errors)).toEqual(['nickname']);
    // The model's custom string ("The nickname {VALUE} is far too long…") is
    // NOT passed through — rebuilt from the kind + bound instead.
    expect(body.errors.nickname).toBe('Must be at most 5 characters');
    expect(body.errors.nickname).not.toContain('far too long');
    expect(JSON.stringify(body)).not.toContain(secret);
    // The warn log line is sanitized too — neither the value nor the custom
    // template survives into it.
    expect(netLogs().map((r) => r.level)).toEqual(['warn']);
    for (const r of netLogs()) {
      expect(r.message).not.toContain(secret);
      expect(r.message).not.toContain('far too long');
    }
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
    // The unresolved 500 path deliberately logs the ORIGINAL error — raw
    // Mongoose message, submitted value included — sanitization applies only
    // to the handled (400) branch.
    expect(entry?.message).toContain('toolong');
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

// ─── Error-handler registry (P1p) — resolveError unit level ─────────

describe('HttpServer.resolveError — registry resolution', () => {
  const httpServer = () => {
    if (!appInstance.httpServer) {
      throw new Error('test server not booted');
    }
    return appInstance.httpServer;
  };
  const fakeReq = (request: Record<string, unknown> = {}) =>
    ({ appInfo: { request, query: {} } }) as unknown as FrameworkRequest;

  // Silence the console transports: the throwing-handler test drives a real
  // `logger.error(...)` line inside `resolveError`. The capture transport keeps
  // the root logger's `log` contract satisfied while nothing here asserts on it.
  let capture: CaptureTransport;
  let silenced: Transport[] = [];
  beforeAll(() => {
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

  const unregisters: Array<() => void> = [];
  afterEach(() => {
    for (const u of unregisters.splice(0)) {
      u();
    }
  });

  it('built-in HttpError mapper: status + { message } default body, verbose level', async () => {
    const resolved = await httpServer().resolveError(
      new NotFoundError('Boat not found'),
      fakeReq(),
    );
    expect(resolved).toEqual({
      status: 404,
      body: { message: 'Boat not found' },
      logLevel: 'verbose',
    });
  });

  it('built-in HttpError mapper: explicit body wins over { message }', async () => {
    const resolved = await httpServer().resolveError(
      new HttpError(422, 'Unprocessable', { errors: { csv: 'bad' } }),
      fakeReq(),
    );
    expect(resolved).toEqual({
      status: 422,
      body: { errors: { csv: 'bad' } },
      logLevel: 'verbose',
    });
  });

  it('built-in mongoose entry delegates to the safety-net matching (warn level)', async () => {
    const vErr = new mongoose.Error.ValidationError();
    // A raw maxlength template that echoes the value — the safety net must
    // rebuild from `kind` + `maxlength`, never pass `message` through.
    vErr.addError(
      'name',
      new mongoose.Error.ValidatorError({
        message: 'Path `name` (`SUPERSECRET`) is longer than 5',
        type: 'maxlength',
        path: 'name',
        maxlength: 5,
      } as ConstructorParameters<typeof mongoose.Error.ValidatorError>[0]),
    );
    const matched = await httpServer().resolveError(
      vErr,
      fakeReq({ name: 'x' }),
    );
    expect(matched).toEqual({
      status: 400,
      body: { errors: { name: 'Must be at most 5 characters' } },
      logLevel: 'warn',
    });
    expect(JSON.stringify(matched)).not.toContain('SUPERSECRET');
    // Same error, no matching client key → null (caller keeps the 500).
    expect(await httpServer().resolveError(vErr, fakeReq())).toBeNull();
  });

  it('unmatched error class → null', async () => {
    expect(
      await httpServer().resolveError(new Error('x'), fakeReq()),
    ).toBeNull();
  });

  it('consumer handler wins over built-ins and unregister restores them', async () => {
    const unregister = httpServer().registerErrorHandler(HttpError, () => ({
      status: 418,
      body: { message: 'teapot' },
    }));
    unregisters.push(unregister);
    const overridden = await httpServer().resolveError(
      new NotFoundError('x'),
      fakeReq(),
    );
    expect(overridden?.status).toBe(418);
    expect(overridden?.logLevel).toBe('warn'); // consumer default
    unregister();
    const restored = await httpServer().resolveError(
      new NotFoundError('x'),
      fakeReq(),
    );
    expect(restored?.status).toBe(404);
  });

  it('null return falls through to the next entry (consumer → built-in)', async () => {
    unregisters.push(httpServer().registerErrorHandler(HttpError, () => null));
    const resolved = await httpServer().resolveError(
      new NotFoundError('x'),
      fakeReq(),
    );
    expect(resolved?.status).toBe(404); // built-in still reached
  });

  it('consumer tier respects registration order', async () => {
    class OrderedError extends Error {}
    unregisters.push(
      httpServer().registerErrorHandler(OrderedError, () => null),
      httpServer().registerErrorHandler(OrderedError, () => ({
        status: 410,
        body: { message: 'second' },
      })),
    );
    const resolved = await httpServer().resolveError(
      new OrderedError(),
      fakeReq(),
    );
    expect(resolved).toEqual({
      status: 410,
      body: { message: 'second' },
      logLevel: 'warn',
    });
  });

  it('async handler result is awaited; opts.logLevel overrides the default', async () => {
    class AsyncMapped extends Error {}
    unregisters.push(
      httpServer().registerErrorHandler(
        AsyncMapped,
        async () => ({ status: 402, body: { message: 'later' } }),
        { logLevel: 'info' },
      ),
    );
    const resolved = await httpServer().resolveError(
      new AsyncMapped(),
      fakeReq(),
    );
    expect(resolved).toEqual({
      status: 402,
      body: { message: 'later' },
      logLevel: 'info',
    });
  });

  it('a throwing handler aborts the walk → null (500 at the caller)', async () => {
    class Crashy extends Error {}
    unregisters.push(
      httpServer().registerErrorHandler(Crashy, () => {
        throw new Error('handler exploded');
      }),
      // Would match if the walk continued — it must not.
      httpServer().registerErrorHandler(Crashy, () => ({
        status: 400,
        body: { message: 'unreachable' },
      })),
    );
    expect(await httpServer().resolveError(new Crashy(), fakeReq())).toBeNull();
  });
});

// ─── Error-handler registry (P1p) — over HTTP ────────────────────────

describe('Error-handler registry over HTTP', () => {
  const base = '/test/errorregistrycontroller';
  const get = (path: string) => fetch(getTestServerURL(`${base}${path}`));

  let capture: CaptureTransport;
  let silenced: Transport[] = [];
  const unregisters: Array<() => void> = [];
  const logsMatching = (re: RegExp) =>
    capture.records.filter((r) => re.test(r.message));

  beforeAll(() => {
    appInstance.controllerManager?.registerController(
      ErrorRegistryController,
      'test',
    );
    if (!appInstance.httpServer) {
      throw new Error('test server not booted');
    }
    unregisters.push(
      appInstance.httpServer.registerErrorHandler(FakeDriverError, (err) =>
        err.code === 11000
          ? { status: 409, body: { message: 'Already exists' } }
          : null,
      ),
      appInstance.httpServer.registerErrorHandler(HandlerCrashError, () => {
        throw new Error('handler exploded');
      }),
    );
    capture = new CaptureTransport();
    appInstance.logger.add(capture);
    silenced = appInstance.logger.transports.filter((t) => t !== capture);
    for (const t of silenced) {
      t.silent = true;
    }
  });

  afterAll(() => {
    for (const u of unregisters.splice(0)) {
      u();
    }
    for (const t of silenced) {
      t.silent = false;
    }
    appInstance.logger.remove(capture);
  });

  beforeEach(() => {
    capture.records.length = 0;
  });

  it('thrown NotFoundError → 404 { message }, verbose log', async () => {
    const res = await get('/notFound');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: 'Boat not found' });
    expect(logsMatching(/Boat not found/).map((r) => r.level)).toEqual([
      'verbose',
    ]);
  });

  it('HttpError base with custom body → status + body override', async () => {
    const res = await get('/customBase');
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ errors: { csv: 'row 17 malformed' } });
  });

  it('registered unowned error, matching branch → mapped 409, warn log', async () => {
    const res = await get('/unowned');
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ message: 'Already exists' });
    expect(
      logsMatching(/driver failed with code 11000/).map((r) => r.level),
    ).toEqual(['warn']);
  });

  it('registered handler returns null → falls through to 500, error log', async () => {
    const res = await get('/unownedPass');
    expect(res.status).toBe(500);
    expect(
      logsMatching(/driver failed with code 42/).map((r) => r.level),
    ).toEqual(['error']);
  });

  it('a throwing consumer handler → 500, both errors logged at error', async () => {
    const res = await get('/handlerCrash');
    expect(res.status).toBe(500);
    expect(
      logsMatching(/handler exploded|HandlerCrashError/).length,
    ).toBeGreaterThanOrEqual(1);
    expect(logsMatching(/boom/).map((r) => r.level)).toEqual(['error']);
  });

  it('plain Error stays a 500 with error log (unchanged fallback)', async () => {
    const res = await get('/plain');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      message: 'Platform error. Please check later or contact support',
    });
    expect(logsMatching(/unmapped plain error/).map((r) => r.level)).toEqual([
      'error',
    ]);
  });

  it('consumer override of a built-in wins end-to-end', async () => {
    const unregister = appInstance.httpServer?.registerErrorHandler(
      NotFoundError,
      () => ({ status: 418, body: { message: 'teapot' } }),
    );
    try {
      const res = await get('/notFound');
      expect(res.status).toBe(418);
      expect(await res.json()).toEqual({ message: 'teapot' });
    } finally {
      unregister?.();
    }
    const restored = await get('/notFound');
    expect(restored.status).toBe(404);
  });
});

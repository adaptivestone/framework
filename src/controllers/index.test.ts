/**
 * Integration tests for `ControllerManager` translation logic — driven
 * through the public `registerController` entry point. Replaces the
 * earlier unit tests against a free `translateController` function.
 */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  after,
  afterEach,
  before,
  beforeEach,
  describe,
  it,
  mock,
} from 'node:test';
import type { Response } from 'express';
import mongoose from 'mongoose';
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
import { assertCalledTimes, assertThrowsLike } from '../tests/assertions.ts';
import ErrorRegistryController, {
  FakeDriverError,
  HandlerCrashError,
} from '../tests/fixtures/controllers/ErrorRegistryController.ts';
import ParamsController from '../tests/fixtures/controllers/ParamsController.ts';
import SafetyNetController from '../tests/fixtures/controllers/SafetyNetController.ts';
import ValidationLeakController, {
  LEAK_SECRET,
} from '../tests/fixtures/controllers/ValidationLeakController.ts';
import { getTestServerURL } from '../tests/testHelpers.ts';
import ControllerManager, { compareControllerLoadOrder } from './index.ts';

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

// ─── index-first load order (finding #16) ────────────────────────────
//
// The controller discovery sort must be a consistent, antisymmetric
// comparator per ECMA-262 — index files load first (so root-level
// routes/middleware accumulate before nested ones), and among index files
// the shallower one loads first (root `Index` before nested `sub/Index`),
// by contract rather than V8 TimSort luck.

describe('ControllerManager — index-first load order', () => {
  const nonIndex = { file: 'Auth.ts' };
  const index = { file: 'Index.ts' };
  const nestedIndex = { file: 'sub/Index.ts' };

  it('sorts an index file ahead of a non-index one regardless of input order', () => {
    assert.strictEqual(
      [nonIndex, index].sort(compareControllerLoadOrder)[0],
      index,
    );
    assert.strictEqual(
      [index, nonIndex].sort(compareControllerLoadOrder)[0],
      index,
    );
  });

  it('is antisymmetric for a mixed (index vs non-index) pair', () => {
    assert.strictEqual(
      compareControllerLoadOrder(index, nonIndex),
      -compareControllerLoadOrder(nonIndex, index),
    );
  });

  it('sorts a root index file ahead of a nested one (root first, by contract)', () => {
    assert.strictEqual(
      [nestedIndex, index].sort(compareControllerLoadOrder)[0],
      index,
    );
    assert.strictEqual(
      compareControllerLoadOrder(index, nestedIndex),
      -compareControllerLoadOrder(nestedIndex, index),
    );
  });

  it('recognizes backslash-separated paths (Windows path.join output)', () => {
    const winNestedIndex = { file: 'sub\\Index.ts' };
    // Index detection must not depend on the separator…
    assert.strictEqual(
      [nonIndex, winNestedIndex].sort(compareControllerLoadOrder)[0],
      winNestedIndex,
    );
    // …and neither must the depth tiebreak (root before nested).
    assert.strictEqual(
      [winNestedIndex, index].sort(compareControllerLoadOrder)[0],
      index,
    );
    assert.strictEqual(
      compareControllerLoadOrder(index, winNestedIndex),
      -compareControllerLoadOrder(winNestedIndex, index),
    );
  });

  it('leaves the relative order of non-index files untouched (stable)', () => {
    const home = { file: 'Home.ts' };
    assert.deepStrictEqual([nonIndex, home].sort(compareControllerLoadOrder), [
      nonIndex,
      home,
    ]);
  });
});

// ─── folder prefix / mount path ──────────────────────────────────────
//
// Auto-loader sets `prefix` from the folder relative to `controllers/`
// (`admin/User.ts` → prefix `admin`). `getHttpPath()` is
// `/{prefix}/{ClassName}` fully lowercased — class name, not file name.
// Same basename under different folders is fine; mounts stay distinct.

describe('ControllerManager — folder prefix mounts', () => {
  it('a grouped external controller still overrides the same-name framework controller', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'controller-override-'));
    try {
      const groupedDir = path.join(dir, '(group)');
      await mkdir(groupedDir, { recursive: true });
      await writeFile(
        path.join(groupedDir, 'Auth.ts'),
        'export default class Auth {}\n',
        'utf8',
      );

      const registry = new RouteRegistry();
      const app = {
        ...fakeApp(registry),
        foldersConfig: { controllers: dir },
      } as IApp;
      const classes = await new ControllerManager(app).loadControllerClasses();
      const auth = classes.filter(
        ({ ControllerClass }) => ControllerClass.name === 'Auth',
      );

      assert.strictEqual(auth.length, 1);
      assert.strictEqual(auth[0]?.prefix, '(group)');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('same class name under different folders mounts at different paths', () => {
    class User extends AbstractController {
      get routes() {
        return { get: { '/': { handler: handlerStub } } };
      }
      static get middleware() {
        return new Map();
      }
    }
    const { registry, cm } = setup();
    cm.registerController(User, 'admin');
    cm.registerController(User, 'moderator');

    assert.notStrictEqual(
      registry.match('GET', '/admin/user')?.entry?.handler,
      undefined,
    );
    assert.notStrictEqual(
      registry.match('GET', '/moderator/user')?.entry?.handler,
      undefined,
    );
    // Unprefixed / wrong casing of folder is not how default mounts work.
    assert.strictEqual(registry.match('GET', '/user'), null);
  });

  it('omits parenthesized route-group folders from runtime mounts', () => {
    class Reports extends AbstractController {
      get routes() {
        return { get: { '/': { handler: handlerStub } } };
      }
      static get middleware() {
        return new Map();
      }
    }
    class Settings extends AbstractController {
      get routes() {
        return { get: { '/': { handler: handlerStub } } };
      }
      static get middleware() {
        return new Map();
      }
    }
    const { registry, cm } = setup();
    cm.registerController(Reports, '(group)');
    cm.registerController(Settings, '(group)/admin');

    assert.notStrictEqual(
      registry.match('GET', '/reports')?.entry?.handler,
      undefined,
    );
    assert.notStrictEqual(
      registry.match('GET', '/admin/settings')?.entry?.handler,
      undefined,
    );
    assert.strictEqual(registry.match('GET', '/(group)/reports'), null);
  });

  it('fails loudly when route groups collapse two controllers onto one route', () => {
    class User extends AbstractController {
      get routes() {
        return { get: { '/': { handler: handlerStub } } };
      }
      static get middleware() {
        return new Map();
      }
    }
    const { cm } = setup();
    cm.registerController(User, '(one)');

    assertThrowsLike(
      () => cm.registerController(User, '(two)'),
      /conflicting handler|already registered/i,
    );
  });

  it('compound class name and camelCase folder are fully lowercased', () => {
    class SomeBigName extends AbstractController {
      get routes() {
        return { post: { '/run': { handler: handlerStub } } };
      }
      static get middleware() {
        return new Map();
      }
    }
    class UserAdmin extends AbstractController {
      get routes() {
        return { get: { '/': { handler: handlerStub } } };
      }
      static get middleware() {
        return new Map();
      }
    }
    const { registry, cm } = setup();
    const big = cm.registerController(SomeBigName, 'someFolder');
    const admin = cm.registerController(UserAdmin, 'someFolder');

    // Canonical mount is fully lowercased (folder + class name).
    assert.strictEqual(big.getHttpPath(), '/somefolder/somebigname');
    assert.strictEqual(admin.getHttpPath(), '/somefolder/useradmin');
    assert.notStrictEqual(
      registry.match('POST', '/somefolder/somebigname/run')?.entry?.handler,
      undefined,
    );
    assert.notStrictEqual(
      registry.match('GET', '/somefolder/useradmin')?.entry?.handler,
      undefined,
    );
    // Router matching is case-insensitive today, so mixed-case URLs still hit.
    assert.notStrictEqual(
      registry.match('POST', '/someFolder/SomeBigName/run')?.entry?.handler,
      undefined,
    );
  });

  it('multi-segment folder prefix nests the full path', () => {
    class User extends AbstractController {
      get routes() {
        return { get: { '/:id': { handler: handlerStub } } };
      }
      static get middleware() {
        return new Map();
      }
    }
    const { registry, cm } = setup();
    cm.registerController(User, 'admin/sub');

    const hit = registry.match('GET', '/admin/sub/user/42');
    assert.notStrictEqual(hit?.entry?.handler, undefined);
    assert.deepStrictEqual(hit?.params, { id: '42' });
  });

  it('stores controllers keyed by prefix/name so peers do not overwrite', () => {
    class User extends AbstractController {
      get routes() {
        return { get: { '/': { handler: handlerStub } } };
      }
      static get middleware() {
        return new Map();
      }
    }
    const { cm } = setup();
    cm.registerController(User, 'admin');
    cm.registerController(User, 'moderator');

    assert.notStrictEqual(cm.controllers['admin/user'], undefined);
    assert.notStrictEqual(cm.controllers['moderator/user'], undefined);
    assert.strictEqual(cm.controllers.user, undefined);
  });
});

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
    assert.notStrictEqual(node?.methods?.POST?.handler, undefined);
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
    assert.notStrictEqual(node?.methods?.GET?.handler, undefined);
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
    assert.notStrictEqual(node?.methods?.GET, undefined);
    assert.notStrictEqual(node?.methods?.POST, undefined);
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
    assert.notStrictEqual(node?.methods?.GET?.handler, undefined);
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
    assert.strictEqual(apiNode?.splatChild?.segment, '*rest');
    assert.notStrictEqual(
      apiNode?.splatChild?.methods?.GET?.handler,
      undefined,
    );
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
    assert.strictEqual(usersNode?.paramChild?.segment, ':id');
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
    assert.strictEqual(subtreeRoot?.middlewares.length, 1);
    assert.strictEqual(subtreeRoot?.middlewares[0]?.Class, FakeMw);
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
    assert.strictEqual(subtreeRoot?.middlewares.length, 1);
    assert.strictEqual(subtreeRoot?.middlewares[0]?.Class, FakeMw);
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
    assert.strictEqual(node?.methods?.POST?.middlewares?.[0]?.Class, FakeMw);
    assert.strictEqual(node?.methods?.GET?.middlewares, undefined);
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
    assert.strictEqual(idNode?.methods?.GET?.middlewares?.[0]?.Class, FakeMw);
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
    assert.strictEqual(subtreeRoot?.middlewares[0]?.Class, FakeMw);
    assert.deepStrictEqual(subtreeRoot?.middlewares[0]?.params, {
      roles: ['admin'],
    });
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
    assert.ok(mws);
    assert.strictEqual(mws.length, 2);
    assert.strictEqual(mws?.[0]?.Class, FakeMw);
    assert.strictEqual(mws?.[1]?.Class, OtherMw);
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
    assert.strictEqual(node?.methods?.POST?.bodyParsing, 'raw');
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
    assert.strictEqual(node?.methods?.POST?.meta?.methodName, 'postLogin');
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
    assert.deepStrictEqual(
      subtreeRoot?.middlewares.map((m) => m.Class.name),
      ['FakeMw'],
    );

    const findHandler = (segs: string[], m: HttpMethod) =>
      findNode(registry, 'Auth', segs)?.methods?.[m];
    assert.notStrictEqual(findHandler(['login'], 'POST'), undefined);
    assert.notStrictEqual(findHandler(['register'], 'POST'), undefined);
    assert.notStrictEqual(findHandler(['logout'], 'POST'), undefined);
    assert.notStrictEqual(findHandler(['me'], 'GET'), undefined);
    // Per-handler middleware on POST /login
    assert.strictEqual(
      findHandler(['login'], 'POST')?.middlewares?.[0]?.Class,
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
    assert.notStrictEqual(m?.entry?.handler, undefined);
    assert.deepStrictEqual(
      m?.middlewares.map((mw) => mw.Class.name),
      ['FakeMw', 'OtherMw'],
    );
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
    assert.deepStrictEqual(
      m?.middlewares.map((mw) => mw.Class.name),
      ['FakeMw', 'OtherMw'],
    );
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
    assert.notStrictEqual(
      registry.match('GET', '/c/user/Profile')?.entry?.handler,
      undefined,
    );
    assert.notStrictEqual(
      registry.match('GET', '/c/user/profile')?.entry?.handler,
      undefined,
    );
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
    assert.strictEqual(node?.methods?.POST?.middlewares?.[0]?.Class, FakeMw);
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
    assert.strictEqual(node?.methods?.GET?.middlewares?.[0]?.Class, FakeMw);
  });

  it('warns when a method-scoped key targets a nonexistent route', () => {
    const registry = new RouteRegistry();
    const warn = mock.fn();
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

    assertCalledTimes(warn, 1);
    const msg = warn.mock.calls[0]?.arguments[0] as string;
    assert.ok(msg.includes('GhostRouteController'));
    assert.ok(msg.includes('GET/ghost'));
  });
});

// ─── Mongoose validation safety net (P1o) ────────────────────────────
//
// Real HTTP behavior of the wrapped-handler catch: an escaped Mongoose
// `ValidationError` becomes a 400 with per-field detail ONLY when every failing
// model path is a field the client actually sent; renamed/internal/mixed
// failures stay an honest 500.

// ─── schema-less route appInfo defaults (finding #14) ────────────────
//
// `appInfo.request`/`.query` are declared non-optional, but the validation
// wrapper only assigns them when a route (or a chained middleware) declares
// schemas. `PrepareAppInfo` seeds both to `{}` so a schema-less handler
// reading them can't crash to a 500 — the runtime now matches the types.
class SchemalessAppInfoController extends AbstractController {
  get routes() {
    return {
      get: {
        '/read': { handler: this.read },
      },
    };
  }

  async read(req: FrameworkRequest, res: Response) {
    return res.status(200).json({
      data: {
        query: req.appInfo.query.page ?? 'absent',
        request: req.appInfo.request.foo ?? 'absent',
        queryIsObject: typeof req.appInfo.query === 'object',
        requestIsObject: typeof req.appInfo.request === 'object',
      },
    });
  }

  static get middleware() {
    return new Map();
  }
}

describe('ControllerManager — schema-less route appInfo defaults', () => {
  const base = '/test/schemalessappinfocontroller';

  before(() => {
    appInstance.controllerManager?.registerController(
      SchemalessAppInfoController,
      'test',
    );
  });

  it('a schema-less handler reads appInfo.query/request without a 500', async () => {
    const res = await fetch(getTestServerURL(`${base}/read`));
    const body = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.data.query, 'absent');
    assert.strictEqual(body.data.request, 'absent');
    assert.strictEqual(body.data.queryIsObject, true);
    assert.strictEqual(body.data.requestIsObject, true);
  });
});

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

  before(() => {
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

  after(() => {
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

    assert.strictEqual(res.status, 400);
    // Only the public, client-sent path appears.
    assert.deepStrictEqual(Object.keys(body.errors), ['name']);
    // Message is rebuilt from the `maxlength` kind + bound, NOT the raw Mongoose
    // template — so it carries the constant (5) but never the submission.
    assert.strictEqual(body.errors.name, 'Must be at most 5 characters');
    assert.ok(!body.errors.name.includes('toolong'));
    // Handled → warn, not error.
    assert.deepStrictEqual(
      netLogs().map((r) => r.level),
      ['warn'],
    );
  });

  it('maxlength overflow → message carries the bound, never the value', async () => {
    const overflow = 'S3cr3t-PII-do-not-log';
    const res = await post('/matched', { name: overflow });
    const body = await res.json();

    assert.strictEqual(res.status, 400);
    assert.strictEqual(body.errors.name, 'Must be at most 5 characters');
    // The value must not appear anywhere in the serialized 400 body…
    assert.ok(!JSON.stringify(body).includes(overflow));
    // …nor in the warn log line (the Sentry/retention vector): the logged
    // error is rebuilt with the same kind-based texts (`toLoggableError`).
    const [entry] = netLogs();
    assert.strictEqual(entry?.level, 'warn');
    assert.ok(entry?.message.includes('Must be at most 5 characters'));
    assert.ok(!entry?.message.includes(overflow));
  });

  it('cast failure (string → Number) → typed message, value not echoed', async () => {
    const res = await post('/cast', { age: '+7 (900) 123-45-67' });
    const body = await res.json();

    assert.strictEqual(res.status, 400);
    assert.deepStrictEqual(Object.keys(body.errors), ['age']);
    assert.strictEqual(body.errors.age, 'Must be a number');
    assert.ok(!JSON.stringify(body).includes('900'));
    assert.deepStrictEqual(
      netLogs().map((r) => r.level),
      ['warn'],
    );
    // The CastError template ("Cast to Number failed for value …") embeds the
    // PII — the sanitized log line must not.
    for (const r of netLogs()) {
      assert.ok(!r.message.includes('900'));
    }
  });

  it('enum violation → lists the allowed set, never the rejected value', async () => {
    const res = await post('/enum', { role: 'superhacker' });
    const body = await res.json();

    assert.strictEqual(res.status, 400);
    assert.deepStrictEqual(Object.keys(body.errors), ['role']);
    assert.strictEqual(body.errors.role, 'Must be one of: admin, user');
    assert.ok(!JSON.stringify(body).includes('superhacker'));
  });

  it('custom model message embedding {VALUE} is rebuilt generically', async () => {
    const secret = 'hunter2-leak-me';
    const res = await post('/custom', { nickname: secret });
    const body = await res.json();

    assert.strictEqual(res.status, 400);
    assert.deepStrictEqual(Object.keys(body.errors), ['nickname']);
    // The model's custom string ("The nickname {VALUE} is far too long…") is
    // NOT passed through — rebuilt from the kind + bound instead.
    assert.strictEqual(body.errors.nickname, 'Must be at most 5 characters');
    assert.ok(!body.errors.nickname.includes('far too long'));
    assert.ok(!JSON.stringify(body).includes(secret));
    // The warn log line is sanitized too — neither the value nor the custom
    // template survives into it.
    assert.deepStrictEqual(
      netLogs().map((r) => r.level),
      ['warn'],
    );
    for (const r of netLogs()) {
      assert.ok(!r.message.includes(secret));
      assert.ok(!r.message.includes('far too long'));
    }
  });

  it('matched via a query-sourced key → 400 (request ∪ query union)', async () => {
    const res = await post('/queryMatched?name=toolong');
    const body = await res.json();

    assert.strictEqual(res.status, 400);
    assert.deepStrictEqual(Object.keys(body.errors), ['name']);
    assert.deepStrictEqual(
      netLogs().map((r) => r.level),
      ['warn'],
    );
  });

  it('renamed field (model path not sent by client) → 500', async () => {
    const res = await post('/renamed', { name: 'toolong' });

    assert.strictEqual(res.status, 500);
    assert.deepStrictEqual(
      netLogs().map((r) => r.level),
      ['error'],
    );
  });

  it('internal required field failing → 500', async () => {
    const res = await post('/internal', { name: 'ok' });

    assert.strictEqual(res.status, 500);
    assert.deepStrictEqual(
      netLogs().map((r) => r.level),
      ['error'],
    );
  });

  it('mixed (one matched + one internal) → 500, full detail in log', async () => {
    const res = await post('/mixed', { name: 'toolong' });

    assert.strictEqual(res.status, 500);
    // Logged as an error, carrying BOTH failing paths for the developer.
    const [entry] = netLogs();
    assert.strictEqual(entry?.level, 'error');
    assert.ok(entry?.message.includes('name'));
    assert.ok(entry?.message.includes('secret'));
    // The unresolved 500 path deliberately logs the ORIGINAL error — raw
    // Mongoose message, submitted value included — sanitization applies only
    // to the handled (400) branch.
    assert.ok(entry?.message.includes('toolong'));
  });

  it('no route schema → no input keys → nothing matches → 500', async () => {
    const res = await post('/noSchema');

    assert.strictEqual(res.status, 500);
    assert.deepStrictEqual(
      netLogs().map((r) => r.level),
      ['error'],
    );
  });

  it('route-level ValidationError still handled by the pre-handler 400 path', async () => {
    // Missing a required route field: caught before the handler runs, so the
    // framework `ValidationError` never crosses into the safety-net catch. Its
    // wire shape is the path-keyed payload (arrays), distinct from the safety
    // net's string messages.
    const res = await post('/routeValidation', {});
    const body = await res.json();

    assert.strictEqual(res.status, 400);
    assert.strictEqual(Array.isArray(body.errors.mustHave), true);
  });

  it('headersSent → next(err): a throw after the response keeps the 200', async () => {
    const res = await post('/afterSend', { name: 'toolong' });
    const body = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.data.saved, 'already');
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
  before(() => {
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
    assert.deepStrictEqual(resolved, {
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
    assert.deepStrictEqual(resolved, {
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
    assert.deepStrictEqual(matched, {
      status: 400,
      body: { errors: { name: 'Must be at most 5 characters' } },
      logLevel: 'warn',
    });
    assert.ok(!JSON.stringify(matched).includes('SUPERSECRET'));
    // Same error, no matching client key → null (caller keeps the 500).
    assert.strictEqual(await httpServer().resolveError(vErr, fakeReq()), null);
  });

  it('unmatched error class → null', async () => {
    assert.strictEqual(
      await httpServer().resolveError(new Error('x'), fakeReq()),
      null,
    );
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
    assert.strictEqual(overridden?.status, 418);
    assert.strictEqual(overridden?.logLevel, 'warn'); // consumer default
    unregister();
    const restored = await httpServer().resolveError(
      new NotFoundError('x'),
      fakeReq(),
    );
    assert.strictEqual(restored?.status, 404);
  });

  it('null return falls through to the next entry (consumer → built-in)', async () => {
    unregisters.push(httpServer().registerErrorHandler(HttpError, () => null));
    const resolved = await httpServer().resolveError(
      new NotFoundError('x'),
      fakeReq(),
    );
    assert.strictEqual(resolved?.status, 404); // built-in still reached
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
    assert.deepStrictEqual(resolved, {
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
    assert.deepStrictEqual(resolved, {
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
    assert.strictEqual(
      await httpServer().resolveError(new Crashy(), fakeReq()),
      null,
    );
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

  before(() => {
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

  after(() => {
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
    assert.strictEqual(res.status, 404);
    assert.deepStrictEqual(await res.json(), { message: 'Boat not found' });
    assert.deepStrictEqual(
      logsMatching(/Boat not found/).map((r) => r.level),
      ['verbose'],
    );
  });

  it('HttpError base with custom body → status + body override', async () => {
    const res = await get('/customBase');
    assert.strictEqual(res.status, 422);
    assert.deepStrictEqual(await res.json(), {
      errors: { csv: 'row 17 malformed' },
    });
  });

  it('registered unowned error, matching branch → mapped 409, warn log', async () => {
    const res = await get('/unowned');
    assert.strictEqual(res.status, 409);
    assert.deepStrictEqual(await res.json(), { message: 'Already exists' });
    assert.deepStrictEqual(
      logsMatching(/driver failed with code 11000/).map((r) => r.level),
      ['warn'],
    );
  });

  it('registered handler returns null → falls through to 500, error log', async () => {
    const res = await get('/unownedPass');
    assert.strictEqual(res.status, 500);
    assert.deepStrictEqual(
      logsMatching(/driver failed with code 42/).map((r) => r.level),
      ['error'],
    );
  });

  it('a throwing consumer handler → 500, both errors logged at error', async () => {
    const res = await get('/handlerCrash');
    assert.strictEqual(res.status, 500);
    assert.ok(logsMatching(/handler exploded|HandlerCrashError/).length >= 1);
    assert.deepStrictEqual(
      logsMatching(/boom/).map((r) => r.level),
      ['error'],
    );
  });

  it('plain Error stays a 500 with error log (unchanged fallback)', async () => {
    const res = await get('/plain');
    assert.strictEqual(res.status, 500);
    assert.deepStrictEqual(await res.json(), {
      message: 'Platform error. Please check later or contact support',
    });
    assert.deepStrictEqual(
      logsMatching(/unmapped plain error/).map((r) => r.level),
      ['error'],
    );
  });

  it('consumer override of a built-in wins end-to-end', async () => {
    const unregister = appInstance.httpServer?.registerErrorHandler(
      NotFoundError,
      () => ({ status: 418, body: { message: 'teapot' } }),
    );
    try {
      const res = await get('/notFound');
      assert.strictEqual(res.status, 418);
      assert.deepStrictEqual(await res.json(), { message: 'teapot' });
    } finally {
      unregister?.();
    }
    const restored = await get('/notFound');
    assert.strictEqual(restored.status, 404);
  });
});

// ─── Validation-phase error leak (finding #3) ────────────────────────
//
// The pre-handler validation catch must echo ONLY a framework `ValidationError`
// (per-field 400). Any other error thrown while validating — a validator that
// throws (YupDriver rethrows non-yup errors raw), or a schema no driver matches
// (ValidateService constructor throws its developer message) — is a server-side
// defect: it must become a generic 500 with the detail LOGGED, never echoed.

describe('ControllerManager — validation-phase error leak', () => {
  const base = '/test/validationleakcontroller';
  const post = (path: string, body?: unknown) =>
    fetch(getTestServerURL(`${base}${path}`), {
      method: 'POST',
      headers: { 'Content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  // Capture real log records off the shared root logger (child loggers funnel
  // in) while silencing the console transports so the intentional server errors
  // below don't clutter output.
  let capture: CaptureTransport;
  let silenced: Transport[] = [];
  const logsMatching = (re: RegExp) =>
    capture.records.filter((r) => re.test(r.message));

  before(() => {
    appInstance.controllerManager?.registerController(
      ValidationLeakController,
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
    capture.records.length = 0;
  });

  it('a validator throwing a generic Error → 500, detail logged not echoed', async () => {
    const res = await post('/throwingValidator', { field: 'x' });
    const body = await res.json();

    assert.strictEqual(res.status, 500);
    // The internal detail (a leaked DB URI in the repro) must not reach the wire.
    assert.ok(!JSON.stringify(body).includes(LEAK_SECRET));
    assert.ok(!JSON.stringify(body).includes('s3cret'));
    // Generic 500 body, consistent with the framework's other 500 sink.
    assert.deepStrictEqual(body, {
      message: 'Platform error. Please check later or contact support',
    });
    // The server-side defect IS logged at error, in full, for the developer.
    assert.deepStrictEqual(
      logsMatching(new RegExp(LEAK_SECRET)).map((r) => r.level),
      ['error'],
    );
  });

  it('a schema no driver matches → 500 (not 400), migration message not echoed', async () => {
    const res = await post('/noDriver', { anything: 1 });
    const body = await res.json();

    assert.strictEqual(res.status, 500);
    assert.ok(!JSON.stringify(body).includes('No ValidatorDriver'));
    assert.deepStrictEqual(
      logsMatching(/No ValidatorDriver/).map((r) => r.level),
      ['error'],
    );
  });
});

describe('ControllerManager — route `params:` schema', () => {
  const base = '/test/paramscontroller';
  const get = (path: string) => fetch(getTestServerURL(`${base}${path}`));
  const VALID_ID = '507f1f77bcf86cd799439011';

  before(() => {
    appInstance.controllerManager?.registerController(ParamsController, 'test');
  });

  it('a malformed path param is a 400, not a 500', async () => {
    const res = await get('/id/abc');
    const body = await res.json();

    assert.strictEqual(res.status, 400);
    assert.deepStrictEqual(body.errors, { id: ['must be a valid id'] });
  });

  it('a well-formed param reaches the handler on appInfo.params', async () => {
    const res = await get(`/id/${VALID_ID}`);
    const body = await res.json();

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(body.data.params, { id: VALID_ID });
  });

  it('the schema coerces appInfo.params while req.params stays raw strings', async () => {
    const res = await get('/count/42');
    const body = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.data.params.n, 42);
    assert.strictEqual(body.data.types.n, 'number');
    // The Express contract is untouched — raw params remain strings.
    assert.strictEqual(body.data.rawParams.n, '42');
  });

  it('a route without a params schema still exposes an empty appInfo.params', async () => {
    const res = await get('/bare/anything-at-all');
    const body = await res.json();

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(body.data.params, {});
    // The raw param is still there for a handler that wants it unvalidated.
    assert.strictEqual(body.data.rawParams.id, 'anything-at-all');
  });

  it('a client-supplied value Mongoose cannot cast is a 400, not a 500', async () => {
    const res = await get('/cast/abc');
    const body = await res.json();

    assert.strictEqual(res.status, 400);
    // Named by the PARAM (public, in the URL pattern) — never by the internal
    // model path (`ref`), and never echoing the rejected value.
    assert.deepStrictEqual(body, { errors: { id: 'Must be a valid id' } });
    assert.ok(!JSON.stringify(body).includes('ref'));
    assert.ok(!JSON.stringify(body).includes('abc'));
  });

  it('a cast failure on a server-side value stays an honest 500', async () => {
    const res = await get(`/castInternal/${VALID_ID}`);
    const body = await res.json();

    assert.strictEqual(res.status, 500);
    assert.deepStrictEqual(body, {
      message: 'Platform error. Please check later or contact support',
    });
  });

  it('separates a malformed id (400) from an absent one (404)', async () => {
    // The schema rejects before the handler runs…
    const malformed = await get('/lookup/nope');
    const malformedBody = await malformed.json();
    assert.strictEqual(malformed.status, 400);
    assert.deepStrictEqual(malformedBody.errors, {
      id: ['must be a valid id'],
    });

    // …while a well-formed id reaches the handler, which owns the 404.
    const absent = await get(`/lookup/${VALID_ID}`);
    const absentBody = await absent.json();
    assert.strictEqual(absent.status, 404);
    assert.strictEqual(absentBody.message, 'Nothing here');
  });

  it('names the failing param when a multi-param route rejects one', async () => {
    const res = await get('/multi/zzz/ok-slug');
    const body = await res.json();

    assert.strictEqual(res.status, 400);
    assert.deepStrictEqual(Object.keys(body.errors), ['group']);
  });
});

/**
 * Integration tests for `ControllerManager` translation logic — driven
 * through the public `registerController` entry point. Replaces the
 * earlier unit tests against a free `translateController` function.
 */

import { describe, expect, it } from 'vitest';
import AbstractController from '../modules/AbstractController.ts';
import type { IApp } from '../server.ts';
import type { MiddlewareSpec } from '../services/http/routing/middlewareNormalization.ts';
import type {
  HttpMethod,
  RouteNode,
} from '../services/http/routing/RouteNode.ts';
import { RouteRegistry } from '../services/http/routing/RouteRegistry.ts';
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

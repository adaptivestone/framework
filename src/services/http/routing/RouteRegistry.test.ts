import { describe, expect, it } from 'vitest';
import type { HandlerEntry, MiddlewareEntry, RouteNode } from './RouteNode.ts';
import { createNode, RouteRegistry } from './RouteRegistry.ts';

const noop: HandlerEntry['handler'] = async () => {};

const mw = (name: string): MiddlewareEntry => ({
  // biome-ignore lint/suspicious/noExplicitAny: dummy class for tests
  Class: { name } as any,
  source: { kind: 'package', spec: 'test' },
});

describe('RouteRegistry — registerRoute', () => {
  it('registers a flat route and matches it', () => {
    const r = new RouteRegistry();
    r.registerRoute('GET', '/users', { handler: noop });
    expect(r.match('GET', '/users')?.entry?.handler).toBe(noop);
  });

  it('throws on duplicate method+path', () => {
    const r = new RouteRegistry();
    r.registerRoute('GET', '/users', { handler: noop });
    expect(() => r.registerRoute('GET', '/users', { handler: noop })).toThrow();
  });

  it('different methods on the same path coexist', () => {
    const r = new RouteRegistry();
    r.registerRoute('GET', '/users', { handler: noop });
    r.registerRoute('POST', '/users', { handler: noop });
    expect(r.match('GET', '/users')?.entry?.handler).toBe(noop);
    expect(r.match('POST', '/users')?.entry?.handler).toBe(noop);
  });

  it('builds intermediate nodes when path is deep', () => {
    const r = new RouteRegistry();
    r.registerRoute('GET', '/admin/users/profile', { handler: noop });
    expect(r.match('GET', '/admin/users/profile')?.entry?.handler).toBe(noop);
  });
});

describe('RouteRegistry — registerSubtree', () => {
  it('mounts a subtree at a prefix', () => {
    const r = new RouteRegistry();
    const subtree: RouteNode = {
      segment: '',
      middlewares: [],
      children: new Map([
        [
          'login',
          {
            segment: 'login',
            middlewares: [],
            children: new Map(),
            methods: { POST: { handler: noop } },
          },
        ],
      ]),
    };
    r.registerSubtree('/auth', subtree);

    expect(r.match('POST', '/auth/login')?.entry?.handler).toBe(noop);
  });

  it('accumulates middlewares from root → subtree → leaf', () => {
    const r = new RouteRegistry();
    r.registerGlobalMiddleware(mw('Global'));

    const subtree: RouteNode = {
      segment: '',
      middlewares: [mw('Subtree')],
      children: new Map([
        [
          'login',
          {
            segment: 'login',
            middlewares: [mw('Leaf')],
            children: new Map(),
            methods: {
              POST: { handler: noop, middlewares: [mw('HandlerLevel')] },
            },
          },
        ],
      ]),
    };
    r.registerSubtree('/auth', subtree);

    const m = r.match('POST', '/auth/login');
    expect(m?.middlewares.map((entry) => entry.Class.name)).toEqual([
      'Global',
      'Subtree',
      'Leaf',
      'HandlerLevel',
    ]);
  });

  it('merges into existing node when prefix already has a registration', () => {
    const r = new RouteRegistry();
    r.registerRoute('GET', '/admin/users', { handler: noop });

    const adminSub: RouteNode = {
      segment: '',
      middlewares: [mw('AdminAuth')],
      children: new Map([
        [
          'settings',
          {
            segment: 'settings',
            middlewares: [],
            children: new Map(),
            methods: { GET: { handler: noop } },
          },
        ],
      ]),
    };
    r.registerSubtree('/admin', adminSub);

    expect(r.match('GET', '/admin/users')?.entry?.handler).toBe(noop);
    expect(r.match('GET', '/admin/settings')?.entry?.handler).toBe(noop);
    expect(
      r.match('GET', '/admin/settings')?.middlewares.map((m) => m.Class.name),
    ).toEqual(['AdminAuth']);
  });

  it('throws on conflicting handler on the same node', () => {
    const r = new RouteRegistry();
    r.registerRoute('GET', '/users', { handler: noop });

    const conflict: RouteNode = {
      segment: '',
      middlewares: [],
      children: new Map([
        [
          'users',
          {
            segment: 'users',
            middlewares: [],
            children: new Map(),
            methods: { GET: { handler: noop } },
          },
        ],
      ]),
    };
    expect(() => r.registerSubtree('/', conflict)).toThrow();
  });

  it('throws on conflicting param segment names', () => {
    const r = new RouteRegistry();
    r.registerRoute('GET', '/users/:id', { handler: noop });
    expect(() =>
      r.registerRoute('GET', '/users/:userId', { handler: noop }),
    ).toThrow(/conflicting param/);
  });
});

describe('RouteRegistry — registerGlobalMiddleware (position)', () => {
  it('appends by default', () => {
    const r = new RouteRegistry();
    r.registerGlobalMiddleware(mw('A'));
    r.registerGlobalMiddleware(mw('B'));
    expect(r.root.middlewares.map((m) => m.Class.name)).toEqual(['A', 'B']);
  });

  it('"first" prepends', () => {
    const r = new RouteRegistry();
    r.registerGlobalMiddleware(mw('A'));
    r.registerGlobalMiddleware(mw('B'), { position: 'first' });
    expect(r.root.middlewares.map((m) => m.Class.name)).toEqual(['B', 'A']);
  });

  it('"before-builtins" is treated as first', () => {
    const r = new RouteRegistry();
    r.registerGlobalMiddleware(mw('A'));
    r.registerGlobalMiddleware(mw('Sentry'), { position: 'before-builtins' });
    expect(r.root.middlewares.map((m) => m.Class.name)).toEqual([
      'Sentry',
      'A',
    ]);
  });

  it('{ before } inserts before named middleware', () => {
    const r = new RouteRegistry();
    r.registerGlobalMiddleware(mw('A'));
    r.registerGlobalMiddleware(mw('B'));
    r.registerGlobalMiddleware(mw('X'), { position: { before: 'B' } });
    expect(r.root.middlewares.map((m) => m.Class.name)).toEqual([
      'A',
      'X',
      'B',
    ]);
  });

  it('{ after } inserts after named middleware', () => {
    const r = new RouteRegistry();
    r.registerGlobalMiddleware(mw('A'));
    r.registerGlobalMiddleware(mw('B'));
    r.registerGlobalMiddleware(mw('X'), { position: { after: 'A' } });
    expect(r.root.middlewares.map((m) => m.Class.name)).toEqual([
      'A',
      'X',
      'B',
    ]);
  });

  it('{ before } throws if name not found', () => {
    const r = new RouteRegistry();
    r.registerGlobalMiddleware(mw('A'));
    expect(() =>
      r.registerGlobalMiddleware(mw('X'), { position: { before: 'NotThere' } }),
    ).toThrow(/no middleware with that class name/);
  });

  it('accepts a class shorthand (no params)', () => {
    class ShortMw {
      readonly _kind = 'mw';
    }
    const r = new RouteRegistry();
    // biome-ignore lint/suspicious/noExplicitAny: synthetic class for test
    r.registerGlobalMiddleware(ShortMw as any, {
      source: { kind: 'package', spec: 'test' },
    });
    expect(r.root.middlewares).toHaveLength(1);
    expect(r.root.middlewares[0]?.Class).toBe(ShortMw);
    expect(r.root.middlewares[0]?.params).toBeUndefined();
  });

  it('accepts a [Class, params] tuple shorthand', () => {
    class ParamsMw {
      readonly _kind = 'mw';
    }
    const r = new RouteRegistry();
    r.registerGlobalMiddleware(
      // biome-ignore lint/suspicious/noExplicitAny: synthetic class for test
      [ParamsMw as any, { max: 5 }] as const,
      { source: { kind: 'package', spec: 'test' } },
    );
    expect(r.root.middlewares[0]?.Class).toBe(ParamsMw);
    expect(r.root.middlewares[0]?.params).toEqual({ max: 5 });
  });

  it('uses placeholder source when short form is registered without source', () => {
    class NoSourceMw {
      readonly _kind = 'mw';
    }
    const r = new RouteRegistry();
    // biome-ignore lint/suspicious/noExplicitAny: synthetic class for test
    r.registerGlobalMiddleware(NoSourceMw as any);
    expect(r.root.middlewares[0]?.source).toEqual({
      kind: 'package',
      spec: '<unknown>',
    });
  });

  it('passes through a pre-built MiddlewareEntry unchanged', () => {
    const r = new RouteRegistry();
    const entry = mw('PreBuilt');
    r.registerGlobalMiddleware(entry);
    expect(r.root.middlewares[0]).toBe(entry);
  });
});

describe('RouteRegistry — flatten', () => {
  it('produces one entry per (method, path) leaf', () => {
    const r = new RouteRegistry();
    r.registerRoute('GET', '/users', { handler: noop });
    r.registerRoute('POST', '/users', { handler: noop });
    r.registerRoute('GET', '/posts', { handler: noop });

    const flat = r.flatten();
    expect(flat).toHaveLength(3);
    expect(flat.map((f) => `${f.method} ${f.path}`).sort()).toEqual([
      'GET /posts',
      'GET /users',
      'POST /users',
    ]);
  });

  it('includes accumulated middlewares per leaf', () => {
    const r = new RouteRegistry();
    r.registerGlobalMiddleware(mw('Global'));

    const subtree: RouteNode = {
      segment: '',
      middlewares: [mw('Admin')],
      children: new Map([
        [
          'users',
          {
            segment: 'users',
            middlewares: [],
            children: new Map(),
            methods: { GET: { handler: noop } },
          },
        ],
      ]),
    };
    r.registerSubtree('/admin', subtree);

    const flat = r.flatten();
    expect(flat).toHaveLength(1);
    expect(flat[0]?.middlewares.map((m) => m.Class.name)).toEqual([
      'Global',
      'Admin',
    ]);
  });

  it('inherits bodyParsing leaf-wins', () => {
    const r = new RouteRegistry();
    const subtree: RouteNode = {
      segment: '',
      middlewares: [],
      bodyParsing: 'raw',
      children: new Map([
        [
          'stripe',
          {
            segment: 'stripe',
            middlewares: [],
            children: new Map(),
            methods: { POST: { handler: noop } },
          },
        ],
      ]),
    };
    r.registerSubtree('/webhooks', subtree);

    const flat = r.flatten();
    expect(flat[0]?.bodyParsing).toBe('raw');
  });
});

describe('RouteRegistry — walk', () => {
  it('visits every node depth-first with full paths', () => {
    const r = new RouteRegistry();
    r.registerRoute('GET', '/admin/users', { handler: noop });
    r.registerRoute('GET', '/admin/posts', { handler: noop });

    const visited: string[] = [];
    r.walk((_node, fullPath) => {
      visited.push(fullPath);
    });
    expect(visited).toEqual(
      expect.arrayContaining(['/', '/admin', '/admin/users', '/admin/posts']),
    );
  });
});

describe('RouteRegistry — match options', () => {
  it('setMatchOptions affects subsequent matches (case sensitivity)', () => {
    const r = new RouteRegistry();
    r.registerRoute('GET', '/users', { handler: noop });

    expect(r.match('GET', '/Users')?.entry?.handler).toBe(noop); // insensitive default

    r.setMatchOptions({ caseSensitive: true });
    expect(r.match('GET', '/Users')).toBeNull();
    expect(r.match('GET', '/users')?.entry?.handler).toBe(noop);
  });

  it('setMatchOptions affects subsequent matches (trailing slash)', () => {
    const r = new RouteRegistry();
    r.registerRoute('GET', '/users', { handler: noop });

    expect(r.match('GET', '/users/')?.entry?.handler).toBe(noop); // lenient default

    r.setMatchOptions({ strictTrailingSlash: true });
    expect(r.match('GET', '/users/')).toBeNull();
    expect(r.match('GET', '/users')?.entry?.handler).toBe(noop);
  });
});

describe('RouteRegistry — registerRoute with splat / param syntax', () => {
  it('registers a splat route via registerRoute', () => {
    const r = new RouteRegistry();
    r.registerRoute('GET', '/api/*rest', { handler: noop });

    const m = r.match('GET', '/api/v1/users/42');
    expect(m?.entry?.handler).toBe(noop);
    expect(m?.params).toEqual({ rest: 'v1/users/42' });
  });

  it('registers OPTIONS handler', () => {
    const r = new RouteRegistry();
    r.registerRoute('OPTIONS', '/users', { handler: noop });
    expect(r.match('OPTIONS', '/users')?.entry?.handler).toBe(noop);
  });

  it('a path more specific than registered returns null (404)', () => {
    const r = new RouteRegistry();
    r.registerRoute('GET', '/users/me', { handler: noop });
    expect(r.match('GET', '/users/me/extra')).toBeNull();
  });

  it('throws when registering routes nested under a splat segment', () => {
    const r = new RouteRegistry();
    expect(() =>
      r.registerRoute('GET', '/api/*rest/foo', { handler: noop }),
    ).toThrow(/cannot register a child segment.*under a splat segment/);
  });
});

describe('RouteRegistry — subtree composition (the P1b test plan check)', () => {
  it('multi-level walk + middleware accumulation matches the documented order', () => {
    const r = new RouteRegistry();
    r.registerGlobalMiddleware(mw('GlobalA'));
    r.registerGlobalMiddleware(mw('GlobalB'));

    const adminSubtree: RouteNode = createNode('');
    adminSubtree.middlewares.push(mw('AdminAuth'));
    const usersNode = createNode('users');
    usersNode.middlewares.push(mw('UsersScope'));
    const idNode = createNode(':id');
    idNode.methods = {
      GET: { handler: noop, middlewares: [mw('PerHandler')] },
    };
    usersNode.paramChild = idNode;
    adminSubtree.children.set('users', usersNode);
    r.registerSubtree('/admin', adminSubtree);

    const m = r.match('GET', '/admin/users/123');
    expect(m).not.toBeNull();
    expect(m?.params).toEqual({ id: '123' });
    expect(m?.middlewares.map((entry) => entry.Class.name)).toEqual([
      'GlobalA',
      'GlobalB',
      'AdminAuth',
      'UsersScope',
      'PerHandler',
    ]);
  });
});

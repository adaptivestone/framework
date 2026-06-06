import { describe, expect, it } from 'vitest';
import type { HandlerEntry, MiddlewareEntry, RouteNode } from './RouteNode.ts';
import { createNode, RouteRegistry } from './RouteRegistry.ts';

const noop: HandlerEntry['handler'] = async () => {};

const mw = (name: string): MiddlewareEntry => ({
  // biome-ignore lint/suspicious/noExplicitAny: dummy class for tests
  Class: { name } as any,
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
    r.root.middlewares.push(mw('Global'));

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

  it('ad-hoc registerRoute then registerSubtree on overlapping prefix — subtree mw applies to the prior route', () => {
    const r = new RouteRegistry();
    // Ad-hoc registration first — bare route, no middleware.
    r.registerRoute('GET', '/admin/users', { handler: noop });

    // Subtree mounted at the same prefix later — its middlewares should
    // apply to the prior ad-hoc route too (mergeNode appends).
    const adminSub: RouteNode = {
      segment: '',
      middlewares: [mw('AdminAuth')],
      children: new Map(),
    };
    r.registerSubtree('/admin', adminSub);

    expect(
      r.match('GET', '/admin/users')?.middlewares.map((m) => m.Class.name),
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

  it('throws on conflicting param segment names (same method)', () => {
    const r = new RouteRegistry();
    r.registerRoute('GET', '/users/:id', { handler: noop });
    expect(() =>
      r.registerRoute('GET', '/users/:userId', { handler: noop }),
    ).toThrow();
  });

  it('different param names for different methods at the same position', () => {
    const r = new RouteRegistry();
    const putHandler: HandlerEntry['handler'] = async () => 'put';
    const postHandler: HandlerEntry['handler'] = async () => 'post';

    r.registerRoute('PUT', '/:slug', { handler: putHandler });
    r.registerRoute('POST', '/:event', { handler: postHandler });

    const putMatch = r.match('PUT', '/my-value');
    expect(putMatch?.params).toEqual({ slug: 'my-value' });

    const postMatch = r.match('POST', '/my-value');
    expect(postMatch?.params).toEqual({ event: 'my-value' });
  });

  it('different param names at multiple depths', () => {
    const r = new RouteRegistry();
    r.registerRoute('PUT', '/:model/:slug', {
      handler: async () => 'put',
    });
    r.registerRoute('POST', '/:type/:event', {
      handler: async () => 'post',
    });

    const putMatch = r.match('PUT', '/foo/bar');
    expect(putMatch?.params).toEqual({ model: 'foo', slug: 'bar' });

    const postMatch = r.match('POST', '/foo/bar');
    expect(postMatch?.params).toEqual({ type: 'foo', event: 'bar' });
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
    r.root.middlewares.push(mw('Global'));

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

  it('descends into paramChild and splatChild', () => {
    const r = new RouteRegistry();
    r.registerRoute('GET', '/users/:id', { handler: noop });
    r.registerRoute('GET', '/api/*rest', { handler: noop });

    const visited: string[] = [];
    r.walk((_node, fullPath) => {
      visited.push(fullPath);
    });
    expect(visited).toEqual(
      expect.arrayContaining(['/users', '/users/:id', '/api', '/api/*rest']),
    );
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
    r.root.middlewares.push(mw('GlobalA'));
    r.root.middlewares.push(mw('GlobalB'));

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

describe('RouteRegistry — per-method paramNames via registerSubtree + mergeNode', () => {
  it('two subtrees merged at the same prefix with different param names per method', () => {
    // Simulates two controllers mounted at /api:
    //   Controller A: GET /:id
    //   Controller B: POST /:slug
    const r = new RouteRegistry();

    const getHandler: HandlerEntry['handler'] = async () => 'get';
    const postHandler: HandlerEntry['handler'] = async () => 'post';

    // Subtree A — GET /:id
    const subtreeA: RouteNode = createNode('');
    const paramNodeA = createNode(':id');
    paramNodeA.methods = { GET: { handler: getHandler, paramNames: ['id'] } };
    subtreeA.paramChild = paramNodeA;

    // Subtree B — POST /:slug
    const subtreeB: RouteNode = createNode('');
    const paramNodeB = createNode(':slug');
    paramNodeB.methods = {
      POST: { handler: postHandler, paramNames: ['slug'] },
    };
    subtreeB.paramChild = paramNodeB;

    r.registerSubtree('/api', subtreeA);
    r.registerSubtree('/api', subtreeB);

    const getMatch = r.match('GET', '/api/hello');
    expect(getMatch?.entry?.handler).toBe(getHandler);
    expect(getMatch?.params).toEqual({ id: 'hello' });

    const postMatch = r.match('POST', '/api/hello');
    expect(postMatch?.entry?.handler).toBe(postHandler);
    expect(postMatch?.params).toEqual({ slug: 'hello' });
  });

  it('two subtrees with different param names at depth 1, different static children at depth 2', () => {
    // Simulates one controller with:
    //   PUT  /:slug/details
    //   POST /:event/info
    const r = new RouteRegistry();

    const putHandler: HandlerEntry['handler'] = async () => 'put';
    const postHandler: HandlerEntry['handler'] = async () => 'post';

    // Subtree with PUT /:slug/details
    const subtreeA: RouteNode = createNode('');
    const paramA = createNode(':slug');
    const detailsNode = createNode('details');
    detailsNode.methods = {
      PUT: { handler: putHandler, paramNames: ['slug'] },
    };
    paramA.children.set('details', detailsNode);
    subtreeA.paramChild = paramA;

    // Subtree with POST /:event/info
    const subtreeB: RouteNode = createNode('');
    const paramB = createNode(':event');
    const infoNode = createNode('info');
    infoNode.methods = {
      POST: { handler: postHandler, paramNames: ['event'] },
    };
    paramB.children.set('info', infoNode);
    subtreeB.paramChild = paramB;

    r.registerSubtree('/api', subtreeA);
    r.registerSubtree('/api', subtreeB);

    const putMatch = r.match('PUT', '/api/my-article/details');
    expect(putMatch?.entry?.handler).toBe(putHandler);
    expect(putMatch?.params).toEqual({ slug: 'my-article' });

    const postMatch = r.match('POST', '/api/my-event/info');
    expect(postMatch?.entry?.handler).toBe(postHandler);
    expect(postMatch?.params).toEqual({ event: 'my-event' });
  });

  it('merged param nodes: 405 still lists all methods from both controllers', () => {
    const r = new RouteRegistry();

    const getHandler: HandlerEntry['handler'] = async () => 'get';
    const postHandler: HandlerEntry['handler'] = async () => 'post';

    const subtreeA: RouteNode = createNode('');
    const pA = createNode(':id');
    pA.methods = { GET: { handler: getHandler, paramNames: ['id'] } };
    subtreeA.paramChild = pA;

    const subtreeB: RouteNode = createNode('');
    const pB = createNode(':slug');
    pB.methods = { POST: { handler: postHandler, paramNames: ['slug'] } };
    subtreeB.paramChild = pB;

    r.registerSubtree('/api', subtreeA);
    r.registerSubtree('/api', subtreeB);

    // DELETE should 405 with allowed methods listing both GET and POST
    const deleteMatch = r.match('DELETE', '/api/hello');
    expect(deleteMatch?.entry).toBeNull();
    expect(deleteMatch?.allowedMethods).toEqual(
      expect.arrayContaining(['GET', 'POST']),
    );
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertMatches,
  assertThrowsLike,
  pattern,
} from '../../../tests/assertions.ts';
import type { HandlerEntry, MiddlewareEntry, RouteNode } from './RouteNode.ts';
import { createNode, RouteRegistry } from './RouteRegistry.ts';

const noop: HandlerEntry['handler'] = async () => {};

const mw = (name: string): MiddlewareEntry => ({
  // biome-ignore lint/suspicious/noExplicitAny: dummy class for tests
  Class: { name } as any,
});

describe('RouteRegistry — case-folded static segments (doc 23)', () => {
  const noop2: HandlerEntry['handler'] = async () => {};

  it('folds case-only-different segments onto one node (different methods coexist)', () => {
    const r = new RouteRegistry();
    r.registerRoute('GET', '/Admin', { handler: noop });
    r.registerRoute('POST', '/admin', { handler: noop2 });

    assert.strictEqual(r.root.children.size, 1); // one node, not two
    assert.strictEqual(r.match('GET', '/admin')?.entry?.handler, noop);
    assert.strictEqual(r.match('POST', '/Admin')?.entry?.handler, noop2);
  });

  it('throws when the same method is registered under a case-only-different segment', () => {
    const r = new RouteRegistry();
    r.registerRoute('GET', '/Admin', { handler: noop });
    assertThrowsLike(() => r.registerRoute('GET', '/admin', { handler: noop }));
  });
});

describe('RouteRegistry — registerRoute', () => {
  it('registers a flat route and matches it', () => {
    const r = new RouteRegistry();
    r.registerRoute('GET', '/users', { handler: noop });
    assert.strictEqual(r.match('GET', '/users')?.entry?.handler, noop);
  });

  it('throws on duplicate method+path', () => {
    const r = new RouteRegistry();
    r.registerRoute('GET', '/users', { handler: noop });
    assertThrowsLike(() => r.registerRoute('GET', '/users', { handler: noop }));
  });

  it('different methods on the same path coexist', () => {
    const r = new RouteRegistry();
    r.registerRoute('GET', '/users', { handler: noop });
    r.registerRoute('POST', '/users', { handler: noop });
    assert.strictEqual(r.match('GET', '/users')?.entry?.handler, noop);
    assert.strictEqual(r.match('POST', '/users')?.entry?.handler, noop);
  });

  it('builds intermediate nodes when path is deep', () => {
    const r = new RouteRegistry();
    r.registerRoute('GET', '/admin/users/profile', { handler: noop });
    assert.strictEqual(
      r.match('GET', '/admin/users/profile')?.entry?.handler,
      noop,
    );
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

    assert.strictEqual(r.match('POST', '/auth/login')?.entry?.handler, noop);
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
    assert.deepStrictEqual(
      m?.middlewares.map((entry) => entry.Class.name),
      ['Global', 'Subtree', 'Leaf', 'HandlerLevel'],
    );
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

    assert.strictEqual(r.match('GET', '/admin/users')?.entry?.handler, noop);
    assert.strictEqual(r.match('GET', '/admin/settings')?.entry?.handler, noop);
    assert.deepStrictEqual(
      r.match('GET', '/admin/settings')?.middlewares.map((m) => m.Class.name),
      ['AdminAuth'],
    );
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

    assert.deepStrictEqual(
      r.match('GET', '/admin/users')?.middlewares.map((m) => m.Class.name),
      ['AdminAuth'],
    );
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
    assertThrowsLike(() => r.registerSubtree('/', conflict));
  });

  it('throws on conflicting param segment names (same method)', () => {
    const r = new RouteRegistry();
    r.registerRoute('GET', '/users/:id', { handler: noop });
    assertThrowsLike(() =>
      r.registerRoute('GET', '/users/:userId', { handler: noop }),
    );
  });

  it('different param names for different methods at the same position', () => {
    const r = new RouteRegistry();
    const putHandler: HandlerEntry['handler'] = async () => 'put';
    const postHandler: HandlerEntry['handler'] = async () => 'post';

    r.registerRoute('PUT', '/:slug', { handler: putHandler });
    r.registerRoute('POST', '/:event', { handler: postHandler });

    const putMatch = r.match('PUT', '/my-value');
    assert.deepStrictEqual(putMatch?.params, { slug: 'my-value' });

    const postMatch = r.match('POST', '/my-value');
    assert.deepStrictEqual(postMatch?.params, { event: 'my-value' });
  });

  it('flatten gives BOTH differently-named param siblings the accumulated chain', () => {
    // The runtime contract the route-type codegen depends on: two same-depth
    // param siblings with DIFFERENT names collapse onto one node (first name
    // wins), but `flatten()` must still attach the controller-wide chain to
    // BOTH leaves. If the collapsed sibling (`POST`, whose `:event` reused the
    // `:slug` node) lost its chain here, codegen would emit an empty middleware
    // chain for it. Controller-wide `/{*splat}` middleware lands on the mount
    // node (method ALL), so it accumulates root → leaf to every descendant.
    const r = new RouteRegistry();
    const subtree: RouteNode = {
      segment: '',
      middlewares: [mw('GetUserByToken'), mw('Auth')],
      children: new Map(),
      paramChild: {
        segment: ':slug',
        middlewares: [],
        children: new Map(),
        methods: { PUT: { handler: noop } },
      },
    };
    r.registerSubtree('/', subtree);
    // A differently-named sibling method collapses onto the same `:slug` node.
    r.registerRoute('POST', '/:event', { handler: noop });

    const byMethod = Object.fromEntries(
      r
        .flatten()
        .map((f) => [f.method, f.middlewares.map((m) => m.Class.name)]),
    );
    assert.deepStrictEqual(byMethod.PUT, ['GetUserByToken', 'Auth']);
    assert.deepStrictEqual(byMethod.POST, ['GetUserByToken', 'Auth']);
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
    assert.deepStrictEqual(putMatch?.params, { model: 'foo', slug: 'bar' });

    const postMatch = r.match('POST', '/foo/bar');
    assert.deepStrictEqual(postMatch?.params, { type: 'foo', event: 'bar' });
  });

  it('prepends mount params through static, param, and splat descendants', () => {
    const r = new RouteRegistry();
    const subtree: RouteNode = {
      segment: '',
      middlewares: [],
      children: new Map([
        [
          'fixed',
          {
            segment: 'fixed',
            middlewares: [],
            children: new Map(),
            methods: {
              GET: { handler: noop, paramNames: ['fixedId'] },
            },
          },
        ],
      ]),
      paramChild: {
        segment: ':item',
        middlewares: [],
        children: new Map(),
        methods: { POST: { handler: noop, paramNames: ['item'] } },
      },
      splatChild: {
        segment: '*rest',
        middlewares: [],
        children: new Map(),
        methods: { PUT: { handler: noop, paramNames: ['rest'] } },
      },
    };

    r.registerSubtree('/:tenant', subtree);

    assert.deepStrictEqual(r.match('GET', '/acme/fixed')?.params, {
      tenant: 'acme',
      fixedId: undefined,
    });
    assert.deepStrictEqual(r.match('POST', '/acme/widget')?.params, {
      tenant: 'acme',
      item: 'widget',
    });
    assert.deepStrictEqual(r.match('PUT', '/acme/a/b')?.params, {
      tenant: 'acme',
      rest: 'a/b',
    });
    assert.ok(
      r
        .flatten()
        .map((entry) => entry.path)
        .includes('/:tenant/*rest'),
    );
  });

  it('merges splat subtrees and ignores sparse method entries', () => {
    const r = new RouteRegistry();
    r.registerRoute('GET', '/api/*rest', { handler: noop });
    // Ensure the child already exists so registerSubtree() merges its sparse
    // method map instead of attaching the node wholesale.
    r.registerRoute('GET', '/api/sparse', { handler: noop });
    const sparseMethods = {
      DELETE: undefined,
    } as unknown as RouteNode['methods'];
    const subtree: RouteNode = {
      segment: '',
      middlewares: [],
      children: new Map([
        [
          'sparse',
          {
            segment: 'sparse',
            middlewares: [],
            children: new Map(),
            methods: sparseMethods,
          },
        ],
        [
          'flat-sparse',
          {
            segment: 'flat-sparse',
            middlewares: [],
            children: new Map(),
            methods: sparseMethods,
          },
        ],
      ]),
      splatChild: {
        segment: '*tail',
        middlewares: [],
        children: new Map(),
        methods: { POST: { handler: noop } },
      },
    };

    r.registerSubtree('/api', subtree);

    assert.strictEqual(r.match('GET', '/api/one')?.entry.handler, noop);
    assert.strictEqual(r.match('POST', '/api/one')?.entry.handler, noop);
    assert.strictEqual(r.match('GET', '/api/sparse')?.entry.handler, noop);
    assert.strictEqual(
      r.flatten().some((entry) => entry.method === 'DELETE'),
      false,
    );
  });
});

describe('RouteRegistry — flatten', () => {
  it('produces one entry per (method, path) leaf', () => {
    const r = new RouteRegistry();
    r.registerRoute('GET', '/users', { handler: noop });
    r.registerRoute('POST', '/users', { handler: noop });
    r.registerRoute('GET', '/posts', { handler: noop });

    const flat = r.flatten();
    assert.strictEqual(flat.length, 3);
    assert.deepStrictEqual(flat.map((f) => `${f.method} ${f.path}`).sort(), [
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
    assert.strictEqual(flat.length, 1);
    assert.deepStrictEqual(
      flat[0]?.middlewares.map((m) => m.Class.name),
      ['Global', 'Admin'],
    );
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
    assert.strictEqual(flat[0]?.bodyParsing, 'raw');
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
    assertMatches(
      visited,
      pattern.arrayContaining(['/', '/admin', '/admin/users', '/admin/posts']),
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
    assertMatches(
      visited,
      pattern.arrayContaining(['/users', '/users/:id', '/api', '/api/*rest']),
    );
  });
});

describe('RouteRegistry — registerRoute with splat / param syntax', () => {
  it('registers a splat route via registerRoute', () => {
    const r = new RouteRegistry();
    r.registerRoute('GET', '/api/*rest', { handler: noop });

    const m = r.match('GET', '/api/v1/users/42');
    assert.strictEqual(m?.entry?.handler, noop);
    assert.deepStrictEqual(m?.params, { rest: 'v1/users/42' });
  });

  it('registers OPTIONS handler', () => {
    const r = new RouteRegistry();
    r.registerRoute('OPTIONS', '/users', { handler: noop });
    assert.strictEqual(r.match('OPTIONS', '/users')?.entry?.handler, noop);
  });

  it('a path more specific than registered returns null (404)', () => {
    const r = new RouteRegistry();
    r.registerRoute('GET', '/users/me', { handler: noop });
    assert.strictEqual(r.match('GET', '/users/me/extra'), null);
  });

  it('throws when registering routes nested under a splat segment', () => {
    const r = new RouteRegistry();
    assertThrowsLike(
      () => r.registerRoute('GET', '/api/*rest/foo', { handler: noop }),
      /cannot register a child segment.*under a splat segment/,
    );
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
    assert.notStrictEqual(m, null);
    assert.deepStrictEqual(m?.params, { id: '123' });
    assert.deepStrictEqual(
      m?.middlewares.map((entry) => entry.Class.name),
      ['GlobalA', 'GlobalB', 'AdminAuth', 'UsersScope', 'PerHandler'],
    );
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
    assert.strictEqual(getMatch?.entry?.handler, getHandler);
    assert.deepStrictEqual(getMatch?.params, { id: 'hello' });

    const postMatch = r.match('POST', '/api/hello');
    assert.strictEqual(postMatch?.entry?.handler, postHandler);
    assert.deepStrictEqual(postMatch?.params, { slug: 'hello' });
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
    assert.strictEqual(putMatch?.entry?.handler, putHandler);
    assert.deepStrictEqual(putMatch?.params, { slug: 'my-article' });

    const postMatch = r.match('POST', '/api/my-event/info');
    assert.strictEqual(postMatch?.entry?.handler, postHandler);
    assert.deepStrictEqual(postMatch?.params, { event: 'my-event' });
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
    assert.strictEqual(deleteMatch?.entry, null);
    assertMatches(
      deleteMatch?.allowedMethods,
      pattern.arrayContaining(['GET', 'POST']),
    );
  });
});

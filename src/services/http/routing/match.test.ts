import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertMatches,
  assertThrowsLike,
  pattern,
} from '../../../tests/assertions.ts';
import { MalformedPathError, match } from './match.ts';
import type { HandlerEntry, MiddlewareEntry } from './RouteNode.ts';
import { createNode, RouteRegistry } from './RouteRegistry.ts';

const noop: HandlerEntry['handler'] = async () => {};

const mw = (name: string): MiddlewareEntry => ({
  // biome-ignore lint/suspicious/noExplicitAny: dummy class for tests
  Class: { name } as any,
});

describe('match — static segments', () => {
  it('matches an exact path', () => {
    const root = createNode('');
    const users = createNode('users');
    users.methods = { GET: { handler: noop } };
    root.children.set('users', users);

    const m = match(root, 'GET', '/users');
    assert.strictEqual(m?.entry?.handler, noop);
    assert.deepStrictEqual(m?.params, {});
  });

  it('returns null for a non-existent path', () => {
    const root = createNode('');
    const users = createNode('users');
    users.methods = { GET: { handler: noop } };
    root.children.set('users', users);

    assert.strictEqual(match(root, 'GET', '/posts'), null);
  });

  it('matches the root path "/"', () => {
    const root = createNode('');
    root.methods = { GET: { handler: noop } };

    assert.strictEqual(match(root, 'GET', '/')?.entry?.handler, noop);
  });

  it('matches deep static paths', () => {
    const root = createNode('');
    const admin = createNode('admin');
    const users = createNode('users');
    const profile = createNode('profile');
    profile.methods = { GET: { handler: noop } };
    users.children.set('profile', profile);
    admin.children.set('users', users);
    root.children.set('admin', admin);

    assert.strictEqual(
      match(root, 'GET', '/admin/users/profile')?.entry?.handler,
      noop,
    );
  });
});

describe('match — param segments', () => {
  it('extracts a param value', () => {
    const root = createNode('');
    const users = createNode('users');
    const idNode = createNode(':id');
    idNode.methods = { GET: { handler: noop } };
    users.paramChild = idNode;
    root.children.set('users', users);

    const m = match(root, 'GET', '/users/42');
    assert.strictEqual(m?.entry?.handler, noop);
    assert.deepStrictEqual(m?.params, { id: '42' });
  });

  it('uses handler paramNames to derive param keys', () => {
    const root = createNode('');
    const paramNode = createNode(':slug');
    const putHandler: HandlerEntry['handler'] = async () => 'put';
    const postHandler: HandlerEntry['handler'] = async () => 'post';
    paramNode.methods = {
      PUT: { handler: putHandler, paramNames: ['slug'] },
      POST: { handler: postHandler, paramNames: ['event'] },
    };
    root.paramChild = paramNode;

    const putMatch = match(root, 'PUT', '/my-value');
    assert.deepStrictEqual(putMatch?.params, { slug: 'my-value' });

    const postMatch = match(root, 'POST', '/my-value');
    assert.deepStrictEqual(postMatch?.params, { event: 'my-value' });
  });

  it('falls back to tree segment name when paramNames is not set', () => {
    const root = createNode('');
    const paramNode = createNode(':id');
    paramNode.methods = { GET: { handler: noop } };
    root.paramChild = paramNode;

    const m = match(root, 'GET', '/42');
    assert.deepStrictEqual(m?.params, { id: '42' });
  });

  it('static beats param when both could match', () => {
    const root = createNode('');
    const users = createNode('users');
    const me = createNode('me');
    me.methods = { GET: { handler: noop } };
    const idNode = createNode(':id');
    idNode.methods = { GET: { handler: async () => 'param' } };
    users.children.set('me', me);
    users.paramChild = idNode;
    root.children.set('users', users);

    const staticMatch = match(root, 'GET', '/users/me');
    const paramMatch = match(root, 'GET', '/users/42');
    assert.deepStrictEqual(staticMatch?.params, {});
    assert.deepStrictEqual(paramMatch?.params, { id: '42' });
  });
});

describe('match — splat segments', () => {
  it('captures the rest of the path', () => {
    const root = createNode('');
    const api = createNode('api');
    const splat = createNode('*rest');
    splat.methods = { GET: { handler: noop } };
    api.splatChild = splat;
    root.children.set('api', api);

    const m = match(root, 'GET', '/api/v1/users/42');
    assert.deepStrictEqual(m?.params, { rest: 'v1/users/42' });
  });

  it('captures deeply nested paths under a splat', () => {
    const root = createNode('');
    const api = createNode('api');
    const splat = createNode('*rest');
    splat.methods = { GET: { handler: noop } };
    api.splatChild = splat;
    root.children.set('api', api);

    const deep = '/api/a/b/c/d/e/f/g/h/i/j';
    const m = match(root, 'GET', deep);
    assert.deepStrictEqual(m?.params, { rest: 'a/b/c/d/e/f/g/h/i/j' });
  });

  it('static and param beat splat', () => {
    const root = createNode('');
    const api = createNode('api');
    const v1 = createNode('v1');
    v1.methods = { GET: { handler: async () => 'static' } };
    const splat = createNode('*rest');
    splat.methods = { GET: { handler: async () => 'splat' } };
    api.children.set('v1', v1);
    api.splatChild = splat;
    root.children.set('api', api);

    assert.deepStrictEqual(match(root, 'GET', '/api/v1')?.params, {});
    assert.deepStrictEqual(match(root, 'GET', '/api/v2/x')?.params, {
      rest: 'v2/x',
    });
  });
});

describe('match — per-segment URL decoding', () => {
  it('decodes %20 in params', () => {
    const root = createNode('');
    const users = createNode('users');
    const nameNode = createNode(':name');
    nameNode.methods = { GET: { handler: noop } };
    users.paramChild = nameNode;
    root.children.set('users', users);

    assert.deepStrictEqual(match(root, 'GET', '/users/john%20doe')?.params, {
      name: 'john doe',
    });
  });

  it('preserves %2F inside a segment (does not split)', () => {
    const root = createNode('');
    const users = createNode('users');
    const nameNode = createNode(':name');
    nameNode.methods = { GET: { handler: noop } };
    users.paramChild = nameNode;
    root.children.set('users', users);

    // Spring-style per-segment: '%2F' stays as '/' inside the param value;
    // the matcher does NOT see foo%2Fbar as "/users/foo/bar".
    assert.deepStrictEqual(match(root, 'GET', '/users/foo%2Fbar')?.params, {
      name: 'foo/bar',
    });
  });

  it('throws MalformedPathError on invalid encoding', () => {
    const root = createNode('');
    const users = createNode('users');
    users.methods = { GET: { handler: noop } };
    root.children.set('users', users);

    assertThrowsLike(() => match(root, 'GET', '/users/%'), MalformedPathError);
  });

  it('splat reconstruction loses encoded-slash distinction (documented behavior)', () => {
    const root = createNode('');
    const api = createNode('api');
    const splat = createNode('*rest');
    splat.methods = { GET: { handler: noop } };
    api.splatChild = splat;
    root.children.set('api', api);

    // Both URLs produce the same splat value because per-segment decoding
    // happens before reconstruction. Documented in match.ts JSDoc.
    assert.deepStrictEqual(match(root, 'GET', '/api/foo%2Fbar/baz')?.params, {
      rest: 'foo/bar/baz',
    });
    assert.deepStrictEqual(match(root, 'GET', '/api/foo/bar/baz')?.params, {
      rest: 'foo/bar/baz',
    });
  });
});

describe('match — case sensitivity', () => {
  it('insensitive by default ("/Users" matches "/users")', () => {
    const root = createNode('');
    const users = createNode('users');
    users.methods = { GET: { handler: noop } };
    root.children.set('users', users);

    assert.strictEqual(match(root, 'GET', '/Users')?.entry?.handler, noop);
  });
});

describe('match — trailing slash', () => {
  it('lenient by default ("/users/" matches "/users")', () => {
    const root = createNode('');
    const users = createNode('users');
    users.methods = { GET: { handler: noop } };
    root.children.set('users', users);

    assert.strictEqual(match(root, 'GET', '/users/')?.entry?.handler, noop);
  });
});

describe('match — HEAD fallback', () => {
  it('HEAD on a GET-only route returns the GET handler', () => {
    const root = createNode('');
    const users = createNode('users');
    users.methods = { GET: { handler: noop } };
    root.children.set('users', users);

    assert.strictEqual(match(root, 'HEAD', '/users')?.entry?.handler, noop);
  });

  it('explicit HEAD overrides GET fallback', () => {
    const headHandler: HandlerEntry['handler'] = async () => 'head';
    const root = createNode('');
    const users = createNode('users');
    users.methods = { GET: { handler: noop }, HEAD: { handler: headHandler } };
    root.children.set('users', users);

    assert.strictEqual(
      match(root, 'HEAD', '/users')?.entry?.handler,
      headHandler,
    );
  });
});

describe('match — 405 Method Not Allowed', () => {
  it('returns entry: null + allowedMethods when path matches but method does not', () => {
    const root = createNode('');
    const users = createNode('users');
    users.methods = { GET: { handler: noop }, POST: { handler: noop } };
    root.children.set('users', users);

    const m = match(root, 'DELETE', '/users');
    assert.strictEqual(m?.entry, null);
    assertMatches(
      m?.allowedMethods,
      pattern.arrayContaining(['GET', 'POST', 'HEAD']),
    );
  });

  it('HEAD on a POST-only route → 405 without HEAD in Allow', () => {
    const root = createNode('');
    const users = createNode('users');
    users.methods = { POST: { handler: noop } };
    root.children.set('users', users);

    const m = match(root, 'HEAD', '/users');
    assert.strictEqual(m?.entry, null);
    assert.deepStrictEqual(m?.allowedMethods, ['POST']);
  });
});

describe('match — middleware accumulation', () => {
  it('accumulates from root → subtree → leaf → handler-level', () => {
    const rootMw = mw('Root');
    const subMw = mw('Sub');
    const leafMw = mw('Leaf');
    const handlerMw = mw('Handler');

    const root = createNode('');
    root.middlewares.push(rootMw);
    const users = createNode('users');
    users.middlewares.push(subMw);
    const idNode = createNode(':id');
    idNode.middlewares.push(leafMw);
    idNode.methods = { GET: { handler: noop, middlewares: [handlerMw] } };
    users.paramChild = idNode;
    root.children.set('users', users);

    const m = match(root, 'GET', '/users/42');
    assert.deepStrictEqual(
      m?.middlewares.map((entry) => entry.Class.name),
      ['Root', 'Sub', 'Leaf', 'Handler'],
    );
  });
});

describe('match — bodyParsing inheritance', () => {
  it('handler-level bodyParsing wins', () => {
    const root = createNode('');
    const users = createNode('users');
    const webhook = createNode('webhook');
    webhook.methods = { POST: { handler: noop, bodyParsing: 'raw' } };
    users.children.set('webhook', webhook);
    root.children.set('users', users);

    assert.strictEqual(
      match(root, 'POST', '/users/webhook')?.bodyParsing,
      'raw',
    );
  });

  it('subtree bodyParsing inherits to leaves without override', () => {
    const root = createNode('');
    const webhooks = createNode('webhooks');
    webhooks.bodyParsing = 'raw';
    const stripe = createNode('stripe');
    stripe.methods = { POST: { handler: noop } };
    webhooks.children.set('stripe', stripe);
    root.children.set('webhooks', webhooks);

    assert.strictEqual(
      match(root, 'POST', '/webhooks/stripe')?.bodyParsing,
      'raw',
    );
  });

  it('default is "parsed"', () => {
    const root = createNode('');
    const users = createNode('users');
    users.methods = { GET: { handler: noop } };
    root.children.set('users', users);

    assert.strictEqual(match(root, 'GET', '/users')?.bodyParsing, 'parsed');
  });
});

describe('match — empty / edge cases', () => {
  it('empty registry returns null', () => {
    assert.strictEqual(match(createNode(''), 'GET', '/anything'), null);
  });

  it('node with no methods returns null (404, not 405)', () => {
    const root = createNode('');
    const users = createNode('users');
    // No methods on `users` — it's a structural node only
    root.children.set('users', users);

    assert.strictEqual(match(root, 'GET', '/users'), null);
  });
});

describe('match — HEAD fallback uses GET paramNames', () => {
  it('HEAD inherits paramNames from the GET handler', () => {
    const root = createNode('');
    const users = createNode('users');
    const paramNode = createNode(':slug');
    paramNode.methods = {
      GET: { handler: noop, paramNames: ['userId'] },
    };
    users.paramChild = paramNode;
    root.children.set('users', users);

    const m = match(root, 'HEAD', '/users/42');
    assert.strictEqual(m?.entry?.handler, noop);
    assert.deepStrictEqual(m?.params, { userId: '42' });
  });

  it('explicit HEAD handler uses its own paramNames, not GET', () => {
    const headHandler: HandlerEntry['handler'] = async () => 'head';
    const root = createNode('');
    const users = createNode('users');
    const paramNode = createNode(':slug');
    paramNode.methods = {
      GET: { handler: noop, paramNames: ['userId'] },
      HEAD: { handler: headHandler, paramNames: ['headId'] },
    };
    users.paramChild = paramNode;
    root.children.set('users', users);

    const m = match(root, 'HEAD', '/users/42');
    assert.strictEqual(m?.entry?.handler, headHandler);
    assert.deepStrictEqual(m?.params, { headId: '42' });
  });
});

describe('match — 405 with params', () => {
  it('405 response still returns tree-derived params', () => {
    const root = createNode('');
    const users = createNode('users');
    const paramNode = createNode(':id');
    paramNode.methods = {
      GET: { handler: noop, paramNames: ['userId'] },
    };
    users.paramChild = paramNode;
    root.children.set('users', users);

    const m = match(root, 'DELETE', '/users/42');
    assert.strictEqual(m?.entry, null);
    // handler is null so paramNames cannot be used; falls back to tree name
    assert.deepStrictEqual(m?.params, { id: '42' });
  });
});

describe('match — mixed param + splat with paramNames', () => {
  it('zips paramNames with paramValues in correct order (param then splat)', () => {
    const root = createNode('');
    const files = createNode('files');
    const paramNode = createNode(':owner');
    const splatNode = createNode('*path');
    splatNode.methods = {
      GET: { handler: noop, paramNames: ['id', 'rest'] },
    };
    paramNode.splatChild = splatNode;
    files.paramChild = paramNode;
    root.children.set('files', files);

    const m = match(root, 'GET', '/files/alice/docs/report.pdf');
    assert.strictEqual(m?.entry?.handler, noop);
    assert.deepStrictEqual(m?.params, { id: 'alice', rest: 'docs/report.pdf' });
  });

  it('without paramNames, uses tree segment names for param + splat', () => {
    const root = createNode('');
    const files = createNode('files');
    const paramNode = createNode(':owner');
    const splatNode = createNode('*path');
    splatNode.methods = { GET: { handler: noop } };
    paramNode.splatChild = splatNode;
    files.paramChild = paramNode;
    root.children.set('files', files);

    const m = match(root, 'GET', '/files/alice/docs/report.pdf');
    assert.deepStrictEqual(m?.params, {
      owner: 'alice',
      path: 'docs/report.pdf',
    });
  });

  it('paramNames length mismatch — extra paramValues are silently dropped', () => {
    const root = createNode('');
    const files = createNode('files');
    const p1 = createNode(':a');
    const p2 = createNode(':b');
    p2.methods = {
      GET: { handler: noop, paramNames: ['only'] },
    };
    p1.paramChild = p2;
    files.paramChild = p1;
    root.children.set('files', files);

    const m = match(root, 'GET', '/files/x/y');
    // paramValues = ['x', 'y'], paramNames = ['only'] — only first zips
    assert.deepStrictEqual(m?.params, { only: 'x' });
    // 'y' is silently lost — the handler declared fewer names than segments
  });
});

describe('match — duplicate tree param names (mergeNode edge case)', () => {
  it('without paramNames, last param value wins (object spread)', () => {
    // Contrived: two param levels with the same tree segment name.
    // This can happen if mergeNode merges subtrees from different controllers
    // where both used `:id` at different depths.
    const root = createNode('');
    const p1 = createNode(':id');
    const p2 = createNode(':id');
    p2.methods = { GET: { handler: noop } };
    p1.paramChild = p2;
    root.paramChild = p1;

    const m = match(root, 'GET', '/first/second');
    // walk does { ...parentParams, [paramName]: seg } so the second ':id'
    // overwrites the first — only 'second' survives.
    assert.deepStrictEqual(m?.params, { id: 'second' });
  });

  it('with paramNames, both values are preserved under distinct keys', () => {
    const root = createNode('');
    const p1 = createNode(':id');
    const p2 = createNode(':id');
    p2.methods = {
      GET: { handler: noop, paramNames: ['parentId', 'childId'] },
    };
    p1.paramChild = p2;
    root.paramChild = p1;

    const m = match(root, 'GET', '/first/second');
    assert.deepStrictEqual(m?.params, { parentId: 'first', childId: 'second' });
  });
});

describe('match — backtracking past method-less static nodes (doc 05)', () => {
  // /users/:id  +  /users/me/avatar  → `me` exists as a method-less node.
  const buildUsers = () => {
    const root = createNode('');
    const users = createNode('users');
    const me = createNode('me');
    const avatar = createNode('avatar');
    avatar.methods = { GET: { handler: noop } };
    me.children.set('avatar', avatar);
    users.children.set('me', me);
    const idNode = createNode(':id');
    idNode.methods = { GET: { handler: async () => 'param' } };
    users.paramChild = idNode;
    root.children.set('users', users);
    return { root, me };
  };

  it('a method-less static node does not shadow a sibling param route', () => {
    const { root } = buildUsers();
    // Main regression: /users/me must fall through to /users/:id.
    assert.deepStrictEqual(match(root, 'GET', '/users/me')?.params, {
      id: 'me',
    });
    // The deep static route and other param values still work.
    assert.strictEqual(
      match(root, 'GET', '/users/me/avatar')?.entry?.handler,
      noop,
    );
    assert.deepStrictEqual(match(root, 'GET', '/users/42')?.params, {
      id: '42',
    });
  });

  it('middleware on the abandoned static node does not leak into the param match', () => {
    const { root, me } = buildUsers();
    me.middlewares.push(mw('MeOnly'));
    const m = match(root, 'GET', '/users/me');
    assert.deepStrictEqual(m?.params, { id: 'me' });
    assert.ok(!m?.middlewares.map((e) => e.Class.name).includes('MeOnly'));
  });

  it('PINNED: a static node with a different method wins (405), not the param route', () => {
    // Deliberate choice: the most-specific node reports 405 rather than
    // backtracking to the param route. Change this only with intent.
    const root = createNode('');
    const u = createNode('u');
    const me = createNode('me');
    me.methods = { POST: { handler: noop } };
    const idNode = createNode(':id');
    idNode.methods = { GET: { handler: async () => 'param' } };
    u.children.set('me', me);
    u.paramChild = idNode;
    root.children.set('u', u);

    const m = match(root, 'GET', '/u/me');
    assert.strictEqual(m?.entry, null);
    assert.deepStrictEqual(m?.allowedMethods, ['POST']);
  });
});

describe('match — empty segments (doc 05)', () => {
  it('an empty path segment does not match a param as ""', () => {
    const root = createNode('');
    const users = createNode('users');
    const idNode = createNode(':id');
    idNode.methods = { GET: { handler: noop } };
    users.paramChild = idNode;
    root.children.set('users', users);

    assert.strictEqual(match(root, 'GET', '/users//'), null);
    assert.strictEqual(match(root, 'GET', '/users//x'), null);
  });
});

describe('match — zero-segment splat (doc 05)', () => {
  it('{*splat} matches zero trailing segments with rest = ""', () => {
    const root = createNode('');
    const api = createNode('api');
    const splat = createNode('*rest');
    splat.methods = { GET: { handler: noop } };
    api.splatChild = splat;
    root.children.set('api', api);

    const m = match(root, 'GET', '/api');
    assert.strictEqual(m?.entry?.handler, noop);
    assert.deepStrictEqual(m?.params, { rest: '' });
    // non-empty path still captured
    assert.deepStrictEqual(match(root, 'GET', '/api/v1/x')?.params, {
      rest: 'v1/x',
    });
  });

  it('an exact node still wins over its own zero-segment splat child', () => {
    const root = createNode('');
    const api = createNode('api');
    api.methods = { GET: { handler: noop } };
    const splat = createNode('*rest');
    splat.methods = { GET: { handler: async () => 'splat' } };
    api.splatChild = splat;
    root.children.set('api', api);

    assert.strictEqual(match(root, 'GET', '/api')?.entry?.handler, noop);
  });
});

describe('RouteRegistry.registerSubtree — param prefix (doc 05)', () => {
  it('prepends prefix param names so values align with handler paramNames', () => {
    const registry = new RouteRegistry();
    const subtreeRoot = createNode('');
    const itemNode = createNode(':itemId');
    itemNode.methods = { GET: { handler: noop, paramNames: ['itemId'] } };
    subtreeRoot.paramChild = itemNode;

    registry.registerSubtree('/tenant/:tenantId', subtreeRoot);

    const m = registry.match('GET', '/tenant/t1/i9');
    assert.strictEqual(m?.entry?.handler, noop);
    assert.deepStrictEqual(m?.params, { tenantId: 't1', itemId: 'i9' });
  });
});

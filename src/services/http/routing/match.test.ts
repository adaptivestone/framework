import { describe, expect, it } from 'vitest';
import { MalformedPathError, match } from './match.ts';
import type { HandlerEntry, MiddlewareEntry } from './RouteNode.ts';
import { createNode } from './RouteNode.ts';

const noop: HandlerEntry['handler'] = async () => {};

const mw = (name: string): MiddlewareEntry => ({
  // biome-ignore lint/suspicious/noExplicitAny: dummy class for tests
  Class: { name } as any,
  source: { kind: 'package', spec: 'test' },
});

describe('match — static segments', () => {
  it('matches an exact path', () => {
    const root = createNode('');
    const users = createNode('users');
    users.methods = { GET: { handler: noop } };
    root.children.set('users', users);

    const m = match(root, 'GET', '/users');
    expect(m?.entry?.handler).toBe(noop);
    expect(m?.params).toEqual({});
  });

  it('returns null for a non-existent path', () => {
    const root = createNode('');
    const users = createNode('users');
    users.methods = { GET: { handler: noop } };
    root.children.set('users', users);

    expect(match(root, 'GET', '/posts')).toBeNull();
  });

  it('matches the root path "/"', () => {
    const root = createNode('');
    root.methods = { GET: { handler: noop } };

    expect(match(root, 'GET', '/')?.entry?.handler).toBe(noop);
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

    expect(match(root, 'GET', '/admin/users/profile')?.entry?.handler).toBe(
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
    expect(m?.entry?.handler).toBe(noop);
    expect(m?.params).toEqual({ id: '42' });
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
    expect(staticMatch?.params).toEqual({});
    expect(paramMatch?.params).toEqual({ id: '42' });
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
    expect(m?.params).toEqual({ rest: 'v1/users/42' });
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

    expect(match(root, 'GET', '/api/v1')?.params).toEqual({});
    expect(match(root, 'GET', '/api/v2/x')?.params).toEqual({ rest: 'v2/x' });
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

    expect(match(root, 'GET', '/users/john%20doe')?.params).toEqual({
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
    expect(match(root, 'GET', '/users/foo%2Fbar')?.params).toEqual({
      name: 'foo/bar',
    });
  });

  it('throws MalformedPathError on invalid encoding', () => {
    const root = createNode('');
    const users = createNode('users');
    users.methods = { GET: { handler: noop } };
    root.children.set('users', users);

    expect(() => match(root, 'GET', '/users/%')).toThrow(MalformedPathError);
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
    expect(match(root, 'GET', '/api/foo%2Fbar/baz')?.params).toEqual({
      rest: 'foo/bar/baz',
    });
    expect(match(root, 'GET', '/api/foo/bar/baz')?.params).toEqual({
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

    expect(match(root, 'GET', '/Users')?.entry?.handler).toBe(noop);
  });

  it('sensitive when opted in', () => {
    const root = createNode('');
    const users = createNode('users');
    users.methods = { GET: { handler: noop } };
    root.children.set('users', users);

    expect(match(root, 'GET', '/Users', { caseSensitive: true })).toBeNull();
    expect(
      match(root, 'GET', '/users', { caseSensitive: true })?.entry?.handler,
    ).toBe(noop);
  });
});

describe('match — trailing slash', () => {
  it('lenient by default ("/users/" matches "/users")', () => {
    const root = createNode('');
    const users = createNode('users');
    users.methods = { GET: { handler: noop } };
    root.children.set('users', users);

    expect(match(root, 'GET', '/users/')?.entry?.handler).toBe(noop);
  });

  it('strict when opted in', () => {
    const root = createNode('');
    const users = createNode('users');
    users.methods = { GET: { handler: noop } };
    root.children.set('users', users);

    expect(
      match(root, 'GET', '/users/', { strictTrailingSlash: true }),
    ).toBeNull();
  });
});

describe('match — HEAD fallback', () => {
  it('HEAD on a GET-only route returns the GET handler', () => {
    const root = createNode('');
    const users = createNode('users');
    users.methods = { GET: { handler: noop } };
    root.children.set('users', users);

    expect(match(root, 'HEAD', '/users')?.entry?.handler).toBe(noop);
  });

  it('explicit HEAD overrides GET fallback', () => {
    const headHandler: HandlerEntry['handler'] = async () => 'head';
    const root = createNode('');
    const users = createNode('users');
    users.methods = { GET: { handler: noop }, HEAD: { handler: headHandler } };
    root.children.set('users', users);

    expect(match(root, 'HEAD', '/users')?.entry?.handler).toBe(headHandler);
  });
});

describe('match — 405 Method Not Allowed', () => {
  it('returns entry: null + allowedMethods when path matches but method does not', () => {
    const root = createNode('');
    const users = createNode('users');
    users.methods = { GET: { handler: noop }, POST: { handler: noop } };
    root.children.set('users', users);

    const m = match(root, 'DELETE', '/users');
    expect(m?.entry).toBeNull();
    expect(m?.allowedMethods).toEqual(
      expect.arrayContaining(['GET', 'POST', 'HEAD']),
    );
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
    expect(m?.middlewares.map((entry) => entry.Class.name)).toEqual([
      'Root',
      'Sub',
      'Leaf',
      'Handler',
    ]);
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

    expect(match(root, 'POST', '/users/webhook')?.bodyParsing).toBe('raw');
  });

  it('subtree bodyParsing inherits to leaves without override', () => {
    const root = createNode('');
    const webhooks = createNode('webhooks');
    webhooks.bodyParsing = 'raw';
    const stripe = createNode('stripe');
    stripe.methods = { POST: { handler: noop } };
    webhooks.children.set('stripe', stripe);
    root.children.set('webhooks', webhooks);

    expect(match(root, 'POST', '/webhooks/stripe')?.bodyParsing).toBe('raw');
  });

  it('default is "parsed"', () => {
    const root = createNode('');
    const users = createNode('users');
    users.methods = { GET: { handler: noop } };
    root.children.set('users', users);

    expect(match(root, 'GET', '/users')?.bodyParsing).toBe('parsed');
  });
});

describe('match — empty / edge cases', () => {
  it('empty registry returns null', () => {
    expect(match(createNode(''), 'GET', '/anything')).toBeNull();
  });

  it('node with no methods returns null (404, not 405)', () => {
    const root = createNode('');
    const users = createNode('users');
    // No methods on `users` — it's a structural node only
    root.children.set('users', users);

    expect(match(root, 'GET', '/users')).toBeNull();
  });
});

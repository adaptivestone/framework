import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { describe, it } from 'node:test';
import {
  createTestContext,
  finishTestContext,
} from '../../tests/createTestContext.ts';
import { type FinishResult, RequestContext } from './RequestContext.ts';
import { requestContext } from './requestScope.ts';

describe('RequestContext — request data', () => {
  it('reads the request through its source', () => {
    const ctx = createTestContext({
      method: 'post',
      url: '/files/my%20report?page=2',
      origin: 'https://api.example.test',
      headers: { 'X-Trace': ['a', 'b'], Accept: 'application/json' },
      route: '/files/:name',
      params: { name: 'my report' },
      body: { a: 1 },
      appInfo: { ip: '203.0.113.7' },
    });
    assert.strictEqual(ctx.method, 'POST');
    assert.strictEqual(ctx.path, '/files/my report');
    assert.strictEqual(
      ctx.url.href,
      'https://api.example.test/files/my%20report?page=2',
    );
    assert.strictEqual(ctx.route, '/files/:name');
    assert.strictEqual(ctx.header('accept'), 'application/json');
    assert.strictEqual(ctx.header('x-trace'), 'a, b');
    assert.strictEqual(ctx.header('missing'), undefined);
    assert.deepStrictEqual(ctx.params, { name: 'my report' });
    assert.deepStrictEqual(ctx.query, { page: '2' });
    assert.deepStrictEqual(ctx.body, { a: 1 });
    assert.strictEqual(ctx.ip, '203.0.113.7');
  });

  it('id is the client X-Request-Id, otherwise a stable generated one', () => {
    assert.strictEqual(
      createTestContext({ headers: { 'x-request-id': 'req-1' } }).id,
      'req-1',
    );
    const ctx = createTestContext();
    assert.match(ctx.id, /^[0-9a-f-]{36}$/);
    assert.strictEqual(ctx.id, ctx.id);
  });

  it('appInfo is the object it was given (shared with other code)', () => {
    const appInfo = { user: 'u1' };
    assert.strictEqual(createTestContext({ appInfo }).appInfo, appInfo);
  });
});

describe('RequestContext — response staging', () => {
  it('set replaces, append adds, names are case-insensitive', () => {
    const { response } = createTestContext();
    response.setHeader('X-One', 'a');
    response.setHeader('x-one', 'b');
    response.appendHeader('Vary', 'Origin');
    response.appendHeader('vary', 'Accept');
    assert.deepStrictEqual(response.entries(), [
      ['x-one', 'b'],
      ['vary', 'Origin'],
      ['vary', 'Accept'],
    ]);
  });

  it('staging after the response has ended throws', () => {
    const ctx = createTestContext();
    finishTestContext(ctx);
    assert.throws(
      () => ctx.response.setHeader('x-late', '1'),
      /already started/,
    );
  });
});

describe('RequestContext — cookies', () => {
  const cookies = (ctx: ReturnType<typeof createTestContext>) =>
    ctx.response
      .entries()
      .filter(([name]) => name === 'set-cookie')
      .map(([, value]) => value);

  it('reads request cookies, URL-decoded; a missing one is undefined', () => {
    const ctx = createTestContext({
      headers: { cookie: 'sid=abc; note=a%20b; __proto__=x' },
    });
    assert.strictEqual(ctx.cookies.get('sid'), 'abc');
    assert.strictEqual(ctx.cookies.get('note'), 'a b');
    assert.strictEqual(ctx.cookies.get('missing'), undefined);
    assert.strictEqual(ctx.cookies.get('toString'), undefined);
    assert.strictEqual(createTestContext().cookies.get('sid'), undefined);
  });

  it('joins several cookie headers', () => {
    const ctx = createTestContext({ headers: { cookie: ['a=1', 'b=2'] } });
    assert.strictEqual(ctx.cookies.get('a'), '1');
    assert.strictEqual(ctx.cookies.get('b'), '2');
  });

  it('secure defaults over HTTPS', () => {
    const ctx = createTestContext({ origin: 'https://example.com' });
    ctx.response.setCookie('sid', 'abc');
    assert.deepStrictEqual(cookies(ctx), [
      'sid=abc; Path=/; HttpOnly; Secure; SameSite=Lax',
    ]);
  });

  it('plain HTTP to localhost is not Secure outside production', () => {
    for (const origin of [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://[::1]:3000',
      'http://app.localhost',
    ]) {
      const ctx = createTestContext({ origin });
      ctx.response.setCookie('sid', 'abc');
      assert.deepStrictEqual(
        cookies(ctx),
        ['sid=abc; Path=/; HttpOnly; SameSite=Lax'],
        origin,
      );
    }
    const remote = createTestContext({ origin: 'http://example.com' });
    remote.response.setCookie('sid', 'abc');
    assert.match(cookies(remote)[0] ?? '', /; Secure;/);
  });

  it('in production localhost cookies stay Secure (a proxy may forward Host: localhost)', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const ctx = createTestContext({ origin: 'http://localhost:3000' });
      ctx.response.setCookie('sid', 'abc');
      assert.match(cookies(ctx)[0] ?? '', /; Secure;/);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it('options override the defaults', () => {
    const ctx = createTestContext({ origin: 'https://example.com' });
    ctx.response.setCookie('theme', 'dark', {
      httpOnly: false,
      sameSite: 'strict',
      path: '/app',
      domain: 'example.com',
      maxAge: 3600,
      priority: 'high',
    });
    assert.deepStrictEqual(cookies(ctx), [
      'theme=dark; Max-Age=3600; Domain=example.com; Path=/app; Secure; Priority=High; SameSite=Strict',
    ]);
  });

  it('the same name, domain and path replaces; another path is a second cookie', () => {
    const ctx = createTestContext({ origin: 'https://example.com' });
    ctx.response.setCookie('sid', 'one');
    ctx.response.setCookie('sid', 'two');
    ctx.response.setCookie('sid', 'admin', { path: '/admin' });
    assert.deepStrictEqual(cookies(ctx), [
      'sid=two; Path=/; HttpOnly; Secure; SameSite=Lax',
      'sid=admin; Path=/admin; HttpOnly; Secure; SameSite=Lax',
    ]);
  });

  it('deleteCookie expires it and replaces a staged value', () => {
    const ctx = createTestContext({ origin: 'https://example.com' });
    ctx.response.setCookie('sid', 'abc');
    ctx.response.deleteCookie('sid');
    assert.deepStrictEqual(cookies(ctx), [
      'sid=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax',
    ]);
  });

  it('cookies come after staged headers; invalid input and late staging throw', () => {
    const ctx = createTestContext();
    ctx.response.setCookie('a', '1');
    ctx.response.setHeader('x-one', '1');
    assert.deepStrictEqual(
      ctx.response.entries().map(([name]) => name),
      ['x-one', 'set-cookie'],
    );
    assert.throws(() => ctx.response.setCookie('bad name', 'x'), TypeError);
    finishTestContext(ctx);
    assert.throws(() => ctx.response.setCookie('b', '2'), /already started/);
  });
});

describe('RequestContext — raw body and body stream', () => {
  it('rawBody is the bytes the route captured; undefined otherwise', () => {
    assert.strictEqual(createTestContext().rawBody, undefined);
    const bytes = Buffer.from('{"a":1}');
    assert.strictEqual(createTestContext({ rawBody: bytes }).rawBody, bytes);
  });

  it('bodyStream is the unread request body as one ReadableStream', async () => {
    const ctx = createTestContext({
      incoming: Readable.from([Buffer.from('he'), Buffer.from('llo')]),
    });
    const stream = ctx.bodyStream;
    assert.ok(stream instanceof ReadableStream);
    assert.strictEqual(ctx.bodyStream, stream);
    assert.strictEqual(await new Response(stream).text(), 'hello');
  });

  it('bodyStream is undefined without a stream, or once the body was parsed or captured', () => {
    assert.strictEqual(createTestContext().bodyStream, undefined);
    const parsed = createTestContext({ incoming: Readable.from([]) });
    RequestContext.setBody(parsed, {});
    assert.strictEqual(parsed.bodyStream, undefined);
    const raw = createTestContext({ incoming: Readable.from([]) });
    RequestContext.setRawBody(raw, Buffer.alloc(0));
    assert.strictEqual(raw.bodyStream, undefined);
    assert.strictEqual(raw.rawBody?.length, 0);
  });
});

describe('RequestContext — onFinish', () => {
  it('runs callbacks once, newest first, with the outcome and a duration', () => {
    const ctx = createTestContext();
    const calls: Array<[string, FinishResult]> = [];
    ctx.onFinish((r) => calls.push(['first', r]));
    ctx.onFinish((r) => calls.push(['second', r]));
    finishTestContext(ctx, { outcome: 'finished', status: 201 });
    finishTestContext(ctx, { outcome: 'aborted' });
    assert.deepStrictEqual(
      calls.map(([name]) => name),
      ['second', 'first'],
    );
    assert.strictEqual(calls[0]?.[1].outcome, 'finished');
    assert.strictEqual(calls[0]?.[1].status, 201);
    assert.ok((calls[0]?.[1].durationMs ?? -1) >= 0);
  });

  it('a throwing callback is reported; the others still run', () => {
    const ctx = createTestContext();
    const ran: string[] = [];
    const reported: unknown[] = [];
    const original = console.error;
    console.error = (_message: unknown, error: unknown) => {
      reported.push(error);
    };
    try {
      ctx.onFinish(() => ran.push('kept'));
      ctx.onFinish(() => {
        throw new Error('callback broke');
      });
      finishTestContext(ctx);
    } finally {
      console.error = original;
    }
    assert.deepStrictEqual(ran, ['kept']);
    assert.strictEqual((reported[0] as Error).message, 'callback broke');
  });

  it('callbacks run in the request scope', () => {
    const ctx = createTestContext();
    let seen: unknown;
    ctx.onFinish(() => {
      seen = requestContext();
    });
    finishTestContext(ctx);
    assert.strictEqual(seen, ctx);
  });

  it('registering after the end throws', () => {
    const ctx = createTestContext();
    finishTestContext(ctx);
    assert.throws(() => ctx.onFinish(() => {}), /already ended/);
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createTestContext,
  finishTestContext,
} from '../../tests/createTestContext.ts';
import type { FinishResult } from './RequestContext.ts';
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

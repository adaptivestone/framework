/**
 * Coverage tests for `HttpServer`'s 404 fallthrough + 500 error handler.
 * Uses the global test server set up in `setupNodeTest.ts` — no extra
 * server boot needed.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { appInstance } from '../../helpers/appInstance.ts';
import { getTestServerURL } from '../../tests/testHelpers.ts';

describe('HttpServer — 404 fallthrough', () => {
  it('returns 404 JSON for unmatched paths', async () => {
    const res = await fetch(getTestServerURL('/this-path-does-not-exist'));
    assert.strictEqual(res.status, 404);
    const body = await res.json();
    assert.deepStrictEqual(body, { message: '404' });
  });
});

describe('HttpServer — security headers (doc 22)', () => {
  it('sets the default security headers on a response', async () => {
    const res = await fetch(getTestServerURL('/'));
    assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
    assert.strictEqual(res.headers.get('x-frame-options'), 'DENY');
    assert.strictEqual(res.headers.get('referrer-policy'), 'no-referrer');
    // Off by default (avoids HTTPS lock-in during local dev).
    assert.strictEqual(res.headers.get('strict-transport-security'), null);
    // x-powered-by stays disabled (regression).
    assert.strictEqual(res.headers.get('x-powered-by'), null);
  });

  it('sets the headers on a 404 too (global mount, before the adapter)', async () => {
    const res = await fetch(getTestServerURL('/no-such-route-xyz-22'));
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
  });

  it('can be disabled via config', async () => {
    const original = appInstance.getConfig('http').securityHeaders;
    appInstance.updateConfig('http', { securityHeaders: { enabled: false } });
    try {
      const res = await fetch(getTestServerURL('/'));
      assert.strictEqual(res.headers.get('x-content-type-options'), null);
    } finally {
      appInstance.updateConfig('http', { securityHeaders: original });
    }
  });
});

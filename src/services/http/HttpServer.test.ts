/**
 * Coverage tests for `HttpServer`'s 404 fallthrough + 500 error handler.
 * Uses the global test server set up in `setupVitest.ts` — no extra
 * server boot needed.
 */

import { describe, expect, it } from 'vitest';
import { appInstance } from '../../helpers/appInstance.ts';
import { getTestServerURL } from '../../tests/testHelpers.ts';

describe('HttpServer — 404 fallthrough', () => {
  it('returns 404 JSON for unmatched paths', async () => {
    const res = await fetch(getTestServerURL('/this-path-does-not-exist'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ message: '404' });
  });
});

describe('HttpServer — security headers (doc 22)', () => {
  it('sets the default security headers on a response', async () => {
    const res = await fetch(getTestServerURL('/'));
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    // Off by default (avoids HTTPS lock-in during local dev).
    expect(res.headers.get('strict-transport-security')).toBeNull();
    // x-powered-by stays disabled (regression).
    expect(res.headers.get('x-powered-by')).toBeNull();
  });

  it('sets the headers on a 404 too (global mount, before the adapter)', async () => {
    const res = await fetch(getTestServerURL('/no-such-route-xyz-22'));
    expect(res.status).toBe(404);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('can be disabled via config', async () => {
    const original = appInstance.getConfig('http').securityHeaders;
    appInstance.updateConfig('http', { securityHeaders: { enabled: false } });
    try {
      const res = await fetch(getTestServerURL('/'));
      expect(res.headers.get('x-content-type-options')).toBeNull();
    } finally {
      appInstance.updateConfig('http', { securityHeaders: original });
    }
  });
});

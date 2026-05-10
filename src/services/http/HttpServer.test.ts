/**
 * Coverage tests for `HttpServer`'s 404 fallthrough + 500 error handler.
 * Uses the global test server set up in `setupVitest.ts` — no extra
 * server boot needed.
 */

import { describe, expect, it } from 'vitest';
import { getTestServerURL } from '../../tests/testHelpers.ts';

describe('HttpServer — 404 fallthrough', () => {
  it('returns 404 JSON for unmatched paths', async () => {
    const res = await fetch(getTestServerURL('/this-path-does-not-exist'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ message: '404' });
  });
});

/**
 * Tests for the redis connection lifecycle (doc 11). Uses the shared test redis
 * via `appInstance`'s config; the module's client singleton starts fresh per
 * test file (vitest isolates modules).
 *
 * Note: the "failed connect → retry on next call" path (issue 3) is verified by
 * code review, not an automated test — node-redis retries the initial connect
 * with backoff rather than rejecting, so a bogus URL hangs instead of failing
 * fast, and faking the client collides with the singleton already used by the
 * shared `appInstance`'s cache.
 */

import { describe, expect, it } from 'vitest';
import { getRedisClient, getRedisClientSync } from './redisConnection.ts';

describe('redisConnection (doc 11)', () => {
  it('concurrent calls return the same connected client (shared connect promise)', async () => {
    expect.assertions(2);
    // Both await the same cached connect promise — no double-connect on a
    // half-built client (the bug the promise cache fixes).
    const [a, b] = await Promise.all([getRedisClient(), getRedisClient()]);
    expect(a).toBe(b);
    expect(a.isOpen).toBe(true);
  });

  it('getRedisClientSync returns a client without throwing (no unhandled rejection)', () => {
    expect.assertions(1);
    expect(getRedisClientSync()).toBeDefined();
  });
});

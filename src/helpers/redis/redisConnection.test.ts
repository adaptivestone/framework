/**
 * Tests for the redis connection lifecycle (doc 11). Uses the shared test redis
 * via `appInstance`'s config; the module's client singleton starts fresh per
 * test file (node:test isolates modules in separate child processes).
 *
 * Note: the "failed connect → retry on next call" path (issue 3) is verified by
 * code review, not an automated test — node-redis retries the initial connect
 * with backoff rather than rejecting, so a bogus URL hangs instead of failing
 * fast, and faking the client collides with the singleton already used by the
 * shared `appInstance`'s cache.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { redisSkip } from '../../tests/redisAvailability.ts';
import { getRedisClient, getRedisClientSync } from './redisConnection.ts';

// Redis is optional; a checkout without one skips with a reason instead of
// timing out at 10s per test.
const skip = await redisSkip();

describe('redisConnection (doc 11)', { skip }, () => {
  it('concurrent calls return the same connected client (shared connect promise)', async () => {
    // Both await the same cached connect promise — no double-connect on a
    // half-built client (the bug the promise cache fixes).
    const [a, b] = await Promise.all([getRedisClient(), getRedisClient()]);
    assert.strictEqual(a, b);
    assert.strictEqual(a.isOpen, true);
  });

  it('getRedisClientSync returns a client without throwing (no unhandled rejection)', () => {
    assert.notStrictEqual(getRedisClientSync(), undefined);
  });
});

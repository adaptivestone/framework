import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import { describe, it } from 'node:test';
import { promisify } from 'node:util';
import { getRedisClient } from '../../../helpers/redis/redisConnection.ts';
import { redisSkip } from '../../../tests/redisAvailability.ts';
import RedisDriver from './RedisDriver.ts';

// Exercises the lazy redis path end-to-end: `whenReady` performs the dynamic
// `@redis/client` import, then get/set/del hit the live server. The
// framework test environment runs redis (see RateLimiter redis tests); a
// checkout without one skips with a reason rather than timing out.
const skip = await redisSkip();

describe('RedisDriver', { skip }, () => {
  it('lazy-connects and round-trips set/get/del', async () => {
    const driver = new RedisDriver();
    await driver.whenReady;
    await getRedisClient();

    const key = `RD_${crypto.randomUUID()}`;
    await driver.set(key, JSON.stringify('value'), 60);
    assert.strictEqual(await driver.get(key), JSON.stringify('value'));
    assert.strictEqual(await driver.del(key), 1);
    assert.strictEqual(await driver.get(key), null);
  });

  it('stores fractional TTLs in milliseconds', async () => {
    const driver = new RedisDriver();
    const client = await getRedisClient();
    const key = `RD_${crypto.randomUUID()}`;
    await driver.set(key, 'fractional', 1.25);
    assert.equal(await driver.get(key), 'fractional');
    const ttl = await client.pTTL(key);
    assert.ok(ttl > 0 && ttl <= 1250, `Unexpected TTL: ${ttl}`);
    await driver.del(key);
  });
});

it('cache fails soft and rate limiting uses insurance while Redis cannot connect', async () => {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      new URL('../../../tests/fixtures/redisUnavailable.ts', import.meta.url)
        .pathname,
    ],
    { timeout: 10000 },
  );
  assert.match(stdout, /UNAVAILABLE_REDIS_OK/);
});

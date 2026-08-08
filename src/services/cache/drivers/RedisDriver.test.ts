import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { describe, it } from 'node:test';
import { redisSkip } from '../../../tests/redisAvailability.ts';
import RedisDriver from './RedisDriver.ts';

// Exercises the lazy redis path end-to-end: `whenReady` performs the dynamic
// `@redis/client` import + connect, then get/set/del hit the live server. The
// framework test environment runs redis (see RateLimiter redis tests); a
// checkout without one skips with a reason rather than timing out.
const skip = await redisSkip();

describe('RedisDriver', { skip }, () => {
  it('lazy-connects and round-trips set/get/del', async () => {
    const driver = new RedisDriver();
    await driver.whenReady;

    const key = `RD_${crypto.randomUUID()}`;
    await driver.set(key, JSON.stringify('value'), 60);
    assert.strictEqual(await driver.get(key), JSON.stringify('value'));
    assert.strictEqual(await driver.del(key), 1);
    assert.strictEqual(await driver.get(key), null);
  });
});

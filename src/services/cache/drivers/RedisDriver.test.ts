import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import RedisDriver from './RedisDriver.ts';

// Exercises the lazy redis path end-to-end: `whenReady` performs the dynamic
// `@redis/client` import + connect, then get/set/del hit the live server. The
// framework test environment runs redis (see RateLimiter redis tests).
describe('RedisDriver', () => {
  it('lazy-connects and round-trips set/get/del', async () => {
    expect.assertions(3);
    const driver = new RedisDriver();
    await driver.whenReady;

    const key = `RD_${crypto.randomUUID()}`;
    await driver.set(key, JSON.stringify('value'), 60);
    expect(await driver.get(key)).toBe(JSON.stringify('value'));
    expect(await driver.del(key)).toBe(1);
    expect(await driver.get(key)).toBeNull();
  });
});

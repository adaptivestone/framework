import { setTimeout } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import MemoryDriver from './MemoryDriver.ts';

describe('MemoryDriver', () => {
  it('round-trips set/get', async () => {
    expect.assertions(1);
    const driver = new MemoryDriver();
    await driver.set('k', 'v', 60);
    expect(await driver.get('k')).toBe('v');
  });

  it('returns null for a missing key', async () => {
    expect.assertions(1);
    const driver = new MemoryDriver();
    expect(await driver.get('missing')).toBeNull();
  });

  it('overwrites an existing value', async () => {
    expect.assertions(1);
    const driver = new MemoryDriver();
    await driver.set('k', 'v1', 60);
    await driver.set('k', 'v2', 60);
    expect(await driver.get('k')).toBe('v2');
  });

  it('del removes a key and reports the count', async () => {
    expect.assertions(3);
    const driver = new MemoryDriver();
    await driver.set('k', 'v', 60);
    expect(await driver.del('k')).toBe(1);
    expect(await driver.get('k')).toBeNull();
    expect(await driver.del('k')).toBe(0); // already gone
  });

  it('a non-positive TTL never stores an entry (issue #10)', async () => {
    expect.assertions(2);
    const driver = new MemoryDriver();
    // A negative TTL would otherwise arm no timer yet still store → immortal.
    await driver.set('neg', 'v', -5);
    expect(await driver.get('neg')).toBeNull();
    // Zero converges on the same "don't cache" contract as redis' EX <= 0.
    await driver.set('zero', 'v', 0);
    expect(await driver.get('zero')).toBeNull();
  });

  it('expires a key after its TTL', async () => {
    expect.assertions(2);
    const driver = new MemoryDriver();
    // TTL is in seconds; a fractional value keeps the test fast.
    await driver.set('k', 'v', 0.05);
    expect(await driver.get('k')).toBe('v');
    await setTimeout(80);
    expect(await driver.get('k')).toBeNull();
  });
});

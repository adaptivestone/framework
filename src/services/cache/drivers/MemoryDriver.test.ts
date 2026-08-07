import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import MemoryDriver from './MemoryDriver.ts';

describe('MemoryDriver', () => {
  it('round-trips set/get', async () => {
    const driver = new MemoryDriver();
    await driver.set('k', 'v', 60);
    assert.strictEqual(await driver.get('k'), 'v');
  });

  it('returns null for a missing key', async () => {
    const driver = new MemoryDriver();
    assert.strictEqual(await driver.get('missing'), null);
  });

  it('overwrites an existing value', async () => {
    const driver = new MemoryDriver();
    await driver.set('k', 'v1', 60);
    await driver.set('k', 'v2', 60);
    assert.strictEqual(await driver.get('k'), 'v2');
  });

  it('del removes a key and reports the count', async () => {
    const driver = new MemoryDriver();
    await driver.set('k', 'v', 60);
    assert.strictEqual(await driver.del('k'), 1);
    assert.strictEqual(await driver.get('k'), null);
    assert.strictEqual(await driver.del('k'), 0); // already gone
  });

  it('a non-positive TTL never stores an entry (issue #10)', async () => {
    const driver = new MemoryDriver();
    // A negative TTL would otherwise arm no timer yet still store → immortal.
    await driver.set('neg', 'v', -5);
    assert.strictEqual(await driver.get('neg'), null);
    // Zero converges on the same "don't cache" contract as redis' EX <= 0.
    await driver.set('zero', 'v', 0);
    assert.strictEqual(await driver.get('zero'), null);
  });

  it('expires a key after its TTL', async () => {
    const driver = new MemoryDriver();
    // TTL is in seconds; a fractional value keeps the test fast.
    await driver.set('k', 'v', 0.05);
    assert.strictEqual(await driver.get('k'), 'v');
    await setTimeout(80);
    assert.strictEqual(await driver.get('k'), null);
  });
});

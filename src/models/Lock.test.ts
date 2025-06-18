import { describe, it, expect, beforeAll } from 'vitest';
import { appInstance } from '../helpers/appInstance.ts';
import type { TLock } from './Lock.ts';

describe('Lock Model', () => {
  let Lock: TLock;
  const testLockName = 'test-lock';
  const testTtl = 30; // seconds

  beforeAll(async () => {
    Lock = appInstance.getModel('Lock');
  });

  describe('acquireLock()', () => {
    it('should successfully acquire a new lock', async () => {
      const result = await Lock.acquireLock(testLockName, testTtl);
      expect(result).toBe(true);

      const lock = await Lock.findById(testLockName);
      expect(lock).toBeTruthy();
    });

    it('should fail to acquire an existing lock', async () => {
      await Lock.acquireLock(testLockName, testTtl);
      const result = await Lock.acquireLock(testLockName);
      expect(result).toBe(false);
    });

    it('should throw non-duplicate key errors', async () => {
      // Simulate a validation error
      const invalidLockName = null;
      await expect(Lock.acquireLock(invalidLockName!)).rejects.toThrow();
    });
  });

  describe('releaseLock()', () => {
    it('should successfully release an existing lock', async () => {
      await Lock.acquireLock(testLockName);
      const result = await Lock.releaseLock(testLockName);
      expect(result).toBe(true);

      const lock = await Lock.findById(testLockName);
      expect(lock).toBeNull();
    });

    it('should return false when releasing non-existent lock', async () => {
      const result = await Lock.releaseLock('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('getLockData()', () => {
    it('should return ttl:0 for non-existent lock', async () => {
      const data = await Lock.getLockData('non-existent');
      expect(data.ttl).toBe(0);
    });

    it('should return correct ttl for existing lock', async () => {
      const startTime = Date.now();
      await Lock.acquireLock(testLockName, testTtl);

      const data = await Lock.getLockData(testLockName);
      const expectedTtl = testTtl * 1000 - (Date.now() - startTime);

      // Allow 100ms tolerance for test execution time
      expect(data.ttl).toBeGreaterThan(expectedTtl - 100);
      expect(data.ttl).toBeLessThanOrEqual(testTtl * 1000);
    });
  });

  describe('getLocksData()', () => {
    it('should return ttl for multiple locks in input order', async () => {
      const names = ['lock1', 'lock2', 'lock3'];
      await Lock.acquireLock(names[0], 10);
      await Lock.acquireLock(names[2], 20);

      const results = await Lock.getLocksData(names);

      expect(results).toHaveLength(3);
      expect(results.map((r) => r.name)).toEqual(names);
      expect(results[0].ttl).toBeGreaterThan(0);
      expect(results[1].ttl).toBe(0);
      expect(results[2].ttl).toBeGreaterThan(0);
    });
  });

  describe('waitForUnlock()', () => {
    it('should resolve immediately if lock does not exist', async () => {
      await expect(Lock.waitForUnlock('non-existent')).resolves.toBeUndefined();
    });

    it('should wait until lock is released', async () => {
      await Lock.acquireLock(testLockName);
      let unlocked = false;

      // Start waiting for unlock
      const waitPromise = Lock.waitForUnlock(testLockName).then(() => {
        unlocked = true;
      });

      // Release lock after short delay
      setTimeout(async () => {
        await Lock.releaseLock(testLockName);
      }, 100);

      await waitPromise;
      expect(unlocked).toBe(true);
    }, 1000); // Increase timeout if needed
  });
});

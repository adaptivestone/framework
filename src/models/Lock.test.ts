import { beforeAll, describe, expect, it, vi } from 'vitest';
import { appInstance } from '../helpers/appInstance.ts';
import type { TLock } from './Lock.ts';

describe('Lock Model', () => {
  let Lock: TLock;
  const testLockName = 'test-lock';
  const testTtl = 30; // seconds

  beforeAll(async () => {
    Lock = appInstance.getModel('Lock') as unknown as TLock;
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

    it('rethrows a non-duplicate-key error instead of swallowing it', async () => {
      // The old null-name validation trick no longer applies (findOneAndUpdate
      // upsert accepts it), so force a non-11000 failure directly: only E11000
      // (a live lock already exists) should be swallowed into `false`.
      const err = Object.assign(new Error('db exploded'), { code: 121 });
      const spy = vi
        .spyOn(Lock, 'findOneAndUpdate')
        .mockRejectedValueOnce(err as never);
      await expect(Lock.acquireLock('any-lock')).rejects.toThrow('db exploded');
      spy.mockRestore();
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

  describe('acquireLock() expiry + concurrency (doc 16)', () => {
    it('steals an expired lock immediately, without waiting for the TTL reaper', async () => {
      const name = 'reaper-lock';
      // A logically-expired doc the TTL monitor hasn't reaped yet.
      await Lock.create({ _id: name, expiredAt: new Date(Date.now() - 1000) });

      const result = await Lock.acquireLock(name, testTtl);
      expect(result).toBe(true);

      const data = await Lock.getLockData(name);
      expect(data.ttl).toBeGreaterThan(0); // expiry was pushed into the future
    });

    it('does not steal a live (unexpired) lock', async () => {
      const name = 'live-lock';
      expect(await Lock.acquireLock(name, testTtl)).toBe(true);
      expect(await Lock.acquireLock(name, testTtl)).toBe(false);
      expect(await Lock.releaseLock(name)).toBe(true);
      expect(await Lock.acquireLock(name, testTtl)).toBe(true);
    });

    it('grants exactly one winner under concurrent contention', async () => {
      const name = 'concurrency-lock';
      const results = await Promise.all(
        Array.from({ length: 10 }, () => Lock.acquireLock(name, testTtl)),
      );
      expect(results.filter((r) => r === true)).toHaveLength(1);
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

    it('resolves via the post-live re-check when the lock is already gone', async () => {
      const name = 'delete-recheck-lock';
      await Lock.acquireLock(name);
      await Lock.releaseLock(name);
      // The doc is already gone before the stream goes live. The existence
      // re-check runs only once the stream is confirmed live and resolves,
      // rather than waiting on a delete that has already happened.
      await expect(Lock.waitForUnlock(name)).resolves.toBeUndefined();
    });

    it('observes a delete landing in the existence-check → stream-open window', async () => {
      const name = 'delete-race-lock';
      await Lock.acquireLock(name);

      // Force the delete to commit exactly when the existence read resolves,
      // i.e. inside the historical race window. With the pre-fix ordering
      // (findOne first, THEN attach the listener) the cursor's start point
      // lands after the delete, the 'change' never arrives, and the no-timeout
      // promise hangs — this test then fails via its own timeout. The fix runs
      // the existence check only after the stream is live, so the delete is
      // observed and the promise resolves.
      const spy = vi
        .spyOn(Lock, 'findOne')
        .mockImplementationOnce((() =>
          Lock.releaseLock(name).then(() => ({ _id: name }))) as never);

      try {
        await expect(Lock.waitForUnlock(name)).resolves.toBe(true);
      } finally {
        spy.mockRestore();
      }
    }, 3000);

    it('rejects after timeoutMs while a lock is still held', async () => {
      const name = 'timeout-lock';
      await Lock.acquireLock(name, testTtl);
      await expect(Lock.waitForUnlock(name, 50)).rejects.toThrow(/timed out/);
      await Lock.releaseLock(name);
    }, 1000);
  });
});

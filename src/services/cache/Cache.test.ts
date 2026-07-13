import { setTimeout } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import { appInstance } from '../../helpers/appInstance.ts';
import MemoryDriver from './drivers/MemoryDriver.ts';

describe('cache', () => {
  const time = Date.now();

  it('defaults to the in-memory driver (redis is optional)', () => {
    expect.assertions(1);
    expect(appInstance.cache.driver).toBeInstanceOf(MemoryDriver);
  });

  it('a zero storeTime skips the cache and recomputes every call (issue #10)', async () => {
    expect.assertions(3);
    const { cache } = appInstance;
    let counter = 0;
    const compute = async () => {
      counter += 1;
      return counter;
    };

    const first = await cache.getSetValue('ZERO_TTL', compute, 0);
    const second = await cache.getSetValue('ZERO_TTL', compute, 0);

    expect(first).toBe(1);
    expect(second).toBe(2); // not served from cache
    expect(counter).toBe(2);
  });

  it('a negative storeTime skips the cache and recomputes every call (issue #10)', async () => {
    expect.assertions(3);
    const { cache } = appInstance;
    let counter = 0;
    const compute = async () => {
      counter += 1;
      return counter;
    };

    // A negative storeTime (e.g. from `(expiresAt - Date.now())/1000` once the
    // source is already expired) must never persist a never-expiring entry.
    const first = await cache.getSetValue('NEG_TTL', compute, -5);
    const second = await cache.getSetValue('NEG_TTL', compute, -5);

    expect(first).toBe(1);
    expect(second).toBe(2); // recomputed, not served from a stale entry
    expect(counter).toBe(2);
  });

  it('can get set values', async () => {
    expect.assertions(2);

    const { cache } = appInstance;

    const res = await cache.getSetValue('TEST_TIME', async () => time);

    expect(res).toStrictEqual(time);

    const res2 = await cache.getSetValue('TEST_TIME', async () => '123');

    expect(res2).toStrictEqual(time);
  });

  it('can delete values', async () => {
    expect.assertions(1);

    const { cache } = appInstance;

    await cache.removeKey('TEST_TIME');

    const res2 = await cache.getSetValue('TEST_TIME', async () => '123');

    expect(res2).toBe('123');
  });

  it('can works with big int', async () => {
    expect.assertions(2);

    const { cache } = appInstance;

    const res = await cache.getSetValue('BIN_INT', async () => 1n);

    expect(res).toBe(1n);

    const res2 = await cache.getSetValue('BIN_INT', async () => '1111');

    expect(res2).toBe(1n);
  });

  it('can execute only one request per time', async () => {
    expect.assertions(3);

    const { cache } = appInstance;
    let counter = 0;

    const f = async () => {
      await setTimeout(10);
      counter += 1;
      return 1;
    };

    const [res, res1] = await Promise.all([
      cache.getSetValue('T', f),
      cache.getSetValue('T', f),
    ]);

    expect(counter).toBe(1);

    expect(res).toBe(1);
    expect(res1).toBe(1);
  });

  it('can handle problems on onNotFound', async () => {
    expect.assertions(1);

    const getAsyncThrow = async () => {
      throw new Error('err');
    };
    let err: Error | null = null;

    const { cache } = appInstance;

    try {
      await Promise.all([
        cache.getSetValue('THROW', getAsyncThrow),
        cache.getSetValue('THROW', getAsyncThrow),
      ]);
    } catch (e: unknown) {
      err = e as Error;
    }

    expect(err?.message).toBe('err');
  });

  describe('failure paths (doc 09)', () => {
    it('falls back to onNotFound on a driver read failure, without deadlocking the key', async () => {
      expect.assertions(2);
      const { cache } = appInstance;
      const spy = vi
        .spyOn(cache.driver, 'get')
        .mockRejectedValueOnce(new Error('cache down'));

      // Cache outage degrades to computing the value, not failing the request.
      const first = await cache.getSetValue('DEADLOCK', async () => 'computed');
      expect(first).toBe('computed');
      spy.mockRestore();

      // The in-flight mapping cleared (finally), so a later call isn't stuck on a
      // forever-pending promise — it recomputes and succeeds.
      const second = await cache.getSetValue(
        'DEADLOCK',
        async () => 'recovered',
      );
      expect(second).toBe('recovered');
    });

    it('a single-caller onNotFound failure causes no unhandled rejection', async () => {
      expect.assertions(1);
      const { cache } = appInstance;
      // vitest fails the run on an unhandled rejection; the no-op `.catch` on the
      // in-flight promise is what keeps this single-caller failure clean.
      await expect(
        cache.getSetValue('SINGLE_THROW', async () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
    });

    it('a failed cache write still returns the computed value', async () => {
      expect.assertions(1);
      const { cache } = appInstance;
      const spy = vi
        .spyOn(cache.driver, 'set')
        .mockRejectedValueOnce(new Error('set down'));

      const res = await cache.getSetValue('SET_FAIL', async () => 'computed');
      expect(res).toBe('computed');
      spy.mockRestore();
    });

    it('onNotFound returning undefined does not crash (skips the write)', async () => {
      expect.assertions(1);
      const { cache } = appInstance;
      const res = await cache.getSetValue('UNDEF', async () => undefined);
      expect(res).toBeUndefined();
    });
  });
});

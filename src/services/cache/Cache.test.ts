import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { appInstance } from '../../helpers/appInstance.ts';
import type { IApp } from '../../server.ts';
import { assertRejectsLike } from '../../tests/assertions.ts';
import { mockRejectedValueOnce, mockResolvedValue } from '../../tests/mocks.ts';
import Cache from './Cache.ts';
import MemoryDriver from './drivers/MemoryDriver.ts';
import RedisDriver from './drivers/RedisDriver.ts';

describe('cache', () => {
  const time = Date.now();

  it('accepts an injected driver and selects redis only when configured', () => {
    const injected = {
      get: mockResolvedValue(mock.fn(), null),
      set: mockResolvedValue(mock.fn(), undefined),
      del: mockResolvedValue(mock.fn(), 0),
    };
    const app = (driver: unknown) =>
      ({
        getConfig: (name: string) =>
          name === 'cache' ? { driver } : { namespace: 'unit' },
      }) as unknown as IApp;

    assert.strictEqual(new Cache(app(injected)).driver, injected);
    assert.ok(new Cache(app('redis')).driver instanceof RedisDriver);
  });

  it('defaults to the in-memory driver (redis is optional)', () => {
    assert.ok(appInstance.cache.driver instanceof MemoryDriver);
  });

  it('a zero storeTime skips the cache and recomputes every call (issue #10)', async () => {
    const { cache } = appInstance;
    let counter = 0;
    const compute = async () => {
      counter += 1;
      return counter;
    };

    const first = await cache.getSetValue('ZERO_TTL', compute, 0);
    const second = await cache.getSetValue('ZERO_TTL', compute, 0);

    assert.strictEqual(first, 1);
    assert.strictEqual(second, 2); // not served from cache
    assert.strictEqual(counter, 2);
  });

  it('a negative storeTime skips the cache and recomputes every call (issue #10)', async () => {
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

    assert.strictEqual(first, 1);
    assert.strictEqual(second, 2); // recomputed, not served from a stale entry
    assert.strictEqual(counter, 2);
  });

  it('can get set values', async () => {
    const { cache } = appInstance;

    const res = await cache.getSetValue('TEST_TIME', async () => time);

    assert.deepStrictEqual(res, time);

    const res2 = await cache.getSetValue('TEST_TIME', async () => '123');

    assert.deepStrictEqual(res2, time);
  });

  it('can delete values', async () => {
    const { cache } = appInstance;

    await cache.removeKey('TEST_TIME');

    const res2 = await cache.getSetValue('TEST_TIME', async () => '123');

    assert.strictEqual(res2, '123');
  });

  it('can works with big int', async () => {
    const { cache } = appInstance;

    const res = await cache.getSetValue('BIN_INT', async () => 1n);

    assert.strictEqual(res, 1n);

    const res2 = await cache.getSetValue('BIN_INT', async () => '1111');

    assert.strictEqual(res2, 1n);
  });

  it('can execute only one request per time', async () => {
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

    assert.strictEqual(counter, 1);

    assert.strictEqual(res, 1);
    assert.strictEqual(res1, 1);
  });

  it('can handle problems on onNotFound', async () => {
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

    assert.strictEqual(err?.message, 'err');
  });

  describe('failure paths (doc 09)', () => {
    it('recomputes and overwrites a corrupt cached value', async () => {
      const { cache } = appInstance;
      const key = cache.getKeyWithNameSpace('CORRUPT');
      await cache.driver.set(key, '{not-json', 300);

      const result = await cache.getSetValue('CORRUPT', async () => 'repaired');

      assert.strictEqual(result, 'repaired');
      assert.strictEqual(
        await cache.driver.get(key),
        JSON.stringify('repaired'),
      );
    });

    it('falls back to onNotFound on a driver read failure, without deadlocking the key', async () => {
      const { cache } = appInstance;
      const spy = mockRejectedValueOnce(
        mock.method(cache.driver, 'get'),
        new Error('cache down'),
      );

      // Cache outage degrades to computing the value, not failing the request.
      const first = await cache.getSetValue('DEADLOCK', async () => 'computed');
      assert.strictEqual(first, 'computed');
      spy.mock.restore();

      // The in-flight mapping cleared (finally), so a later call isn't stuck on a
      // forever-pending promise — it recomputes and succeeds.
      const second = await cache.getSetValue(
        'DEADLOCK',
        async () => 'recovered',
      );
      assert.strictEqual(second, 'recovered');
    });

    it('a single-caller onNotFound failure causes no unhandled rejection', async () => {
      const { cache } = appInstance;
      // node:test fails the run on an unhandled rejection; the no-op `.catch` on the
      // in-flight promise is what keeps this single-caller failure clean.
      await assertRejectsLike(
        cache.getSetValue('SINGLE_THROW', async () => {
          throw new Error('boom');
        }),
        'boom',
      );
    });

    it('a failed cache write still returns the computed value', async () => {
      const { cache } = appInstance;
      const spy = mockRejectedValueOnce(
        mock.method(cache.driver, 'set'),
        new Error('set down'),
      );

      const res = await cache.getSetValue('SET_FAIL', async () => 'computed');
      assert.strictEqual(res, 'computed');
      spy.mock.restore();
    });

    it('onNotFound returning undefined does not crash (skips the write)', async () => {
      const { cache } = appInstance;
      const res = await cache.getSetValue('UNDEF', async () => undefined);
      assert.strictEqual(res, undefined);
    });

    it('returns zero when cache invalidation fails', async () => {
      const { cache } = appInstance;
      const del = mockRejectedValueOnce(
        mock.method(cache.driver, 'del'),
        new Error('delete down'),
      );

      await assert.strictEqual(await cache.removeKey('DELETE_FAIL'), 0);
      del.mock.restore();
    });
  });
});

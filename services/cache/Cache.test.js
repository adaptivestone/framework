import { describe, it, expect } from 'vitest';
import { setTimeout } from 'node:timers/promises';

describe('cache', () => {
  const time = Date.now();

  it('can get set values', async () => {
    expect.assertions(2);

    const { cache } = global.server.app;

    const res = await cache.getSetValue('TEST_TIME', () => time);

    expect(res).toStrictEqual(time);

    const res2 = await cache.getSetValue('TEST_TIME', () => '123');

    expect(res2).toStrictEqual(time);
  });

  it('can delete values', async () => {
    expect.assertions(1);

    const { cache } = global.server.app;

    await cache.removeKey('TEST_TIME');

    const res2 = await cache.getSetValue('TEST_TIME', () => '123');

    expect(res2).toBe('123');
  });

  it('can works with big int', async () => {
    expect.assertions(2);

    const { cache } = global.server.app;

    const res = await cache.getSetValue('BIN_INT', () => 1n);

    expect(res).toBe(1n);

    const res2 = await cache.getSetValue('BIN_INT', () => '1111');

    expect(res2).toBe(1n);
  });

  it('can execute only one request per time', async () => {
    expect.assertions(3);

    const { cache } = global.server.app;
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
    let err;

    const { cache } = global.server.app;

    try {
      await Promise.all([
        cache.getSetValue('THROW', getAsyncThrow),
        cache.getSetValue('THROW', getAsyncThrow),
      ]);
    } catch (e) {
      err = e;
    }

    expect(err.message).toBe('err');
  });
});

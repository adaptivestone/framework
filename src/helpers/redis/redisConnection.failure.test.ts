import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import {
  assertCalledTimes,
  assertCalledWith,
  assertRejectsLike,
  pattern,
} from '../../tests/assertions.ts';
import { appInstance } from '../appInstance.ts';

const mockedRedis = (() => {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const client = {
    connect: mock.fn(() => Promise.reject(new Error('connect down'))),
    on: mock.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler);
      return client;
    }),
    quit: mock.fn(() => Promise.resolve()),
    isOpen: false,
  };
  return { client, handlers, createClient: mock.fn(() => client) };
})();

mock.module('@redis/client', {
  exports: { createClient: mockedRedis.createClient },
});

const { getRedisClient, getRedisClientSync } = await import(
  './redisConnection.ts'
);

describe('redisConnection failure recovery', () => {
  it('clears a failed client, logs sync failures, and forwards client errors', async () => {
    const logError = mock.method(
      appInstance.logger,
      'error',
      () => appInstance.logger,
    );
    try {
      await assertRejectsLike(getRedisClient(), 'connect down');
      await Promise.resolve();

      await assertRejectsLike(getRedisClient(), 'connect down');
      assertCalledTimes(mockedRedis.createClient, 2);
      await Promise.resolve();

      assert.strictEqual(getRedisClientSync(), mockedRedis.client);
      await Promise.resolve();
      await Promise.resolve();
      assertCalledWith(
        logError,
        pattern.stringContaining('Redis connect failed'),
      );

      mockedRedis.handlers.get('error')?.('socket down', 'extra-a', 'extra-b');
      assertCalledWith(
        logError,
        'Redis Client Error',
        'socket down',
        'extra-a',
        'extra-b',
      );
    } finally {
      logError.mock.restore();
    }
  });
});

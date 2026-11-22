import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import type { Response } from 'express';
import { appInstance } from '../../../helpers/appInstance.ts';
import { assertCalledWith, pattern } from '../../../tests/assertions.ts';
import type { FrameworkRequest } from '../HttpServer.ts';

// The Redis client parses `redis.url` when it is built and throws on a
// malformed one, as `createClient` does.
mock.module('@redis/client', {
  exports: {
    createClient: mock.fn(() => {
      throw new TypeError('Invalid URL');
    }),
  },
});

const { default: RateLimiter } = await import('./RateLimiter.ts');

describe('RateLimiter when the Redis client cannot be built', () => {
  it('logs an error naming redis.url and answers 500', async () => {
    const limiter = new RateLimiter(appInstance, { driver: 'redis' });
    const logError = mock.method(limiter.logger, 'error', () => limiter.logger);
    try {
      await limiter.whenReady;
      assertCalledWith(logError, pattern.stringContaining('redis.url'));

      let status = 0;
      const res = {
        status(code: number) {
          status = code;
          return res;
        },
        json() {
          return res;
        },
      } as unknown as Response;
      const next = mock.fn();
      await limiter.middleware({} as FrameworkRequest, res, next);
      assert.strictEqual(status, 500);
      assert.strictEqual(next.mock.callCount(), 0);
    } finally {
      logError.mock.restore();
    }
  });
});

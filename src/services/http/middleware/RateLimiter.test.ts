import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it, mock } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import type { Response } from 'express';
import { appInstance } from '../../../helpers/appInstance.ts';
import { mockRejectedValue } from '../../../tests/mocks.ts';
import type { FrameworkRequest } from '../HttpServer.ts';
import RateLimiter from './RateLimiter.ts';

let mongoRateLimiter: RateLimiter;

describe('rate limiter methods', () => {
  before(async () => {
    await setTimeout(20);

    mongoRateLimiter = new RateLimiter(appInstance, {
      driver: 'mongo',
      limiterOptions: {
        keyPrefix: `mongo_${Date.now()}_${crypto.randomUUID()}}`,
      },
    });
  });

  after(async () => {
    // we need to wait because redis mongo ask mongo to create indexes
    await setTimeout(200);
  });

  it('have description fields', async () => {
    // const middleware = new RateLimiter(appInstance, {
    //   driver: 'redis',
    // });

    assert.notStrictEqual(RateLimiter.description, undefined);
  });

  it('can create redis rateLimiter', async () => {
    const redisRateLimiter = new RateLimiter(appInstance, {
      driver: 'redis',
    });
    // The redis limiter builds lazily (it dynamic-imports `@redis/client`).
    await redisRateLimiter.whenReady;

    assert.notStrictEqual(redisRateLimiter.limiter, undefined);
  });

  it('can not create rateLimiter with unknown driver', async () => {
    const rateLimiter = new RateLimiter(appInstance, {
      driver: 'unknown',
    });

    assert.strictEqual(rateLimiter.limiter, undefined);
  });

  it('generateConsumeKey works correctly', async () => {
    const redisRateLimiter = new RateLimiter(appInstance, {
      driver: 'redis',
    });

    const res = await redisRateLimiter.gerenateConsumeKey({
      appInfo: {
        ip: '192.168.0.0',
        user: {
          id: 'someId',
        },
      },
    } as unknown as FrameworkRequest);

    assert.strictEqual(res, '192.168.0.0__someId');
  });

  it('generateConsumeKey with request works correctly', async () => {
    const redisRateLimiter = new RateLimiter(appInstance, {
      driver: 'redis',
      consumeKeyComponents: {
        request: ['email'],
      },
    });

    const res = await redisRateLimiter.gerenateConsumeKey({
      appInfo: {
        ip: '192.168.0.0',
      },
      body: {
        email: 'foo@example.com',
      },
    } as FrameworkRequest);

    assert.strictEqual(res, '192.168.0.0__foo@example.com');
  });

  it('middleware without driver should fail', async () => {
    const rateLimiter = new RateLimiter(appInstance, {
      driver: 'unknown',
    });
    const req = {
      appInfo: {},
    };
    let status = 0;
    let isSend = false;
    await rateLimiter.middleware(
      req as FrameworkRequest,
      {
        status(statusCode) {
          status = statusCode;
          return this;
        },
        json() {
          isSend = true;
        },
        setHeader(_name, _value) {
          return this;
        },
      } as Response,
      () => {},
    );

    assert.strictEqual(status, 500);
    assert.ok(isSend);
  });

  const makeOneRequest = async ({
    rateLimiter,
    driver,
    request = {},
  }: {
    rateLimiter?: RateLimiter;
    driver?: string;
    request?: { ip?: string; appInfo?: object };
  }) => {
    let realRateLimiter = rateLimiter;
    if (!realRateLimiter) {
      realRateLimiter = new RateLimiter(appInstance, {
        driver,
      });
    }
    const req = {
      appInfo: {},
      ...request,
    };
    let status = 0;
    let isSend = false;
    let isNextCalled = false;
    await realRateLimiter.middleware(
      req as FrameworkRequest,
      {
        status(statusCode: number) {
          status = statusCode;
          return this;
        },
        json() {
          isSend = true;
        },
        setHeader(_name, _value) {
          return this;
        },
      } as Response,
      () => {
        isNextCalled = true;
      },
    );
    return { status, isSend, isNextCalled };
  };

  it('middleware should works with a mongo drivers', async () => {
    const { isNextCalled } = await makeOneRequest({
      rateLimiter: mongoRateLimiter,
      request: { ip: '10.10.0.1' },
    });

    assert.ok(isNextCalled);
  });

  it('middleware should works with a memory drivers', async () => {
    const { isNextCalled } = await makeOneRequest({
      driver: 'memory',
      request: { ip: '10.10.0.1' },
    });

    assert.ok(isNextCalled);
  });

  it('middleware should works with a redis drivers', async () => {
    const { isNextCalled } = await makeOneRequest({
      driver: 'redis',
      request: { ip: '10.10.0.1' },
    });

    assert.ok(isNextCalled);
  });

  it('middleware should rate limits for us. mongo driver', async () => {
    const middlewares = Array.from({ length: 20 }, () =>
      makeOneRequest({ rateLimiter: mongoRateLimiter }),
    );

    const data = await Promise.all(middlewares);

    const status = data.find((obj) => obj.status === 429);
    const isSend = data.find((obj) => obj.isSend);

    assert.strictEqual(status?.status, 429);
    assert.ok(isSend?.isSend);
  });

  it('middleware should rate limits for us. memory driver', async () => {
    const rateLimiter = new RateLimiter(appInstance, {
      driver: 'memory',
    });

    const middlewares = Array.from({ length: 20 }, () =>
      makeOneRequest({ rateLimiter }),
    );

    const data = await Promise.all(middlewares);

    const status = data.find((obj) => obj.status === 429);
    const isSend = data.find((obj) => obj.isSend);

    assert.strictEqual(status?.status, 429);
    assert.ok(isSend?.isSend);
  });

  it('middleware should rate limits for us. redis driver', async () => {
    const rateLimiter = new RateLimiter(appInstance, {
      driver: 'redis',
    });

    const middlewares = Array.from({ length: 20 }, () =>
      makeOneRequest({ rateLimiter }),
    );

    const data = await Promise.all(middlewares);

    const status = data.find((obj) => obj.status === 429);
    const isSend = data.find((obj) => obj.isSend);

    assert.strictEqual(status?.status, 429);
    assert.ok(isSend?.isSend);
  });

  describe('store failure handling (doc 10)', () => {
    it('a store failure (consume rejects with an Error) fails OPEN, not 429', async () => {
      const rateLimiter = new RateLimiter(appInstance, { driver: 'memory' });
      mockRejectedValue(
        mock.method(rateLimiter.limiter, 'consume'),
        new Error('store down'),
      );
      const { status, isNextCalled } = await makeOneRequest({
        rateLimiter,
        request: { ip: '10.10.0.2' },
      });
      assert.strictEqual(isNextCalled, true);
      assert.notStrictEqual(status, 429);
    });

    it('a real limit hit (consume rejects with RateLimiterRes) → 429 + Retry-After', async () => {
      const rateLimiter = new RateLimiter(appInstance, { driver: 'memory' });
      mockRejectedValue(mock.method(rateLimiter.limiter, 'consume'), {
        msBeforeNext: 5000,
      } as never);

      let status = 0;
      let retryAfter = '';
      await rateLimiter.middleware(
        { appInfo: {}, ip: '10.10.0.3' } as unknown as FrameworkRequest,
        {
          status(s: number) {
            status = s;
            return this;
          },
          json() {},
          setHeader(name: string, value: string) {
            if (name === 'Retry-After') {
              retryAfter = value;
            }
            return this;
          },
        } as unknown as Response,
        () => {},
      );

      assert.strictEqual(status, 429);
      assert.strictEqual(retryAfter, '5');
    });

    it('keeps limiting via the memory insurance when the redis store fails', async () => {
      const rateLimiter = new RateLimiter(appInstance, { driver: 'redis' });
      await rateLimiter.whenReady; // redis limiter builds lazily
      // Force every redis store write to fail so rate-limiter-flexible falls back
      // to the insurance limiter. `_upsert` is the library's store-write hook
      // (RateLimiterStoreAbstract) — if it ever renames, this test breaks loudly.
      mockRejectedValue(
        mock.method(
          rateLimiter.limiter as unknown as { _upsert: () => Promise<unknown> },
          '_upsert',
        ),
        new Error('store down'),
      );

      // Same shape as the real redis-limit test, but with the store broken: the
      // memory insurance (same limiterOptions) must still enforce the limit.
      const data = await Promise.all(
        Array.from({ length: 20 }, () =>
          makeOneRequest({ rateLimiter, request: { ip: '10.10.0.9' } }),
        ),
      );

      assert.strictEqual(
        data.some((r) => r.status === 429),
        true,
      ); // insurance limits
      assert.strictEqual(
        data.some((r) => r.isNextCalled),
        true,
      ); // and some pass
    });
  });
});

import crypto from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import type { Response } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { appInstance } from '../../../helpers/appInstance.ts';
import type { FrameworkRequest } from '../HttpServer.ts';
import RateLimiter from './RateLimiter.ts';

let mongoRateLimiter: RateLimiter;

describe('rate limiter methods', () => {
  beforeAll(async () => {
    await setTimeout(20);

    mongoRateLimiter = new RateLimiter(appInstance, {
      driver: 'mongo',
      limiterOptions: {
        keyPrefix: `mongo_${Date.now()}_${crypto.randomUUID()}}`,
      },
    });
  });

  afterAll(async () => {
    // we need to wait because redis mongo ask mongo to create indexes
    await setTimeout(200);
  });

  it('have description fields', async () => {
    expect.assertions(1);

    // const middleware = new RateLimiter(appInstance, {
    //   driver: 'redis',
    // });

    expect(RateLimiter.description).toBeDefined();
  });

  it('can create redis rateLimiter', async () => {
    expect.assertions(1);

    const redisRateLimiter = new RateLimiter(appInstance, {
      driver: 'redis',
    });

    expect(redisRateLimiter.limiter).toBeDefined();
  });

  it('can not create rateLimiter with unknown driver', async () => {
    expect.assertions(1);

    const rateLimiter = new RateLimiter(appInstance, {
      driver: 'unknown',
    });

    expect(rateLimiter.limiter).toBeUndefined();
  });

  it('generateConsumeKey works correctly', async () => {
    expect.assertions(1);

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

    expect(res).toBe('192.168.0.0__someId');
  });

  it('generateConsumeKey with request works correctly', async () => {
    expect.assertions(1);

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

    expect(res).toBe('192.168.0.0__foo@example.com');
  });

  it('middleware without driver should fail', async () => {
    expect.assertions(2);

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

    expect(status).toBe(500);
    expect(isSend).toBeTruthy();
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
    expect.assertions(1);

    const { isNextCalled } = await makeOneRequest({
      rateLimiter: mongoRateLimiter,
      request: { ip: '10.10.0.1' },
    });

    expect(isNextCalled).toBeTruthy();
  });

  it('middleware should works with a memory drivers', async () => {
    expect.assertions(1);

    const { isNextCalled } = await makeOneRequest({
      driver: 'memory',
      request: { ip: '10.10.0.1' },
    });

    expect(isNextCalled).toBeTruthy();
  });

  it('middleware should works with a redis drivers', async () => {
    expect.assertions(1);

    const { isNextCalled } = await makeOneRequest({
      driver: 'redis',
      request: { ip: '10.10.0.1' },
    });

    expect(isNextCalled).toBeTruthy();
  });

  it('middleware should rate limits for us. mongo driver', async () => {
    expect.assertions(2);

    const middlewares = Array.from({ length: 20 }, () =>
      makeOneRequest({ rateLimiter: mongoRateLimiter }),
    );

    const data = await Promise.all(middlewares);

    const status = data.find((obj) => obj.status === 429);
    const isSend = data.find((obj) => obj.isSend);

    expect(status?.status).toBe(429);
    expect(isSend?.isSend).toBeTruthy();
  });

  it('middleware should rate limits for us. memory driver', async () => {
    expect.assertions(2);

    const rateLimiter = new RateLimiter(appInstance, {
      driver: 'memory',
    });

    const middlewares = Array.from({ length: 20 }, () =>
      makeOneRequest({ rateLimiter }),
    );

    const data = await Promise.all(middlewares);

    const status = data.find((obj) => obj.status === 429);
    const isSend = data.find((obj) => obj.isSend);

    expect(status?.status).toBe(429);
    expect(isSend?.isSend).toBeTruthy();
  });

  it('middleware should rate limits for us. redis driver', async () => {
    expect.assertions(2);

    const rateLimiter = new RateLimiter(appInstance, {
      driver: 'redis',
    });

    const middlewares = Array.from({ length: 20 }, () =>
      makeOneRequest({ rateLimiter }),
    );

    const data = await Promise.all(middlewares);

    const status = data.find((obj) => obj.status === 429);
    const isSend = data.find((obj) => obj.isSend);

    expect(status?.status).toBe(429);
    expect(isSend?.isSend).toBeTruthy();
  });

  describe('store failure handling (doc 10)', () => {
    it('a store failure (consume rejects with an Error) fails OPEN, not 429', async () => {
      expect.assertions(2);
      const rateLimiter = new RateLimiter(appInstance, { driver: 'memory' });
      vi.spyOn(rateLimiter.limiter, 'consume').mockRejectedValue(
        new Error('store down'),
      );
      const { status, isNextCalled } = await makeOneRequest({
        rateLimiter,
        request: { ip: '10.10.0.2' },
      });
      expect(isNextCalled).toBe(true);
      expect(status).not.toBe(429);
    });

    it('a real limit hit (consume rejects with RateLimiterRes) → 429 + Retry-After', async () => {
      expect.assertions(2);
      const rateLimiter = new RateLimiter(appInstance, { driver: 'memory' });
      vi.spyOn(rateLimiter.limiter, 'consume').mockRejectedValue({
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

      expect(status).toBe(429);
      expect(retryAfter).toBe('5');
    });

    it('keeps limiting via the memory insurance when the redis store fails', async () => {
      expect.assertions(2);
      const rateLimiter = new RateLimiter(appInstance, { driver: 'redis' });
      // Force every redis store write to fail so rate-limiter-flexible falls back
      // to the insurance limiter. `_upsert` is the library's store-write hook
      // (RateLimiterStoreAbstract) — if it ever renames, this test breaks loudly.
      vi.spyOn(
        rateLimiter.limiter as unknown as { _upsert: () => Promise<unknown> },
        '_upsert',
      ).mockRejectedValue(new Error('store down'));

      // Same shape as the real redis-limit test, but with the store broken: the
      // memory insurance (same limiterOptions) must still enforce the limit.
      const data = await Promise.all(
        Array.from({ length: 20 }, () =>
          makeOneRequest({ rateLimiter, request: { ip: '10.10.0.9' } }),
        ),
      );

      expect(data.some((r) => r.status === 429)).toBe(true); // insurance limits
      expect(data.some((r) => r.isNextCalled)).toBe(true); // and some pass
    });
  });
});

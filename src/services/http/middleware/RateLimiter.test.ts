import { setTimeout } from 'node:timers/promises';
import crypto from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { appInstance } from '../../../helpers/appInstance.ts';

import RateLimiter from './RateLimiter.ts';
import type { FrameworkRequest } from '../HttpServer.ts';
import type { Response } from 'express';

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
    let status;
    let isSend;
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
    let status;
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
});

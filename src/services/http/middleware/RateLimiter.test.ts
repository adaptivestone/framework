import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it, mock } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import type { Response } from 'express';
import { appInstance } from '../../../helpers/appInstance.ts';
import { mockRejectedValue, stubI18n } from '../../../tests/mocks.ts';
import type { TI18n } from '../../i18n/I18n.ts';
import type { FrameworkRequest } from '../HttpServer.ts';
import { HttpError } from '../httpErrors.ts';
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

    const res = await redisRateLimiter.generateConsumeKey({
      appInfo: {
        ip: '192.168.0.0',
        user: {
          id: 'someId',
        },
      },
    } as unknown as FrameworkRequest);

    assert.strictEqual(res, '192.168.0.0_ALL:unmatched_someId');
  });

  it('keeps the misspelled method as an alias', () => {
    const limiter = new RateLimiter(appInstance, { driver: 'memory' });
    const req = { appInfo: { ip: '10.0.0.1' } } as unknown as FrameworkRequest;
    assert.strictEqual(
      limiter.gerenateConsumeKey(req),
      limiter.generateConsumeKey(req),
    );
  });

  describe('request key components', () => {
    const keyFor = (body: Record<string, unknown>, request = ['email']) =>
      new RateLimiter(appInstance, {
        driver: 'memory',
        consumeKeyComponents: { request },
      }).generateConsumeKey({
        appInfo: { ip: '192.168.0.0' },
        body,
      } as unknown as FrameworkRequest);

    it('hashes the field names and values into the key', () => {
      const expected = crypto
        .createHash('sha256')
        .update(JSON.stringify([['email', 'foo@example.com']]))
        .digest('hex');
      assert.strictEqual(
        keyFor({ email: 'foo@example.com' }),
        `192.168.0.0_ALL:unmatched_${expected}`,
      );
    });

    it('keeps raw request values out of the key', () => {
      assert.ok(!keyFor({ email: 'foo@example.com' }).includes('foo'));
    });

    it('folds case, surrounding spaces and compatibility forms together', () => {
      const key = keyFor({ email: 'foo@example.com' });
      for (const email of [
        'Foo@Example.com',
        '  FOO@example.com\t',
        'ｆｏｏ@example.com',
      ]) {
        assert.strictEqual(keyFor({ email }), key, email);
      }
    });

    it('keeps different values and different fields apart', () => {
      assert.notStrictEqual(
        keyFor({ email: 'foo@example.com' }),
        keyFor({ email: 'bar@example.com' }),
      );
      assert.notStrictEqual(
        keyFor({ email: 'a' }, ['email', 'phone']),
        keyFor({ phone: 'a' }, ['email', 'phone']),
      );
    });

    it('treats blank and non-scalar values as absent', () => {
      const noRequestPart = '192.168.0.0_ALL:unmatched';
      for (const email of ['', '   ', { a: 1 }, ['foo@example.com'], null]) {
        assert.strictEqual(keyFor({ email }), noRequestPart);
      }
      assert.notStrictEqual(keyFor({ email: 0 }), noRequestPart);
    });
  });

  it('still honours a subclass that overrides the misspelled method', async () => {
    const warnings: string[] = [];
    const onWarning = (w: Error) => warnings.push(w.message);
    process.on('warning', onWarning);
    try {
      class LegacyLimiter extends RateLimiter {
        gerenateConsumeKey() {
          return 'legacy-key';
        }
      }
      const limiter = new LegacyLimiter(appInstance, { driver: 'memory' });
      const consume = mock.method(limiter.limiter, 'consume');
      const req = { appInfo: {} } as unknown as FrameworkRequest;
      const res = {} as Response;
      await limiter.middleware(req, res, () => {});
      await limiter.middleware(req, res, () => {});
      await setTimeout(0); // warnings are emitted on the next tick

      assert.match(String(consume.mock.calls[0].arguments[0]), /-legacy-key$/);
      assert.strictEqual(
        warnings.filter((m) => m.includes('gerenateConsumeKey')).length,
        1,
      );
    } finally {
      process.off('warning', onWarning);
    }
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
    let isNextCalled = false;
    try {
      await realRateLimiter.middleware(
        req as FrameworkRequest,
        {} as Response,
        () => {
          isNextCalled = true;
        },
      );
    } catch (err) {
      if (!(err instanceof HttpError)) {
        throw err;
      }
      status = err.status;
    }
    return { status, isNextCalled };
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

    assert.ok(data.some((obj) => obj.status === 429));
  });

  it('middleware should rate limits for us. memory driver', async () => {
    const rateLimiter = new RateLimiter(appInstance, {
      driver: 'memory',
    });

    const middlewares = Array.from({ length: 20 }, () =>
      makeOneRequest({ rateLimiter }),
    );

    const data = await Promise.all(middlewares);

    assert.ok(data.some((obj) => obj.status === 429));
  });

  it('middleware should rate limits for us. redis driver', async () => {
    const rateLimiter = new RateLimiter(appInstance, {
      driver: 'redis',
    });

    const middlewares = Array.from({ length: 20 }, () =>
      makeOneRequest({ rateLimiter }),
    );

    const data = await Promise.all(middlewares);

    assert.ok(data.some((obj) => obj.status === 429));
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

      const req = {
        appInfo: {},
        ip: '10.10.0.3',
      } as unknown as FrameworkRequest;
      const thrown = await rateLimiter
        .middleware(req, {} as Response, () => {})
        .then(
          () => null,
          (err: unknown) => err,
        );
      const answer = await appInstance.httpServer?.resolveError(thrown, req);

      assert.strictEqual(answer?.status, 429);
      assert.deepStrictEqual(answer?.headers, { 'Retry-After': '5' });
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

/**
 * The 429 is a thrown `HttpError` answered through the error-handler registry,
 * so its message is translated. The 500 (`RateLimiter error`) stays
 * hardcoded on purpose — it reports a misconfigured limiter to operators, not
 * a condition the caller can act on in their own language.
 */
describe('rate limiter message translation', () => {
  const runLimited = async (i18n?: TI18n) => {
    const rateLimiter = new RateLimiter(appInstance, { driver: 'memory' });
    // A real limit hit rejects with a `RateLimiterRes`, not an Error.
    mockRejectedValue(mock.method(rateLimiter.limiter, 'consume'), {
      msBeforeNext: 5000,
    } as never);

    const req = {
      appInfo: { i18n },
      ip: '10.10.0.4',
    } as unknown as FrameworkRequest;
    const thrown = await rateLimiter
      .middleware(req, {} as Response, () => {})
      .then(
        () => null,
        (err: unknown) => err,
      );
    // Answered the way the HTTP layer answers a middleware error.
    const answer = await appInstance.httpServer?.resolveError(thrown, req);
    return { status: answer?.status, payload: answer?.body };
  };

  it('keeps the English text when the app locales lack the key', async () => {
    const i18nService = await appInstance.getI18nService();
    const { status, payload } = await runLimited(
      await i18nService.getI18nForLang('en'),
    );

    assert.strictEqual(status, 429);
    assert.deepStrictEqual(payload, {
      error: 'TOO_MANY_REQUESTS',
      message: 'Too Many Requests',
    });
  });

  it('uses the app translation when the key resolves', async () => {
    const { status, payload } = await runLimited(
      stubI18n({
        'middleware.rateLimiter.tooManyRequests': 'Слишком много запросов',
      }),
    );

    assert.strictEqual(status, 429);
    assert.deepStrictEqual(payload, {
      error: 'TOO_MANY_REQUESTS',
      message: 'Слишком много запросов',
    });
  });
});

import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import type { Response } from 'express';
import { appInstance } from '../../../helpers/appInstance.ts';
import { assertCalledTimes } from '../../../tests/assertions.ts';
import { mockImplementation } from '../../../tests/mocks.ts';
import type { FrameworkRequest } from '../HttpServer.ts';
import AbstractMiddleware from './AbstractMiddleware.ts';
import Auth from './Auth.ts';
import RateLimiter from './RateLimiter.ts';
import Role from './Role.ts';

/**
 * Base class every middleware extends. Covers its real default behavior: a
 * middleware that forgets to implement `middleware()` warns and falls through
 * (never silently drops the request), and `getMiddleware()` returns a bound
 * handler. The deprecated instance schema getters (removed in v6) are left
 * uncovered on purpose.
 */
describe('AbstractMiddleware base behavior', () => {
  it('default middleware warns and calls next() (request never dropped)', async () => {
    class Bare extends AbstractMiddleware {}
    const mw = new Bare(appInstance);
    const warn = mockImplementation(
      mock.method(mw.logger, 'warn'),
      () => mw.logger,
    );
    const next = mock.fn();
    await mw.middleware({} as FrameworkRequest, {} as Response, next);
    assertCalledTimes(next, 1);
    assertCalledTimes(warn, 1);
    warn.mock.restore();
  });

  it('getMiddleware returns the handler bound to the instance', async () => {
    class Bare extends AbstractMiddleware {}
    const mw = new Bare(appInstance);
    const bound = mw.getMiddleware();
    assert.strictEqual(typeof bound, 'function');
    const next = mock.fn();
    // `this` is preserved even when called detached (as Express does).
    await (bound as (...a: unknown[]) => Promise<unknown>)({}, {}, next);
    assertCalledTimes(next, 1);
  });

  it('exposes overridable defaults', () => {
    assert.ok(AbstractMiddleware.description.includes('Please provide'));
    assert.strictEqual(AbstractMiddleware.relatedQueryParameters, null);
    assert.strictEqual(AbstractMiddleware.relatedRequestParameters, null);
    assert.strictEqual(AbstractMiddleware.loggerGroup, 'middleware');
  });
});

/**
 * `translate()` is the seam that makes framework middleware messages
 * optionally translatable: a key plus the English default that ships in code.
 */
describe('AbstractMiddleware translate()', () => {
  // `translate` is protected — a subclass exposes it the way a consumer
  // middleware would use it from inside `middleware()`.
  class Translating extends AbstractMiddleware {
    call(req: FrameworkRequest, key: string, defaultValue: string) {
      return this.translate(req, key, defaultValue);
    }
  }

  it('returns the default when the request carries no i18n', () => {
    const mw = new Translating(appInstance);
    assert.strictEqual(
      mw.call({} as FrameworkRequest, 'middleware.some.key', 'English default'),
      'English default',
    );
    assert.strictEqual(
      mw.call(
        { appInfo: {} } as FrameworkRequest,
        'middleware.some.key',
        'English default',
      ),
      'English default',
    );
  });

  it('returns the default when the key is missing (real fallback translator)', () => {
    const mw = new Translating(appInstance);
    const req = {
      appInfo: {
        i18n: {
          language: 'en',
          t: (_key: string, options: unknown) => options,
        },
      },
    } as unknown as FrameworkRequest;
    // the fallback translator hands back what it got: `{ defaultValue }`
    assert.strictEqual(
      mw.call(req, 'middleware.some.key', 'English default'),
      'English default',
    );
  });

  it('prefers the translation when the key resolves', () => {
    const mw = new Translating(appInstance);
    const req = {
      appInfo: {
        i18n: {
          language: 'ru',
          t: (key: string) =>
            key === 'middleware.some.key' ? 'Переведено' : key,
        },
      },
    } as unknown as FrameworkRequest;
    assert.strictEqual(
      mw.call(req, 'middleware.some.key', 'English default'),
      'Переведено',
    );
  });

  it('falls back to the default when t() returns a non-string', () => {
    const mw = new Translating(appInstance);
    const req = {
      appInfo: {
        i18n: { language: 'en', t: () => ({ nested: 'object' }) },
      },
    } as unknown as FrameworkRequest;
    assert.strictEqual(
      mw.call(req, 'middleware.some.key', 'English default'),
      'English default',
    );
  });

  it('passes the key and the default through to t()', () => {
    const mw = new Translating(appInstance);
    const calls: Array<[string, unknown]> = [];
    const req = {
      appInfo: {
        i18n: {
          language: 'en',
          t: (key: string, options: unknown) => {
            calls.push([key, options]);
            return 'whatever';
          },
        },
      },
    } as unknown as FrameworkRequest;
    mw.call(req, 'middleware.some.key', 'English default');
    assert.deepStrictEqual(calls, [
      ['middleware.some.key', { defaultValue: 'English default' }],
    ]);
  });
});

// A built-in that only throws must keep the base return type, or a subclass
// answering with `res.json(...)` stops compiling (`check:types:tests`).
describe('built-in middleware subclasses', () => {
  it('may answer with a response instead of calling next()', async () => {
    const answered = { answered: true } as unknown as Response;
    const answer = (res: Response) => res.status(401).json({});
    class MyAuth extends Auth {
      async middleware(_req: FrameworkRequest, res: Response) {
        return answer(res);
      }
    }
    class MyRole extends Role {
      async middleware(_req: FrameworkRequest, res: Response) {
        return answer(res);
      }
    }
    class MyRateLimiter extends RateLimiter {
      async middleware(_req: FrameworkRequest, res: Response) {
        return answer(res);
      }
    }
    const res = {
      status: () => res,
      json: () => answered,
    } as unknown as Response;
    for (const Mw of [MyAuth, MyRole, MyRateLimiter]) {
      const result = await new Mw(appInstance).middleware(
        {} as FrameworkRequest,
        res,
      );
      assert.strictEqual(result, answered);
    }
  });
});

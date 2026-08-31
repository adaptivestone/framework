/**
 * Coverage tests for `HttpServer`'s 404 fallthrough + 500 error handler.
 * Uses the global test server set up in `setupNodeTest.ts` — no extra
 * server boot needed.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { NextFunction, Response } from 'express';
import { appInstance } from '../../helpers/appInstance.ts';
import { stubI18n } from '../../tests/mocks.ts';
import { getTestServerURL } from '../../tests/testHelpers.ts';
import type { TI18n } from '../i18n/I18n.ts';
import type { FrameworkRequest } from './HttpServer.ts';
import HttpServer from './HttpServer.ts';

describe('HttpServer — 404 fallthrough', () => {
  it('returns 404 JSON for unmatched paths', async () => {
    const res = await fetch(getTestServerURL('/this-path-does-not-exist'));
    assert.strictEqual(res.status, 404);
    const body = await res.json();
    assert.deepStrictEqual(body, { message: '404' });
  });
});

describe('HttpServer — security headers (doc 22)', () => {
  it('sets the default security headers on a response', async () => {
    const res = await fetch(getTestServerURL('/'));
    assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
    assert.strictEqual(res.headers.get('x-frame-options'), 'DENY');
    assert.strictEqual(res.headers.get('referrer-policy'), 'no-referrer');
    // Off by default (avoids HTTPS lock-in during local dev).
    assert.strictEqual(res.headers.get('strict-transport-security'), null);
    // x-powered-by stays disabled (regression).
    assert.strictEqual(res.headers.get('x-powered-by'), null);
  });

  it('sets the headers on a 404 too (global mount, before the adapter)', async () => {
    const res = await fetch(getTestServerURL('/no-such-route-xyz-22'));
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
  });

  it('can be disabled via config', async () => {
    const original = appInstance.getConfig('http').securityHeaders;
    appInstance.updateConfig('http', { securityHeaders: { enabled: false } });
    try {
      const res = await fetch(getTestServerURL('/'));
      assert.strictEqual(res.headers.get('x-content-type-options'), null);
    } finally {
      appInstance.updateConfig('http', { securityHeaders: original });
    }
  });
});

/**
 * The 404 and 500 sinks are plain Express handlers, not `AbstractMiddleware`
 * subclasses, so they run the same guarded `t(key, { defaultValue })` lookup
 * inline. Both are captured straight from `express.use()` and driven with a
 * stub request: an app that ships `http.*` keys gets its own wording, an app
 * that does not keeps the exact English text.
 */
describe('HttpServer — translatable sink messages', () => {
  const recordingResponse = () => {
    const captured = { status: 0, payload: {} as Record<string, unknown> };
    const res = {
      headersSent: false,
      status(code: number) {
        captured.status = code;
        return this;
      },
      json(body: Record<string, unknown>) {
        captured.payload = body;
        return this;
      },
    } as unknown as Response;
    return { captured, res };
  };

  /** Grab the handler a registration method hands to `express.use()`. */
  const captureHandler = <T>(register: 'add404Page' | 'addErrorHandler'): T => {
    let handler: unknown;
    const ctx = {
      express: {
        use(fn: unknown) {
          handler = fn;
        },
      },
    };
    HttpServer.prototype[register].call(ctx as unknown as HttpServer);
    assert.ok(handler, `${register} registered no handler`);
    return handler as T;
  };

  const run404 = (i18n?: TI18n) => {
    const { captured, res } = recordingResponse();
    captureHandler<(req: FrameworkRequest, res: Response) => void>(
      'add404Page',
    )({ appInfo: { i18n } } as unknown as FrameworkRequest, res);
    return captured;
  };

  const run500 = (i18n?: TI18n) => {
    const { captured, res } = recordingResponse();
    captureHandler<
      (
        err: Error,
        req: FrameworkRequest,
        res: Response,
        next: NextFunction,
      ) => void
    >('addErrorHandler')(
      new Error('boom'),
      { appInfo: { i18n } } as unknown as FrameworkRequest,
      res,
      () => {},
    );
    return captured;
  };

  it('404 keeps the English text when the app locales lack the key', async () => {
    const i18nService = await appInstance.getI18nService();
    const captured = run404(await i18nService.getI18nForLang('en'));

    assert.strictEqual(captured.status, 404);
    assert.deepStrictEqual(captured.payload, { message: '404' });
  });

  it('404 uses the app translation when the key resolves', () => {
    const captured = run404(stubI18n({ 'http.notFound': 'Не найдено' }));

    assert.strictEqual(captured.status, 404);
    assert.deepStrictEqual(captured.payload, { message: 'Не найдено' });
  });

  it('500 keeps the English text when the app locales lack the key', async () => {
    const i18nService = await appInstance.getI18nService();
    const captured = run500(await i18nService.getI18nForLang('en'));

    assert.strictEqual(captured.status, 500);
    assert.deepStrictEqual(captured.payload, { message: 'Something broke!' });
  });

  it('500 uses the app translation when the key resolves', () => {
    const captured = run500(
      stubI18n({ 'http.serverError': 'Что-то сломалось' }),
    );

    assert.strictEqual(captured.status, 500);
    assert.deepStrictEqual(captured.payload, { message: 'Что-то сломалось' });
  });

  it('both sinks fall back to English when the request carries no i18n', () => {
    assert.deepStrictEqual(run404().payload, { message: '404' });
    assert.deepStrictEqual(run500().payload, { message: 'Something broke!' });
  });
});

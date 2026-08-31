import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import type { Response } from 'express';
import { appInstance } from '../../../helpers/appInstance.ts';
import { stubI18n } from '../../../tests/mocks.ts';
import type { TI18n } from '../../i18n/I18n.ts';
import type { FrameworkRequest } from '../HttpServer.ts';
import Auth from './Auth.ts';
import type { GetUserByTokenAppInfo } from './GetUserByToken.ts';

type AuthRequest = FrameworkRequest & GetUserByTokenAppInfo;

describe('atuh middleware methods', () => {
  let middleware: Auth;

  before(() => {
    middleware = new Auth(appInstance);
  });

  it('have description fields', async () => {
    assert.notStrictEqual(Auth.description, undefined);
  });

  it('middleware pass when user presented', async () => {
    let isCalled = false;
    const nextFunction = () => {
      isCalled = true;
    };
    const req = {
      appInfo: {
        user: true,
      },
    };
    await middleware.middleware(
      req as unknown as AuthRequest,
      {} as unknown as Response,
      nextFunction,
    );

    assert.ok(isCalled);
  });

  it('middleware NOT pass when user NOT presented', async () => {
    let isCalled = false;
    let status = 0;
    let isSend = false;
    const nextFunction = () => {
      isCalled = true;
    };
    const req = {
      appInfo: {}, // no user
    };
    await middleware.middleware(
      req as unknown as AuthRequest,
      {
        status(statusCode: number) {
          status = statusCode;
          return this;
        },
        json() {
          isSend = true;
          return this;
        },
      } as unknown as Response,
      nextFunction,
    );

    assert.ok(!isCalled);
    assert.strictEqual(status, 401);
    assert.ok(isSend);
  });
});

/**
 * The 401 body is emitted through `translate()`: an app that ships
 * `middleware.auth.notLoggedIn` gets its own wording, an app that does not
 * keeps the exact English text. `error` is a machine code and never translated.
 */
describe('auth middleware message translation', () => {
  const runUnauthenticated = async (i18n?: TI18n) => {
    const middleware = new Auth(appInstance);
    let status = 0;
    let payload: Record<string, unknown> = {};
    await middleware.middleware(
      { appInfo: { i18n } } as unknown as AuthRequest,
      {
        status(statusCode: number) {
          status = statusCode;
          return this;
        },
        json(body: Record<string, unknown>) {
          payload = body;
          return this;
        },
      } as unknown as Response,
      () => {},
    );
    return { status, payload };
  };

  it('keeps the English text when the app locales lack the key', async () => {
    const i18nService = await appInstance.getI18nService();
    const { status, payload } = await runUnauthenticated(
      await i18nService.getI18nForLang('en'),
    );

    assert.strictEqual(status, 401);
    assert.deepStrictEqual(payload, {
      error: 'AUTH001',
      message: 'Please login to application',
    });
  });

  it('uses the app translation when the key resolves', async () => {
    const { status, payload } = await runUnauthenticated(
      stubI18n({ 'middleware.auth.notLoggedIn': 'Пожалуйста, войдите' }),
    );

    assert.strictEqual(status, 401);
    assert.deepStrictEqual(payload, {
      error: 'AUTH001',
      message: 'Пожалуйста, войдите',
    });
  });
});

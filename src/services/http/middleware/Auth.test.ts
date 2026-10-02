import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import type { Response } from 'express';
import { appInstance } from '../../../helpers/appInstance.ts';
import { stubI18n } from '../../../tests/mocks.ts';
import type { TI18n } from '../../i18n/I18n.ts';
import type { FrameworkRequest } from '../HttpServer.ts';
import { UnauthorizedError } from '../httpErrors.ts';
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
    const req = {
      appInfo: {}, // no user
    };
    await assert.rejects(
      middleware.middleware(
        req as unknown as AuthRequest,
        {} as Response,
        () => {
          isCalled = true;
        },
      ),
      UnauthorizedError,
    );

    assert.ok(!isCalled);
  });
});

/**
 * The 401 is a thrown `UnauthorizedError`, answered through the error-handler
 * registry: an app that ships `middleware.auth.notLoggedIn` gets its own
 * wording, an app that does not keeps the exact English text. `error` is a
 * machine code and never translated.
 */
describe('auth middleware message translation', () => {
  const runUnauthenticated = async (i18n?: TI18n) => {
    const req = { appInfo: { i18n } } as unknown as AuthRequest;
    const thrown = await new Auth(appInstance)
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

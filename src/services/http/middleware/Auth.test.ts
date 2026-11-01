import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { appInstance } from '../../../helpers/appInstance.ts';
import { createTestContext } from '../../../tests/createTestContext.ts';
import { stubI18n } from '../../../tests/mocks.ts';
import type { TI18n } from '../../i18n/I18n.ts';
import type { FrameworkRequest } from '../HttpServer.ts';
import { UnauthorizedError } from '../httpErrors.ts';
import { HttpResponse } from '../responses.ts';
import Auth from './Auth.ts';

/** Run the middleware; `next` records that the request went on. */
const run = (appInfo: Record<string, unknown>) => {
  const ctx = createTestContext({ appInfo });
  let passed = false;
  const result = new Auth(appInstance).middleware(ctx, async () => {
    passed = true;
    return HttpResponse.empty(204);
  });
  return { ctx, result, passed: () => passed };
};

describe('atuh middleware methods', () => {
  let middleware: Auth;

  before(() => {
    middleware = new Auth(appInstance);
  });

  it('have description fields', async () => {
    assert.notStrictEqual(Auth.description, undefined);
    assert.ok(middleware);
  });

  it('middleware pass when user presented', async () => {
    const { result, passed } = run({ user: { id: 'u1' } });
    assert.strictEqual((await result).status, 204);
    assert.ok(passed());
  });

  it('middleware NOT pass when user NOT presented', async () => {
    const { result, passed } = run({});
    await assert.rejects(result, UnauthorizedError);
    assert.ok(!passed());
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
    const { ctx, result } = run({ i18n });
    const thrown = await result.then(
      () => null,
      (err: unknown) => err,
    );
    // Answered the way the HTTP layer answers a middleware error.
    const answer = await appInstance.httpServer?.resolveError(
      thrown,
      ctx as unknown as FrameworkRequest,
    );
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

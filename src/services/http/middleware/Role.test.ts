import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { appInstance } from '../../../helpers/appInstance.ts';
import { createTestContext } from '../../../tests/createTestContext.ts';
import { stubI18n } from '../../../tests/mocks.ts';
import type { TI18n } from '../../i18n/I18n.ts';
import type { FrameworkRequest } from '../HttpServer.ts';
import { ForbiddenError, UnauthorizedError } from '../httpErrors.ts';
import { HttpResponse } from '../responses.ts';
import Role from './Role.ts';

/** Run Role with `params`; `next` records that the request went on. */
const run = (params: Record<string, unknown> | undefined, appInfo: object) => {
  const ctx = createTestContext({
    appInfo: appInfo as Record<string, unknown>,
  });
  let passed = false;
  const result = new Role(appInstance, params).middleware(ctx, async () => {
    passed = true;
    return HttpResponse.empty(204);
  });
  return { ctx, result, passed: () => passed };
};

describe('role middleware methods', () => {
  it('have description fields', async () => {
    assert.notStrictEqual(Role.description, undefined);
  });

  it('middleware pass when user presented with a right role', async () => {
    const { result, passed } = run(
      { roles: ['admin', 'role1'] },
      { user: { roles: ['role1', 'role2'] } },
    );
    assert.strictEqual((await result).status, 204);
    assert.ok(passed());
  });

  it('middleware NOT pass when user NOT presented', async () => {
    const { result, passed } = run(undefined, {});
    await assert.rejects(result, UnauthorizedError);
    assert.ok(!passed());
  });

  it('middleware NOT pass when user  have a wrong role', async () => {
    const { result, passed } = run(
      { roles: ['admin'] },
      { user: { roles: ['role1', 'role2'] } },
    );
    await assert.rejects(result, ForbiddenError);
    assert.ok(!passed());
  });
});

/**
 * Both rejections are thrown errors answered through the error-handler
 * registry: an app that ships
 * `middleware.role.*` gets its own wording, an app that does not keeps the
 * exact English text.
 */
describe('role middleware message translation', () => {
  const runRejected = async ({
    i18n,
    user,
  }: {
    i18n?: TI18n;
    user?: { roles: string[] };
  }) => {
    const { ctx, result } = run({ roles: ['admin'] }, { i18n, user });
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

  it('401 keeps the English text when the app locales lack the key', async () => {
    const i18nService = await appInstance.getI18nService();
    const { status, payload } = await runRejected({
      i18n: await i18nService.getI18nForLang('en'),
    });

    assert.strictEqual(status, 401);
    assert.deepStrictEqual(payload, {
      error: 'AUTH001',
      message: 'User should be provided',
    });
  });

  it('401 uses the app translation when the key resolves', async () => {
    const { status, payload } = await runRejected({
      i18n: stubI18n({
        'middleware.role.userRequired': 'Требуется пользователь',
      }),
    });

    assert.strictEqual(status, 401);
    assert.deepStrictEqual(payload, {
      error: 'AUTH001',
      message: 'Требуется пользователь',
    });
  });

  it('403 keeps the English text when the app locales lack the key', async () => {
    const i18nService = await appInstance.getI18nService();
    const { status, payload } = await runRejected({
      i18n: await i18nService.getI18nForLang('en'),
      user: { roles: ['user'] },
    });

    assert.strictEqual(status, 403);
    assert.deepStrictEqual(payload, {
      error: 'NO_ACCESS',
      message: 'You do not have access',
    });
  });

  it('403 uses the app translation when the key resolves', async () => {
    const { status, payload } = await runRejected({
      i18n: stubI18n({ 'middleware.role.noAccess': 'Нет доступа' }),
      user: { roles: ['user'] },
    });

    assert.strictEqual(status, 403);
    assert.deepStrictEqual(payload, {
      error: 'NO_ACCESS',
      message: 'Нет доступа',
    });
  });
});

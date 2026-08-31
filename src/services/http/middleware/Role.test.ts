import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Response } from 'express';
import { appInstance } from '../../../helpers/appInstance.ts';
import type { TUser } from '../../../models/User.ts';
import { stubI18n } from '../../../tests/mocks.ts';
import type { TI18n } from '../../i18n/I18n.ts';
import type { FrameworkRequest } from '../HttpServer.ts';
import type { GetUserByTokenAppInfo } from './GetUserByToken.ts';
import Role from './Role.ts';

describe('role middleware methods', () => {
  it('have description fields', async () => {
    // const middleware = new Role(appInstance);

    assert.notStrictEqual(Role.description, undefined);
  });

  it('middleware pass when user presented with a right role', async () => {
    let isCalled = false;
    const nextFunction = () => {
      isCalled = true;
    };
    const req = {
      appInfo: {
        user: {
          roles: ['role1', 'role2'],
        },
      },
    };
    const middleware = new Role(appInstance, {
      roles: ['admin', 'role1'],
    });

    await middleware.middleware(
      req as FrameworkRequest &
        GetUserByTokenAppInfo & { user: InstanceType<TUser> },
      {} as Response,
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
    const middleware = new Role(appInstance);
    await middleware.middleware(
      req as FrameworkRequest &
        GetUserByTokenAppInfo & { user: InstanceType<TUser> },
      {
        status(statusCode) {
          status = statusCode;
          return this;
        },
        json() {
          isSend = true;
        },
      } as Response,
      nextFunction,
    );

    assert.ok(!isCalled);
    assert.strictEqual(status, 401);
    assert.ok(isSend);
  });

  it('middleware NOT pass when user  have a wrong role', async () => {
    let isCalled = false;
    let status = 0;
    let isSend = false;
    const nextFunction = () => {
      isCalled = true;
    };
    const req = {
      appInfo: {
        user: { roles: ['role1', 'role2'] },
      },
    };
    const middleware = new Role(appInstance, { roles: ['admin'] });
    await middleware.middleware(
      req as FrameworkRequest &
        GetUserByTokenAppInfo & { user: InstanceType<TUser> },
      {
        status(statusCode) {
          status = statusCode;
          return this;
        },
        json() {
          isSend = true;
        },
      } as Response,
      nextFunction,
    );

    assert.ok(!isCalled);
    assert.strictEqual(status, 403);
    assert.ok(isSend);
  });
});

/**
 * Both rejection bodies go through `translate()`: an app that ships
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
    const middleware = new Role(appInstance, { roles: ['admin'] });
    let status = 0;
    let payload: Record<string, unknown> = {};
    await middleware.middleware(
      { appInfo: { i18n, user } } as unknown as FrameworkRequest &
        GetUserByTokenAppInfo & { user: InstanceType<TUser> },
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

  it('401 keeps the English text when the app locales lack the key', async () => {
    const i18nService = await appInstance.getI18nService();
    const { status, payload } = await runRejected({
      i18n: await i18nService.getI18nForLang('en'),
    });

    assert.strictEqual(status, 401);
    assert.deepStrictEqual(payload, { message: 'User should be provided' });
  });

  it('401 uses the app translation when the key resolves', async () => {
    const { status, payload } = await runRejected({
      i18n: stubI18n({
        'middleware.role.userRequired': 'Требуется пользователь',
      }),
    });

    assert.strictEqual(status, 401);
    assert.deepStrictEqual(payload, { message: 'Требуется пользователь' });
  });

  it('403 keeps the English text when the app locales lack the key', async () => {
    const i18nService = await appInstance.getI18nService();
    const { status, payload } = await runRejected({
      i18n: await i18nService.getI18nForLang('en'),
      user: { roles: ['user'] },
    });

    assert.strictEqual(status, 403);
    assert.deepStrictEqual(payload, { message: 'You do not have access' });
  });

  it('403 uses the app translation when the key resolves', async () => {
    const { status, payload } = await runRejected({
      i18n: stubI18n({ 'middleware.role.noAccess': 'Нет доступа' }),
      user: { roles: ['user'] },
    });

    assert.strictEqual(status, 403);
    assert.deepStrictEqual(payload, { message: 'Нет доступа' });
  });
});

import assert from 'node:assert/strict';
import { before, describe, it, mock } from 'node:test';
import type { NextFunction, Response } from 'express';
import { appInstance } from '../../helpers/appInstance.ts';
import {
  assertCalledTimes,
  assertRejectsLike,
} from '../../tests/assertions.ts';
import type { FrameworkRequest } from '../http/HttpServer.ts';
import I18nMiddleware from '../http/middleware/I18n.ts';
import type { I18n } from './I18n.ts';

/**
 * `i18next` and `i18next-fs-backend` are OPTIONAL peer dependencies. A consumer
 * that never installs them still runs on the default config (`enabled: true`):
 * the missing packages are reported ONCE and every framework message falls back
 * to its in-code English default instead of failing the request.
 */
const notInstalled = () =>
  Object.assign(new Error("Cannot find package 'i18next'"), {
    code: 'ERR_MODULE_NOT_FOUND',
  });

mock.module('i18next', {
  exports: {
    get default() {
      throw notInstalled();
    },
  },
});

mock.module('i18next-fs-backend', {
  exports: {
    get default() {
      throw notInstalled();
    },
  },
});

describe('i18n service without the optional i18next packages', () => {
  let service: I18n;

  before(async () => {
    service = await appInstance.getI18nService();
  });

  it('fails fast with an actionable error when an instance is required', async () => {
    // Names both packages and the config flag — the only two ways out.
    await assertRejectsLike(service.getI18nBaseInstance(), /i18next/);
    await assertRejectsLike(
      service.getI18nBaseInstance(),
      /i18next-fs-backend/,
    );
    await assertRejectsLike(service.getI18nBaseInstance(), /enabled: false/);
  });

  it('serves the in-code English defaults, reporting the miss once', async () => {
    const logWarn = mock.method(service.logger, 'warn', () => service.logger);
    try {
      const en = await service.getI18nForLang('en');
      const ru = await service.getI18nForLang('ru');

      assert.strictEqual(
        en.t('middleware.auth.notLoggedIn', {
          defaultValue: 'Please login to application',
        }),
        'Please login to application',
      );
      // No default supplied → the key, exactly like i18next itself.
      assert.strictEqual(ru.t('auth.errorUPValid'), 'auth.errorUPValid');
      // One report for the whole process, not one per request.
      assertCalledTimes(logWarn, 1);
    } finally {
      logWarn.mock.restore();
    }
  });

  it('lets the i18n middleware run with a language hint', async () => {
    const middleware = new I18nMiddleware(appInstance);
    const req = {
      appInfo: {},
      get: (header: string) => (header === 'X-Lang' ? 'ru' : undefined),
      query: {},
    } as unknown as FrameworkRequest;
    let nexted = false;

    await middleware.middleware(
      req,
      {} as Response,
      (() => {
        nexted = true;
      }) as NextFunction,
    );

    assert.ok(nexted);
    assert.ok(req.appInfo.i18n);
    assert.strictEqual(
      req.appInfo.i18n.t('middleware.role.noAccess', {
        defaultValue: 'You do not have access',
      }),
      'You do not have access',
    );
  });
});

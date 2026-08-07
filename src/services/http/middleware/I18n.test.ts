import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { appInstance } from '../../../helpers/appInstance.ts';
import I18n from './I18n.ts';

describe('i18n middleware methods', () => {
  let middleware: I18n;

  before(() => {
    middleware = new I18n(appInstance);
  });

  it('have description fields', async () => {
    assert.notStrictEqual(middleware.constructor.description, undefined);
  });

  it('detectors should works correctly', async () => {
    const request: {
      get: () => string;
      query?: {
        [key: string]: string;
      };
      appInfo: {
        user?: {
          locale?: string;
        };
      };
    } = {
      get: () => 'en',
      query: {
        [middleware.lookupQuerystring]: 'es',
      },
      appInfo: {},
    };
    let lang = await middleware.detectLang(request);

    assert.strictEqual(lang, 'en');

    request.appInfo = {
      user: {
        locale: 'be',
      },
    };
    lang = await middleware.detectLang(request);

    assert.strictEqual(lang, 'en');

    request.get = () => null as unknown as string;
    lang = await middleware.detectLang(request);

    assert.strictEqual(lang, 'es');

    request.query = undefined;
    lang = await middleware.detectLang(request);

    assert.strictEqual(lang, 'be');

    request.query = {
      [middleware.lookupQuerystring]: 'en-GB',
    };
    lang = await middleware.detectLang(request);

    assert.strictEqual(lang, 'en');

    lang = await middleware.detectLang(request, false);

    assert.strictEqual(lang, 'en-GB');
  });

  it('middleware that works', async () => {
    let isCalled = false;
    const nextFunction = () => {
      isCalled = true;
    };
    const req: {
      get: () => string;
      appInfo: {
        i18n?: {
          language: string;
          t: (value: string) => string;
        };
      };
      i18n?: {
        t: (value: string) => string;
      };
    } = {
      get: () => 'en',
      appInfo: {},
    };
    await middleware.middleware(req, {}, nextFunction);

    assert.ok(isCalled);
    assert.notStrictEqual(req.appInfo.i18n, undefined);
    assert.strictEqual(req.appInfo.i18n?.language, 'en');
    assert.strictEqual(req.appInfo.i18n?.t('aaaaa'), 'aaaaa');
    assert.strictEqual(req.i18n?.t('aaaaa'), 'aaaaa'); // proxy test

    const req2: {
      get: () => string;
      appInfo: {
        i18n?: {
          language: string;
        };
      };
    } = {
      get: () => 'fakeLang',
      appInfo: {},
    };

    await middleware.middleware(req2, {}, nextFunction);

    assert.strictEqual(req2.appInfo.i18n?.language, 'en');
  });

  it('middleware disabled', async () => {
    appInstance.updateConfig('i18n', { enabled: false });
    middleware = new I18n(appInstance);

    let isCalled = false;
    const nextFunction = () => {
      isCalled = true;
    };
    const req: {
      get: () => string;
      appInfo: {
        i18n?: {
          language: string;
          t: (value: string) => string;
        };
      };
      i18n?: {
        language: string;
        t: (value: string) => string;
      };
    } = {
      get: () => 'en',
      appInfo: {},
    };
    await middleware.middleware(req, {}, nextFunction);

    assert.ok(isCalled);
    assert.notStrictEqual(req.appInfo.i18n, undefined);
    assert.strictEqual(req.appInfo.i18n?.t('aaaaa'), 'aaaaa');
    assert.strictEqual(req.i18n?.t('aaaaa'), 'aaaaa'); // proxy test

    appInstance.updateConfig('i18n', { enabled: true });
  });
});

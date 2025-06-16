import { beforeAll, describe, it, expect } from 'vitest';
import I18n from './I18n.ts';
import { appInstance } from '../../../helpers/appInstance.ts';

describe('i18n middleware methods', () => {
  let middleware;

  beforeAll(() => {
    middleware = new I18n(appInstance);
  });

  it('have description fields', async () => {
    expect.assertions(1);
    expect(middleware.constructor.description).toBeDefined();
  });

  it('detectors should works correctly', async () => {
    expect.assertions(6);

    const request = {
      get: () => 'en',
      query: {
        [middleware.lookupQuerystring]: 'es',
      },
    };
    let lang = await middleware.detectLang(request);

    expect(lang).toBe('en');

    request.appInfo = {
      user: {
        locale: 'be',
      },
    };
    lang = await middleware.detectLang(request);

    expect(lang).toBe('en');

    request.get = () => null;
    lang = await middleware.detectLang(request);

    expect(lang).toBe('es');

    delete request.query;
    lang = await middleware.detectLang(request);

    expect(lang).toBe('be');

    request.query = {
      [middleware.lookupQuerystring]: 'en-GB',
    };
    lang = await middleware.detectLang(request);

    expect(lang).toBe('en');

    lang = await middleware.detectLang(request, false);

    expect(lang).toBe('en-GB');
  });

  it('middleware that works', async () => {
    expect.assertions(6);

    let isCalled = false;
    const nextFunction = () => {
      isCalled = true;
    };
    const req = {
      get: () => 'en',
      appInfo: {},
    };
    await middleware.middleware(req, {}, nextFunction);

    expect(isCalled).toBeTruthy();
    expect(req.appInfo.i18n).toBeDefined();
    expect(req.appInfo.i18n.language).toBe('en');
    expect(req.appInfo.i18n.t('aaaaa')).toBe('aaaaa');
    expect(req.i18n.t('aaaaa')).toBe('aaaaa'); // proxy test

    const req2 = {
      get: () => 'fakeLang',
      appInfo: {},
    };

    await middleware.middleware(req2, {}, nextFunction);

    expect(req2.appInfo.i18n.language).toBe('en');
  });

  it('middleware disabled', async () => {
    expect.assertions(4);

    appInstance.updateConfig('i18n', { enabled: false });
    middleware = new I18n(appInstance);

    let isCalled = false;
    const nextFunction = () => {
      isCalled = true;
    };
    const req = {
      get: () => 'en',
      appInfo: {},
    };
    await middleware.middleware(req, {}, nextFunction);

    expect(isCalled).toBeTruthy();
    expect(req.appInfo.i18n).toBeDefined();
    expect(req.appInfo.i18n.t('aaaaa')).toBe('aaaaa');
    expect(req.i18n.t('aaaaa')).toBe('aaaaa'); // proxy test

    appInstance.updateConfig('i18n', { enabled: true });
  });
});

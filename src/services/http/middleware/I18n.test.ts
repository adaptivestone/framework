import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import type { Response } from 'express';
import { appInstance } from '../../../helpers/appInstance.ts';
import { getTestServerURL } from '../../../tests/testHelpers.ts';
import type { FrameworkRequest } from '../HttpServer.ts';
import I18n from './I18n.ts';

// Minimal request/response stubs: the middleware touches only `get`, `query`
// and `appInfo`, so the widening cast lives here instead of at every call site.
const asRequest = (stub: object) => stub as unknown as FrameworkRequest;
const asResponse = (stub: object) => stub as unknown as Response;

describe('i18n middleware methods', () => {
  let middleware: I18n;

  before(() => {
    middleware = new I18n(appInstance);
  });

  it('have description fields', async () => {
    assert.notStrictEqual(
      (middleware.constructor as typeof I18n).description,
      undefined,
    );
  });

  it('detectors should works correctly', async () => {
    const request: {
      get: () => string;
      query?: {
        [key: string]: string | string[];
      };
      appInfo: {
        user?: {
          locale?: string;
        };
      };
    } = {
      get: () => 'en',
      query: {
        [middleware.lookupQuerystring]: 'ru',
      },
      appInfo: {},
    };
    let lang = await middleware.detectLang(asRequest(request));

    assert.strictEqual(lang, 'en');

    request.appInfo = {
      user: {
        locale: 'ru',
      },
    };
    lang = await middleware.detectLang(asRequest(request));

    assert.strictEqual(lang, 'en');

    request.get = () => null as unknown as string;
    lang = await middleware.detectLang(asRequest(request));

    assert.strictEqual(lang, 'ru');

    request.query = undefined;
    lang = await middleware.detectLang(asRequest(request));

    assert.strictEqual(lang, 'ru');

    // An unsupported value falls through to the next detector.
    request.get = () => 'de';
    request.query = { [middleware.lookupQuerystring]: 'es' };
    lang = await middleware.detectLang(asRequest(request));

    assert.strictEqual(lang, 'ru');

    request.appInfo = {};
    lang = await middleware.detectLang(asRequest(request));

    assert.strictEqual(lang, '');

    // A repeated query parameter is an array: ignored, never thrown on.
    request.query = { [middleware.lookupQuerystring]: ['a', '_'] };
    lang = await middleware.detectLang(asRequest(request));

    assert.strictEqual(lang, '');

    request.query = {
      [middleware.lookupQuerystring]: 'en-GB',
    };
    lang = await middleware.detectLang(asRequest(request));

    assert.strictEqual(lang, 'en');

    lang = await middleware.detectLang(asRequest(request), false);

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
    await middleware.middleware(asRequest(req), asResponse({}), nextFunction);

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

    await middleware.middleware(asRequest(req2), asResponse({}), nextFunction);

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
    await middleware.middleware(asRequest(req), asResponse({}), nextFunction);

    assert.ok(isCalled);
    assert.notStrictEqual(req.appInfo.i18n, undefined);
    assert.strictEqual(req.appInfo.i18n?.t('aaaaa'), 'aaaaa');
    assert.strictEqual(req.i18n?.t('aaaaa'), 'aaaaa'); // proxy test

    appInstance.updateConfig('i18n', { enabled: true });
  });
});

describe('i18n middleware over HTTP', () => {
  it('a repeated language query parameter does not fail the request', async () => {
    const response = await fetch(getTestServerURL('/?lng=a&lng=_'));

    assert.strictEqual(response.status, 200);
  });

  it('an unsupported X-Lang header does not hide a supported query language', async () => {
    const response = await fetch(getTestServerURL('/auth/login?lng=ru'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Lang': 'de' },
      body: '{}',
    });
    const body = await response.json();

    assert.strictEqual(response.status, 400);
    assert.deepStrictEqual(body.errors.email, ['Нужно указать Email']);
  });
});

import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { appInstance } from '../../../helpers/appInstance.ts';
import { createTestContext } from '../../../tests/createTestContext.ts';
import { getTestServerURL } from '../../../tests/testHelpers.ts';
import { HttpResponse } from '../responses.ts';
import type { UserContext } from './GetUserByToken.ts';
import I18n from './I18n.ts';

/** A context with the detector inputs: `X-Lang`, the language query, the user's locale. */
const ctxFor = (
  xLang: string | undefined,
  query: Record<string, unknown> = {},
  user?: { locale?: string },
) =>
  createTestContext<UserContext['appInfo']>({
    headers: xLang === undefined ? {} : { 'x-lang': xLang },
    query,
    appInfo: user ? { user: user as never } : {},
  });

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
    const q = (value: unknown) => ({ [middleware.lookupQuerystring]: value });
    const detect = (ctx: UserContext, isUseShortCode?: boolean) =>
      middleware.detectLang(ctx, isUseShortCode);

    assert.strictEqual(await detect(ctxFor('en', q('ru'))), 'en');
    assert.strictEqual(
      await detect(ctxFor('en', q('ru'), { locale: 'ru' })),
      'en',
    );
    assert.strictEqual(
      await detect(ctxFor(undefined, q('ru'), { locale: 'ru' })),
      'ru',
    );
    assert.strictEqual(
      await detect(ctxFor(undefined, {}, { locale: 'ru' })),
      'ru',
    );
    // An unsupported value falls through to the next detector.
    assert.strictEqual(
      await detect(ctxFor('de', q('es'), { locale: 'ru' })),
      'ru',
    );
    assert.strictEqual(await detect(ctxFor('de', q('es'))), '');
    // A repeated query parameter is an array: ignored, never thrown on.
    assert.strictEqual(await detect(ctxFor('de', q(['a', '_']))), '');
    assert.strictEqual(await detect(ctxFor('de', q('en-GB'))), 'en');
    assert.strictEqual(await detect(ctxFor('de', q('en-GB')), false), 'en-GB');
  });

  it('middleware that works', async () => {
    let isCalled = false;
    const next = async () => {
      isCalled = true;
      return HttpResponse.empty(204);
    };
    const ctx = ctxFor('en');
    await middleware.middleware(ctx, next);

    assert.ok(isCalled);
    assert.notStrictEqual(ctx.appInfo.i18n, undefined);
    assert.strictEqual(ctx.appInfo.i18n?.language, 'en');
    assert.strictEqual(ctx.appInfo.i18n?.t('aaaaa'), 'aaaaa');

    const unsupported = ctxFor('fakeLang');
    await middleware.middleware(unsupported, next);

    assert.strictEqual(unsupported.appInfo.i18n?.language, 'en');
  });

  it('middleware disabled', async () => {
    appInstance.updateConfig('i18n', { enabled: false });
    try {
      const disabled = new I18n(appInstance);
      let isCalled = false;
      const ctx = ctxFor('en');
      await disabled.middleware(ctx, async () => {
        isCalled = true;
        return HttpResponse.empty(204);
      });

      assert.ok(isCalled);
      assert.notStrictEqual(ctx.appInfo.i18n, undefined);
      assert.strictEqual(ctx.appInfo.i18n?.t('aaaaa'), 'aaaaa');
    } finally {
      appInstance.updateConfig('i18n', { enabled: true });
    }
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

  it('keeps the deprecated req.i18n alias for 5.x code on Express', async () => {
    const { default: express } = await import('express');
    const { createServer } = await import('node:http');
    const { expressMiddleware } = await import('../routing/expressPipeline.ts');
    const { ExpressResponseWriter } = await import(
      '../ExpressResponseWriter.ts'
    );
    const app = express();
    app.use(
      expressMiddleware(
        appInstance,
        new ExpressResponseWriter(),
        new I18n(appInstance),
      ),
    );
    app.use((req, res) => {
      const alias = (req as unknown as { i18n?: { language?: string } }).i18n;
      res.json({ language: alias?.language });
    });
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as { port: number };
    try {
      const response = await fetch(`http://localhost:${port}/`, {
        headers: { 'X-Lang': 'ru' },
      });
      assert.deepStrictEqual(await response.json(), { language: 'ru' });
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

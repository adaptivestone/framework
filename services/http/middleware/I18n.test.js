const I18n = require('./I18n');

describe('i18n middleware methods', () => {
  let middleware;
  beforeAll(() => {
    middleware = new I18n(global.server.app);
  });
  it('have description fields', async () => {
    expect.assertions(1);
    expect(middleware.constructor.description).toBeDefined();
  });

  it('detectors should works correctly', async () => {
    expect.assertions(4);
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
  });

  it('middleware that works', async () => {
    expect.assertions(4);
    const nextFunction = jest.fn(() => {});
    const req = {
      get: () => 'en',
      appInfo: {},
    };
    await middleware.middleware(req, {}, nextFunction);
    expect(nextFunction).toHaveBeenCalledWith();
    expect(req.appInfo.i18n).toBeDefined();
    expect(req.appInfo.i18n.t('aaaaa')).toBe('aaaaa');
    expect(req.i18n.t('aaaaa')).toBe('aaaaa'); // proxy test
  });

  it('middleware disabled', async () => {
    expect.assertions(4);
    global.server.app.updateConfig('i18n', { enabled: false });
    middleware = new I18n(global.server.app);

    const nextFunction = jest.fn(() => {});
    const req = {
      get: () => 'en',
      appInfo: {},
    };
    await middleware.middleware(req, {}, nextFunction);
    expect(nextFunction).toHaveBeenCalledWith();
    expect(req.appInfo.i18n).toBeDefined();
    expect(req.appInfo.i18n.t('aaaaa')).toBe('aaaaa');
    expect(req.i18n.t('aaaaa')).toBe('aaaaa'); // proxy test
    global.server.app.updateConfig('i18n', { enabled: true });
  });
});

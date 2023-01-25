const PrepareAppInfo = require('./PrepareAppInfo');

describe('prepareAppInfo methods', () => {
  it('have description fields', async () => {
    expect.assertions(1);
    const middleware = new PrepareAppInfo(global.server.app);
    expect(middleware.constructor.description).toBeDefined();
  });

  it('middleware that works', async () => {
    expect.assertions(3);
    const middleware = new PrepareAppInfo(global.server.app);
    const nextFunction = jest.fn(() => {});
    const req = {};
    await middleware.middleware(req, {}, nextFunction);
    expect(nextFunction).toHaveBeenCalledWith();
    expect(req.appInfo).toBeDefined();
    req.appInfo.test = 5;
    await middleware.middleware(req, {}, nextFunction);
    expect(req.appInfo.test).toBe(5);
  });
});

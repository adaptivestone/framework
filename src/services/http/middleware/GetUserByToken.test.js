import { describe, it, expect } from 'vitest';
import GetUserByToken from './GetUserByToken.js';

describe('getUserByToken middleware methods', () => {
  it('have description fields', async () => {
    expect.assertions(1);

    // const middleware = new GetUserByToken(global.server.app);

    expect(GetUserByToken.description).toBeDefined();
  });

  it('have description usedAuthParameters', async () => {
    expect.assertions(2);

    const middleware = new GetUserByToken(global.server.app);
    const params = middleware.usedAuthParameters;

    expect(params).toHaveLength(1);
    expect(params[0].name).toBe('Authorization');
  });

  it('should not called twice', async () => {
    expect.assertions(1);

    const middleware = new GetUserByToken(global.server.app);
    let isCalled = false;
    const nextFunction = () => {
      isCalled = true;
    };
    const req = {
      appInfo: {
        user: {},
      },
    };
    await middleware.middleware(req, {}, nextFunction);

    expect(isCalled).toBeTruthy();
  });

  it('should not getuser without token', async () => {
    expect.assertions(1);

    const middleware = new GetUserByToken(global.server.app);
    let isCalled = false;
    const nextFunction = () => {
      isCalled = true;
    };
    const req = {
      appInfo: {},
      body: {},
      get: () => {},
    };

    await middleware.middleware(req, {}, nextFunction);

    expect(isCalled).toBeTruthy();
  });

  it('should not getuser with a wrong token', async () => {
    expect.assertions(2);

    const middleware = new GetUserByToken(global.server.app);
    let isCalled = false;
    const nextFunction = () => {
      isCalled = true;
    };
    const req = {
      appInfo: {},
      body: {
        token: 'fake',
      },
      get: () => {},
    };
    await middleware.middleware(req, {}, nextFunction);

    expect(isCalled).toBeTruthy();
    expect(req.appInfo.user).toBeUndefined();
  });

  it('should not getuser with a good token in body', async () => {
    expect.assertions(2);

    const middleware = new GetUserByToken(global.server.app);
    let isCalled = false;
    const nextFunction = () => {
      isCalled = true;
    };
    const req = {
      appInfo: {},
      body: {
        token: global.authToken.token,
      },
      get: () => {},
    };

    await middleware.middleware(req, {}, nextFunction);

    expect(isCalled).toBeTruthy();
    expect(req.appInfo.user).toBeDefined();
  });

  it('should not getuser with a good token in header', async () => {
    expect.assertions(2);

    const middleware = new GetUserByToken(global.server.app);
    let isCalled = false;
    const nextFunction = () => {
      isCalled = true;
    };
    const req = {
      appInfo: {},
      body: {},
      get: () => global.authToken.token,
    };

    await middleware.middleware(req, {}, nextFunction);

    expect(isCalled).toBeTruthy();
    expect(req.appInfo.user).toBeDefined();
  });
});

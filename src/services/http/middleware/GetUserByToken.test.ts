import type { Response } from 'express';
import { describe, expect, it } from 'vitest';
import { appInstance } from '../../../helpers/appInstance.ts';
import { defaultAuthToken } from '../../../tests/testHelpers.ts';
import type { FrameworkRequest } from '../HttpServer.ts';
import GetUserByToken from './GetUserByToken.ts';

describe('getUserByToken middleware methods', () => {
  it('have description fields', async () => {
    expect.assertions(1);

    // const middleware = new GetUserByToken(appInstance);

    expect(GetUserByToken.description).toBeDefined();
  });

  it('have description usedAuthParameters', async () => {
    expect.assertions(2);

    const middleware = new GetUserByToken(appInstance);
    const params = middleware.usedAuthParameters;

    expect(params).toHaveLength(2);
    expect(params[0].name).toBe('Authorization');
  });

  it('should not called twice', async () => {
    expect.assertions(1);

    const middleware = new GetUserByToken(appInstance);
    let isCalled = false;
    const nextFunction = () => {
      isCalled = true;
    };
    const req = {
      appInfo: {
        user: {},
      },
    };
    await middleware.middleware(
      req as unknown as FrameworkRequest,
      {} as Response,
      nextFunction,
    );

    expect(isCalled).toBeTruthy();
  });

  it('should not getuser without token', async () => {
    expect.assertions(1);

    const middleware = new GetUserByToken(appInstance);
    let isCalled = false;
    const nextFunction = () => {
      isCalled = true;
    };
    const req = {
      appInfo: {},
      body: {},
      get: () => {},
    };

    await middleware.middleware(
      req as unknown as FrameworkRequest,
      {} as Response,
      nextFunction,
    );

    expect(isCalled).toBeTruthy();
  });

  it('should not getuser with a wrong token', async () => {
    expect.assertions(2);

    const middleware = new GetUserByToken(appInstance);
    let isCalled = false;
    const nextFunction = () => {
      isCalled = true;
    };
    const req = {
      appInfo: {
        user: undefined,
      },
      body: {
        token: 'fake',
      },
      get: () => {},
    };
    await middleware.middleware(
      req as unknown as FrameworkRequest,
      {} as Response,
      nextFunction,
    );

    expect(isCalled).toBeTruthy();
    expect(req.appInfo.user).toBeUndefined();
  });

  it('should not getuser with a good token in body', async () => {
    expect.assertions(2);

    const middleware = new GetUserByToken(appInstance);
    let isCalled = false;
    const nextFunction = () => {
      isCalled = true;
    };
    const req = {
      appInfo: {
        user: undefined,
      },
      body: {
        token: defaultAuthToken,
      },
      get: () => {},
    };

    await middleware.middleware(
      req as unknown as FrameworkRequest,
      {} as Response,
      nextFunction,
    );

    expect(isCalled).toBeTruthy();
    expect(req.appInfo.user).toBeDefined();
  });

  it('should not getuser with a good token in header', async () => {
    expect.assertions(2);

    const middleware = new GetUserByToken(appInstance);
    let isCalled = false;
    const nextFunction = () => {
      isCalled = true;
    };
    const req = {
      appInfo: {
        user: undefined,
      },
      body: {},
      get: () => defaultAuthToken,
    };

    await middleware.middleware(
      req as unknown as FrameworkRequest,
      {} as Response,
      nextFunction,
    );

    expect(isCalled).toBeTruthy();
    expect(req.appInfo.user).toBeDefined();
  });

  it('should getuser with a Bearer token in header', async () => {
    expect.assertions(2);

    const middleware = new GetUserByToken(appInstance);
    let isCalled = false;
    const nextFunction = () => {
      isCalled = true;
    };
    const req = {
      appInfo: {
        user: undefined,
      },
      body: {},
      get: (name: string) =>
        name === 'Authorization' ? `Bearer ${defaultAuthToken}` : undefined,
    };

    await middleware.middleware(
      req as unknown as FrameworkRequest,
      {} as Response,
      nextFunction,
    );

    expect(isCalled).toBeTruthy();
    expect(req.appInfo.user).toBeDefined();
  });
});

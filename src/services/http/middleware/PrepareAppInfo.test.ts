import type { Response } from 'express';
import { describe, expect, it } from 'vitest';
import { appInstance } from '../../../helpers/appInstance.ts';
import type { FrameworkRequest } from '../HttpServer.ts';
import PrepareAppInfo from './PrepareAppInfo.ts';

describe('prepareAppInfo methods', () => {
  it('have description fields', async () => {
    expect.assertions(1);

    // const middleware = new PrepareAppInfo(appInstance);

    expect(PrepareAppInfo.description).toBeDefined();
  });

  it('middleware that works', async () => {
    expect.assertions(3);

    const middleware = new PrepareAppInfo(appInstance);
    let isCalled = false;
    const nextFunction = () => {
      isCalled = true;
    };
    const req: {
      appInfo?: {
        test: number;
      };
    } = {};
    await middleware.middleware(
      req as unknown as FrameworkRequest,
      {} as Response,
      nextFunction,
    );

    expect(isCalled).toBeTruthy();
    expect(req.appInfo).toBeDefined();

    if (req.appInfo) {
      req.appInfo.test = 5;
    }

    await middleware.middleware(
      req as unknown as FrameworkRequest,
      {} as Response,
      nextFunction,
    );

    expect(req.appInfo?.test).toBe(5);
  });

  it('initializes request and query to {} so schema-less routes can read them', async () => {
    expect.assertions(2);

    // The declared `appInfo.request`/`.query` types are non-optional, but a
    // route without schemas never has them assigned by the validation wrapper.
    // `PrepareAppInfo` must seed both so a handler reading them can't crash.
    const middleware = new PrepareAppInfo(appInstance);
    const req: { appInfo?: FrameworkRequest['appInfo'] } = {};
    await middleware.middleware(
      req as unknown as FrameworkRequest,
      {} as Response,
      () => {},
    );

    expect(req.appInfo?.request).toStrictEqual({});
    expect(req.appInfo?.query).toStrictEqual({});
  });
});

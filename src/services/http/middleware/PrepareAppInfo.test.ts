import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Response } from 'express';
import { appInstance } from '../../../helpers/appInstance.ts';
import type { FrameworkRequest } from '../HttpServer.ts';
import PrepareAppInfo from './PrepareAppInfo.ts';

describe('prepareAppInfo methods', () => {
  it('have description fields', async () => {
    // const middleware = new PrepareAppInfo(appInstance);

    assert.notStrictEqual(PrepareAppInfo.description, undefined);
  });

  it('middleware that works', async () => {
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

    assert.ok(isCalled);
    assert.notStrictEqual(req.appInfo, undefined);

    if (req.appInfo) {
      req.appInfo.test = 5;
    }

    await middleware.middleware(
      req as unknown as FrameworkRequest,
      {} as Response,
      nextFunction,
    );

    assert.strictEqual(req.appInfo?.test, 5);
  });

  it('initializes request and query to {} so schema-less routes can read them', async () => {
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

    assert.deepStrictEqual(req.appInfo?.request, {});
    assert.deepStrictEqual(req.appInfo?.query, {});
  });
});

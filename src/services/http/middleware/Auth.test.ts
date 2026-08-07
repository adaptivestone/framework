import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import type { Response } from 'express';
import { appInstance } from '../../../helpers/appInstance.ts';
import type { FrameworkRequest } from '../HttpServer.ts';
import Auth from './Auth.ts';
import type { GetUserByTokenAppInfo } from './GetUserByToken.ts';

type AuthRequest = FrameworkRequest & GetUserByTokenAppInfo;

describe('atuh middleware methods', () => {
  let middleware: Auth;

  before(() => {
    middleware = new Auth(appInstance);
  });

  it('have description fields', async () => {
    assert.notStrictEqual(Auth.description, undefined);
  });

  it('middleware pass when user presented', async () => {
    let isCalled = false;
    const nextFunction = () => {
      isCalled = true;
    };
    const req = {
      appInfo: {
        user: true,
      },
    };
    await middleware.middleware(
      req as unknown as AuthRequest,
      {} as unknown as Response,
      nextFunction,
    );

    assert.ok(isCalled);
  });

  it('middleware NOT pass when user NOT presented', async () => {
    let isCalled = false;
    let status = 0;
    let isSend = false;
    const nextFunction = () => {
      isCalled = true;
    };
    const req = {
      appInfo: {}, // no user
    };
    await middleware.middleware(
      req as unknown as AuthRequest,
      {
        status(statusCode: number) {
          status = statusCode;
          return this;
        },
        json() {
          isSend = true;
          return this;
        },
      } as unknown as Response,
      nextFunction,
    );

    assert.ok(!isCalled);
    assert.strictEqual(status, 401);
    assert.ok(isSend);
  });
});

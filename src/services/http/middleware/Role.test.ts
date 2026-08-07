import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Response } from 'express';
import { appInstance } from '../../../helpers/appInstance.ts';
import type { TUser } from '../../../models/User.ts';
import type { FrameworkRequest } from '../HttpServer.ts';
import type { GetUserByTokenAppInfo } from './GetUserByToken.ts';
import Role from './Role.ts';

describe('role middleware methods', () => {
  it('have description fields', async () => {
    // const middleware = new Role(appInstance);

    assert.notStrictEqual(Role.description, undefined);
  });

  it('middleware pass when user presented with a right role', async () => {
    let isCalled = false;
    const nextFunction = () => {
      isCalled = true;
    };
    const req = {
      appInfo: {
        user: {
          roles: ['role1', 'role2'],
        },
      },
    };
    const middleware = new Role(appInstance, {
      roles: ['admin', 'role1'],
    });

    await middleware.middleware(
      req as FrameworkRequest &
        GetUserByTokenAppInfo & { user: InstanceType<TUser> },
      {} as Response,
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
    const middleware = new Role(appInstance);
    await middleware.middleware(
      req as FrameworkRequest &
        GetUserByTokenAppInfo & { user: InstanceType<TUser> },
      {
        status(statusCode) {
          status = statusCode;
          return this;
        },
        json() {
          isSend = true;
        },
      } as Response,
      nextFunction,
    );

    assert.ok(!isCalled);
    assert.strictEqual(status, 401);
    assert.ok(isSend);
  });

  it('middleware NOT pass when user  have a wrong role', async () => {
    let isCalled = false;
    let status = 0;
    let isSend = false;
    const nextFunction = () => {
      isCalled = true;
    };
    const req = {
      appInfo: {
        user: { roles: ['role1', 'role2'] },
      },
    };
    const middleware = new Role(appInstance, { roles: ['admin'] });
    await middleware.middleware(
      req as FrameworkRequest &
        GetUserByTokenAppInfo & { user: InstanceType<TUser> },
      {
        status(statusCode) {
          status = statusCode;
          return this;
        },
        json() {
          isSend = true;
        },
      } as Response,
      nextFunction,
    );

    assert.ok(!isCalled);
    assert.strictEqual(status, 403);
    assert.ok(isSend);
  });
});

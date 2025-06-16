import { describe, it, expect } from 'vitest';
import Role from './Role.ts';
import { appInstance } from '../../../helpers/appInstance.ts';

describe('role middleware methods', () => {
  it('have description fields', async () => {
    expect.assertions(1);

    // const middleware = new Role(appInstance);

    expect(Role.description).toBeDefined();
  });

  it('middleware pass when user presented with a right role', async () => {
    expect.assertions(1);

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

    await middleware.middleware(req, {}, nextFunction);

    expect(isCalled).toBeTruthy();
  });

  it('middleware NOT pass when user NOT presented', async () => {
    expect.assertions(3);

    let isCalled = false;
    let status;
    let isSend;
    const nextFunction = () => {
      isCalled = true;
    };
    const req = {
      appInfo: {}, // no user
    };
    const middleware = new Role(appInstance);
    await middleware.middleware(
      req,
      {
        status(statusCode) {
          status = statusCode;
          return this;
        },
        json() {
          isSend = true;
        },
      },
      nextFunction,
    );

    expect(isCalled).toBeFalsy();
    expect(status).toBe(401);
    expect(isSend).toBeTruthy();
  });

  it('middleware NOT pass when user  have a wrong role', async () => {
    expect.assertions(3);

    let isCalled = false;
    let status;
    let isSend;
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
      req,
      {
        status(statusCode) {
          status = statusCode;
          return this;
        },
        json() {
          isSend = true;
        },
      },
      nextFunction,
    );

    expect(isCalled).toBeFalsy();
    expect(status).toBe(403);
    expect(isSend).toBeTruthy();
  });
});

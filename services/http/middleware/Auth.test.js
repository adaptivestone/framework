import { beforeAll, describe, it, expect } from 'vitest';
import Auth from './Auth.js';

describe('atuh middleware methods', () => {
  let middleware;
  beforeAll(() => {
    middleware = new Auth(global.server.app);
  });
  it('have description fields', async () => {
    expect.assertions(1);
    expect(middleware.constructor.description).toBeDefined();
  });

  it('middleware pass when user presented', async () => {
    expect.assertions(1);
    let isCalled = false;
    const nextFunction = () => {
      isCalled = true;
    };
    const req = {
      appInfo: {
        user: true,
      },
    };
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
});

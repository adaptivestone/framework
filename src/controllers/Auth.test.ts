import { describe, expect, it } from 'vitest';
import { appInstance } from '../helpers/appInstance.ts';
import type { TUser } from '../models/User.ts';
import { getTestServerURL } from '../tests/testHelpers.ts';

const userEmail = 'testing@test.com';
const userPassword = 'SuperNiceSecret123$';

const userEmail2 = 'testing2@test.com';

describe('auth', () => {
  describe('registration', () => {
    it('code NOT able to create user with wrong email', async () => {
      expect.assertions(1);

      const { status } = await fetch(getTestServerURL('/auth/register'), {
        method: 'POST',
        headers: {
          'Content-type': 'application/json',
        },
        body: JSON.stringify({
          email: 'bad email',
          password: userPassword,
          nickName: 'test',
        }),
      }).catch(() => ({ status: 500 }));

      expect(status).toBe(400);
    });

    it('can create user', async () => {
      expect.assertions(1);

      const { status } = await fetch(getTestServerURL('/auth/register'), {
        method: 'POST',
        headers: {
          'Content-type': 'application/json',
        },
        body: JSON.stringify({
          email: userEmail,
          password: userPassword,
          nickName: 'test',
        }),
      });

      expect(status).toBe(201);
    });

    it('can  not create user with the same nickname', async () => {
      expect.assertions(1);

      await fetch(getTestServerURL('/auth/register'), {
        method: 'POST',
        headers: {
          'Content-type': 'application/json',
        },
        body: JSON.stringify({
          email: userEmail,
          password: userPassword,
          nickName: 'test',
        }),
      });

      const { status } = await fetch(getTestServerURL('/auth/register'), {
        method: 'POST',
        headers: {
          'Content-type': 'application/json',
        },
        body: JSON.stringify({
          email: userEmail2,
          password: '123',
          nickName: 'test',
        }),
      }).catch(() => ({ status: 500 }));

      expect(status).toBe(400);
    });

    it('can NOT create SAME user', async () => {
      expect.assertions(1);

      const { status } = await fetch(getTestServerURL('/auth/register'), {
        method: 'POST',
        headers: {
          'Content-type': 'application/json',
        },
        body: JSON.stringify({
          email: userEmail,
          password: userPassword,
          nickName: 'test',
        }),
      });

      expect(status).toBe(400);
    });
  });

  describe('login', () => {
    it('can NOT login with normal creds and not verified email', async () => {
      expect.assertions(1);

      const { status } = await fetch(getTestServerURL('/auth/login'), {
        method: 'POST',
        headers: {
          'Content-type': 'application/json',
        },
        body: JSON.stringify({
          email: userEmail,
          password: userPassword,
        }),
      }).catch(() => ({ status: 500 }));

      expect(status).toBe(400);
    });

    it('can NOT login with WRONG creds', async () => {
      expect.assertions(1);

      const { status } = await fetch(getTestServerURL('/auth/login'), {
        method: 'POST',
        headers: {
          'Content-type': 'application/json',
        },
        body: JSON.stringify({
          email: 'test@test.by',
          password: 'noPassword$',
        }),
      }).catch(() => ({ status: 500 }));

      expect(status).toBe(400);
    });

    it('can login with normal creds and verified email', async () => {
      expect.assertions(3);
      const UserModel = appInstance.getModel('User') as unknown as TUser;

      const user = await UserModel.findOne({
        email: userEmail,
      });
      if (user) {
        user.isVerified = true;
        await user.save();
      }

      const response = await fetch(getTestServerURL('/auth/login'), {
        method: 'POST',
        headers: {
          'Content-type': 'application/json',
        },
        body: JSON.stringify({
          email: userEmail,
          password: userPassword,
        }),
      });

      const responseBody = await response.json();

      expect(response.status).toBe(200);
      expect(responseBody.data).toBeDefined();
      expect(responseBody.data.token).toBeDefined();
    });
  });

  describe('isAuthWithVefificationFlow auth option', () => {
    it('can verify user', async () => {
      expect.assertions(2);
      const UserModel = appInstance.getModel('User') as unknown as TUser;

      const user = await UserModel.create({
        email: 'Test@gmail.com',
        password: 'userPassword',
        name: {
          nick: 'nickname',
        },
      });

      user.verificationTokens?.push({
        token: 'testToken',
      });

      await user.save();

      const { status } = await fetch(
        `${getTestServerURL('/auth/verify')}?verification_token=testToken`,
        {
          method: 'POST',
        },
      );

      const { isVerified } = await UserModel.findOne({
        email: 'Test@gmail.com',
      }).orFail();

      expect(status).toBe(200);
      expect(isVerified).toBeTruthy();
    });

    it('can not verify user with wrong token', async () => {
      expect.assertions(2);
      const UserModel = appInstance.getModel('User') as unknown as TUser;

      const user = await UserModel.create({
        email: 'Test423@gmail.com',
        password: 'userPassword',
        name: {
          nick: 'nicknameee',
        },
      });

      user.verificationTokens?.push({
        token: 'testToken',
      });

      await user.save();

      const { status } = await fetch(
        `${getTestServerURL(
          '/auth/verify',
        )}?verification_token=testToken123wrong`,
        {
          method: 'POST',
        },
      );

      const { isVerified } = await UserModel.findOne({
        email: 'Test423@gmail.com',
      }).orFail();

      expect(status).toBe(400);
      expect(isVerified).toBeFalsy();
    });

    it('can NOT send recovery to not exist email', async () => {
      expect.assertions(1);

      const { status } = await fetch(
        getTestServerURL('/auth/send-recovery-email'),
        {
          method: 'POST',
          headers: {
            'Content-type': 'application/json',
          },
          body: JSON.stringify({
            email: 'notExists@gmail.com',
          }),
        },
      );

      expect(status).toBe(400);
    });

    it('can send recovery to exist email', async () => {
      expect.assertions(1);

      const { status } = await fetch(
        getTestServerURL('/auth/send-recovery-email'),
        {
          method: 'POST',
          headers: {
            'Content-type': 'application/json',
          },
          body: JSON.stringify({
            email: userEmail,
          }),
        },
      );

      expect(status).toBe(200);
    });

    it('can recover password', async () => {
      expect.assertions(1);
      const UserModel = appInstance.getModel('User') as unknown as TUser;

      const user = await UserModel.create({
        email: 'Test1@gmail.com',
        password: 'userPassword',
        name: {
          nick: 'nickname1',
        },
      });

      user.passwordRecoveryTokens?.push({
        token: 'superPassword',
      });

      await user.save();

      const { status } = await fetch(
        getTestServerURL('/auth/recover-password'),
        {
          method: 'POST',
          headers: {
            'Content-type': 'application/json',
          },
          body: JSON.stringify({
            password: 'newPass',
            passwordRecoveryToken: 'superPassword',
          }),
        },
      );

      expect(status).toBe(200);
    });

    it('can not recover password with wrong token', async () => {
      expect.assertions(1);
      const UserModel = appInstance.getModel('User') as unknown as TUser;

      const user = await UserModel.create({
        email: 'Test2@gmail.com',
        password: 'userPassword',
        name: {
          nick: 'nickname2',
        },
      });

      user.passwordRecoveryTokens?.push({
        token: 'superPassword',
      });

      await user.save();

      const { status } = await fetch(
        getTestServerURL('/auth/recover-password'),
        {
          method: 'POST',
          headers: {
            'Content-type': 'application/json',
          },
          body: JSON.stringify({
            password: 'newPass',
            passwordRecoveryToken: '13123',
          }),
        },
      );

      expect(status).toBe(400);
    });

    it('can login with normal creds and NOT verifyed email if option isAuthWithVefificationFlow is set', async () => {
      expect.assertions(4);

      const { status } = await fetch(getTestServerURL('/auth/register'), {
        method: 'POST',
        headers: {
          'Content-type': 'application/json',
        },
        body: JSON.stringify({
          email: userEmail2,
          password: userPassword,
        }),
      });

      const { status: status2 } = await fetch(getTestServerURL('/auth/login'), {
        method: 'POST',
        headers: {
          'Content-type': 'application/json',
        },
        body: JSON.stringify({
          email: userEmail2,
          password: userPassword,
        }),
      });

      appInstance.updateConfig('auth', {
        isAuthWithVefificationFlow: false,
      });

      const response3 = await fetch(getTestServerURL('/auth/login'), {
        method: 'POST',
        headers: {
          'Content-type': 'application/json',
        },
        body: JSON.stringify({
          email: userEmail2,
          password: userPassword,
        }),
      });

      const responseBody3 = await response3.json();

      expect(status).toBe(201);
      expect(status2).toBe(400);
      expect(response3.status).toBe(200);
      expect(responseBody3.data.token).toBeDefined();
    });
  });

  it('can user send verification', async () => {
    expect.assertions(1);

    const { status } = await fetch(
      getTestServerURL('/auth/send-verification'),
      {
        method: 'POST',
        headers: {
          'Content-type': 'application/json',
        },
        body: JSON.stringify({
          email: userEmail2,
        }),
      },
    );

    expect(status).toBe(200);
  });

  it('can not user send verification to wrong email', async () => {
    expect.assertions(1);

    const { status } = await fetch(
      getTestServerURL('/auth/send-verification'),
      {
        method: 'POST',
        headers: {
          'Content-type': 'application/json',
        },
        body: JSON.stringify({
          email: 'wrong@gmail.com',
        }),
      },
    );

    expect(status).toBe(400);
  });

  describe('rate limiter', () => {
    it('should receive 429 on rate limit exceeded', async () => {
      expect.assertions(1);

      const requests = Array.from({ length: 11 }, () =>
        fetch(getTestServerURL('/auth/logout'), {
          method: 'POST',
        }),
      );

      const responses = await Promise.all(requests);
      const statusCodes = responses.map((response) => response.status);

      expect(statusCodes).toContain(429);
    });
  });
});

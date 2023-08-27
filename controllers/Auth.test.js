const request = require('supertest');

const userEmail = 'testing@test.com';
const userPassword = 'SuperNiceSecret123$';

const userEmail2 = 'testing2@test.com';

describe('auth', () => {
  describe('registration', () => {
    it('code NOT able to create user with wrong email', async () => {
      expect.assertions(1);
      const { status } = await fetch(
        global.server.testingGetUrl('/auth/register'),
        {
          method: 'POST',
          headers: {
            'Content-type': 'application/json',
          },
          body: JSON.stringify({
            email: 'bad email',
            password: userPassword,
            nickName: 'test',
          }),
        },
      ).catch(() => {});

      expect(status).toBe(400);
    });

    it('can create user', async () => {
      expect.assertions(1);
      const { status } = await fetch(
        global.server.testingGetUrl('/auth/register'),
        {
          method: 'POST',
          headers: {
            'Content-type': 'application/json',
          },
          body: JSON.stringify({
            email: userEmail,
            password: userPassword,
            nickName: 'test',
          }),
        },
      );
      expect(status).toBe(201);
    });

    it('can  not create user with the same nickname', async () => {
      expect.assertions(1);
      await fetch(global.server.testingGetUrl('/auth/register'), {
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

      const { status } = await fetch(
        global.server.testingGetUrl('/auth/register'),
        {
          method: 'POST',
          headers: {
            'Content-type': 'application/json',
          },
          body: JSON.stringify({
            email: userEmail2,
            password: '123',
            nickName: 'test',
          }),
        },
      ).catch(() => {});

      expect(status).toBe(400);
    });

    it('can NOT create SAME user', async () => {
      expect.assertions(1);

      const { status } = await fetch(
        global.server.testingGetUrl('/auth/register'),
        {
          method: 'POST',
          headers: {
            'Content-type': 'application/json',
          },
          body: JSON.stringify({
            email: userEmail,
            password: userPassword,
            nickName: 'test',
          }),
        },
      );

      expect(status).toBe(400);
    });
  });

  describe('login', () => {
    it('can NOT login with normal creds and not verified email', async () => {
      expect.assertions(1);
      const { status } = await fetch(
        global.server.testingGetUrl('/auth/login'),
        {
          method: 'POST',
          headers: {
            'Content-type': 'application/json',
          },
          body: JSON.stringify({
            email: userEmail,
            password: userPassword,
          }),
        },
      ).catch(() => {});

      expect(status).toBe(400);
    });

    it('can NOT login with WRONG creds', async () => {
      expect.assertions(1);
      const { status } = await fetch(
        global.server.testingGetUrl('/auth/login'),
        {
          method: 'POST',
          headers: {
            'Content-type': 'application/json',
          },
          body: JSON.stringify({
            email: 'test@test.by',
            password: 'noPassword$',
          }),
        },
      ).catch(() => {});
      expect(status).toBe(400);
    });

    it('can login with normal creds and verified email', async () => {
      expect.assertions(2);

      const user = await global.server.app
        .getModel('User')
        .findOne({ email: userEmail });
      user.isVerified = true;
      await user.save();

      const response = await fetch(global.server.testingGetUrl('/auth/login'), {
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
      expect(responseBody.token).toBeDefined();
    });
  });

  describe('isAuthWithVefificationFlow auth option', () => {
    it('can verify user', async () => {
      expect.assertions(2);
      const user = await global.server.app.getModel('User').create({
        email: 'Test@gmail.com',
        password: 'userPassword',
        name: {
          nick: 'nickname',
        },
      });

      user.verificationTokens.push({
        token: 'testToken',
      });

      await user.save();

      const { status } = await fetch(
        `${global.server.testingGetUrl(
          '/auth/verify',
        )}?verification_token=testToken`,
        {
          method: 'POST',
        },
      );

      const { isVerified } = await global.server.app.getModel('User').findOne({
        email: 'Test@gmail.com',
      });

      expect(status).toBe(200);
      expect(isVerified).toBeTruthy();
    });

    it('can not verify user with wrong token', async () => {
      expect.assertions(2);
      const user = await global.server.app.getModel('User').create({
        email: 'Test423@gmail.com',
        password: 'userPassword',
        name: {
          nick: 'nicknameee',
        },
      });

      user.verificationTokens.push({
        token: 'testToken',
      });

      await user.save();

      const { status } = await fetch(
        `${global.server.testingGetUrl(
          '/auth/verify',
        )}?verification_token=testToken123wrong`,
        {
          method: 'POST',
        },
      );

      const { isVerified } = await global.server.app.getModel('User').findOne({
        email: 'Test423@gmail.com',
      });

      expect(status).toBe(400);
      expect(isVerified).toBeFalsy();
    });

    it('can NOT send recovery to not exist email', async () => {
      expect.assertions(1);
      const { status } = await fetch(
        global.server.testingGetUrl('/auth/send-recovery-email'),
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
        global.server.testingGetUrl('/auth/send-recovery-email'),
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

      const user = await global.server.app.getModel('User').create({
        email: 'Test1@gmail.com',
        password: 'userPassword',
        name: {
          nick: 'nickname1',
        },
      });

      user.passwordRecoveryTokens.push({
        token: 'superPassword',
      });

      await user.save();

      const { status } = await fetch(
        global.server.testingGetUrl('/auth/recover-password'),
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

      const user = await global.server.app.getModel('User').create({
        email: 'Test2@gmail.com',
        password: 'userPassword',
        name: {
          nick: 'nickname2',
        },
      });

      user.passwordRecoveryTokens.push({
        token: 'superPassword',
      });

      await user.save();

      const { status } = await fetch(
        global.server.testingGetUrl('/auth/recover-password'),
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

      const { status } = await fetch(
        global.server.testingGetUrl('/auth/register'),
        {
          method: 'POST',
          headers: {
            'Content-type': 'application/json',
          },
          body: JSON.stringify({
            email: userEmail2,
            password: userPassword,
          }),
        },
      );

      const { status: status2 } = await fetch(
        global.server.testingGetUrl('/auth/login'),
        {
          method: 'POST',
          headers: {
            'Content-type': 'application/json',
          },
          body: JSON.stringify({
            email: userEmail2,
            password: userPassword,
          }),
        },
      );

      global.server.app.updateConfig('auth', {
        isAuthWithVefificationFlow: false,
      });

      const response3 = await fetch(
        global.server.testingGetUrl('/auth/login'),
        {
          method: 'POST',
          headers: {
            'Content-type': 'application/json',
          },
          body: JSON.stringify({
            email: userEmail2,
            password: userPassword,
          }),
        },
      );

      const responseBody3 = await response3.json();

      expect(status).toBe(201);
      expect(status2).toBe(400);
      expect(response3.status).toBe(200);
      expect(responseBody3.token).toBeDefined();
    });
  });

  it('can user send verification', async () => {
    expect.assertions(1);

    const { status } = await request(global.server.app.httpServer.express)
      .post('/auth/send-verification')
      .send({
        email: userEmail2,
      });
    expect(status).toBe(200);
  });

  it('can not user send verification to wrong email', async () => {
    expect.assertions(1);

    const { status } = await request(global.server.app.httpServer.express)
      .post('/auth/send-verification')
      .send({
        email: 'wrong@gmail.com',
      });
    expect(status).toBe(400);
  });

  describe('rate limiter', () => {
    it('we  should receive 429 on rate limit exceeded', async () => {
      expect.assertions(1);
      const resultsPromise = [];

      for (let i = 0; i < 11; i += 1) {
        resultsPromise.push(
          request(global.server.app.httpServer.express)
            .post('/auth/logout')
            .send({}),
        );
      }

      const results = await Promise.all(resultsPromise);
      const statuses = results.map((res) => res.status);

      expect(statuses.indexOf(429)).not.toBe(-1);
    });
  });
});

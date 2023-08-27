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
    it('can NOT login with normal creds and not Verifyed email', async () => {
      expect.assertions(1);
      const { status } = await request(global.server.app.httpServer.express)
        .post('/auth/login')
        .send({
          email: userEmail,
          password: userPassword,
        });
      expect(status).toBe(400);
    });

    it('can NOT login with WRONG creds', async () => {
      expect.assertions(1);
      const { status } = await request(global.server.app.httpServer.express)
        .post('/auth/login')
        .send({
          email: 'test@test.by',
          password: 'noPassword$',
        });
      expect(status).toBe(400);
    });

    it('can login with normal creds and verifyed email', async () => {
      expect.assertions(2);

      const user = await global.server.app
        .getModel('User')
        .findOne({ email: userEmail });
      user.isVerified = true;
      await user.save();

      const { status, body } = await request(
        global.server.app.httpServer.express,
      )
        .post('/auth/login')
        .send({
          email: userEmail,
          password: userPassword,
        });
      expect(status).toBe(200);
      expect(body.token).toBeDefined();
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

      const { status } = await request(
        global.server.app.httpServer.express,
      ).post(`/auth/verify?verification_token=testToken`);

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

      const { status } = await request(
        global.server.app.httpServer.express,
      ).post(`/auth/verify?verification_token=testToken123wrong`);

      const { isVerified } = await global.server.app.getModel('User').findOne({
        email: 'Test423@gmail.com',
      });

      expect(status).toBe(400);
      expect(isVerified).toBeFalsy();
    });

    it('can NOT send recovery to not exist email', async () => {
      expect.assertions(1);
      const { status } = await request(global.server.app.httpServer.express)
        .post('/auth/send-recovery-email')
        .send({
          email: 'notExists@gmail.com',
        });
      expect(status).toBe(400);
    });

    it('can send recovery to exist email', async () => {
      expect.assertions(1);
      const { status } = await request(global.server.app.httpServer.express)
        .post('/auth/send-recovery-email')
        .send({
          email: userEmail,
        });
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

      const { status } = await request(global.server.app.httpServer.express)
        .post('/auth/recover-password')
        .send({
          password: 'newPass',
          passwordRecoveryToken: 'superPassword',
        });

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

      const { status } = await request(global.server.app.httpServer.express)
        .post('/auth/recover-password')
        .send({
          password: 'newPass',
          passwordRecoveryToken: '13123',
        });

      expect(status).toBe(400);
    });

    it('can login with normal creds and  NOT verifyed email is option isAuthWithVefificationFlow is set', async () => {
      expect.assertions(4);

      const { status } = await request(global.server.app.httpServer.express)
        .post('/auth/register')
        .send({
          email: userEmail2,
          password: userPassword,
        });

      const { status: status2 } = await request(
        global.server.app.httpServer.express,
      )
        .post('/auth/login')
        .send({
          email: userEmail2,
          password: userPassword,
        });

      global.server.app.updateConfig('auth', {
        isAuthWithVefificationFlow: false,
      });

      const { status: status3, body } = await request(
        global.server.app.httpServer.express,
      )
        .post('/auth/login')
        .send({
          email: userEmail2,
          password: userPassword,
        });

      expect(status).toBe(201);
      expect(status2).toBe(400);
      expect(status3).toBe(200);
      expect(body.token).toBeDefined();
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

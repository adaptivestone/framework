const request = require('supertest');

const userEmail = 'testing@test.com';
const userPassword = 'SuperNiceSecret123$';

const userEmail2 = 'testing2@test.com';

describe('auth', () => {
  describe('registration', () => {
    it('code NOT able to create user with wrong email', async () => {
      expect.assertions(1);
      const { status } = await request(global.server.app.httpServer.express)
        .post('/auth/register')
        .send({
          email: 'bad email',
          password: userPassword,
          nickName: 'test',
        });
      expect(status).toBe(400);
    });

    it('can create user', async () => {
      expect.assertions(2);
      const { status, body } = await request(
        global.server.app.httpServer.express,
      )
        .post('/auth/register')
        .send({
          email: userEmail,
          password: userPassword,
          nickName: 'test',
        });
      expect(status).toBe(201);
      expect(body.success).toBe(true);
    });

    it('can NOT create SAME user', async () => {
      expect.assertions(1);
      const { status } = await request(global.server.app.httpServer.express)
        .post('/auth/register')
        .send({
          email: userEmail,
          password: userPassword,
          nickName: 'test',
        });
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
      expect.assertions(3);

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
      expect(body.success).toBe(true);
      expect(body.token).toBeDefined();
    });
  });

  describe('isAuthWithVefificationFlow auth option', () => {
    it('can login with normal creds and  NOT verifyed email is option isAuthWithVefificationFlow is set', async () => {
      expect.assertions(5);

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
      expect(body.success).toBe(true);
      expect(body.token).toBeDefined();
    });
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

const request = require('supertest');

const userEmail = 'testing@test.com';
const userPassword = 'SuperNiceSecret123$';

describe('autentification', () => {
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
      expect(status).toBe(200);
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

    it('can  login with normal creds and  verifyed email', async () => {
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
});

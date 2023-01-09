const userEmail = 'testing@test.com';
const userPassword = 'SuperNiceSecret123$';

let globalUser;

describe('user model', () => {
  it('can create user', async () => {
    expect.assertions(1);
    globalUser = await global.server.app.getModel('User').create({
      email: userEmail,
      password: userPassword,
      name: {
        nick: 'nickname',
      },
    });
    expect(globalUser.id).toBeDefined();
  });

  it('passwords should be hashed', async () => {
    expect.assertions(1);

    const user = await global.server.app.getModel('User').findOne({
      email: userEmail,
    });
    expect(user.password).not.toBe(userPassword);
  });

  it('passwords should not be changed on other fields save', async () => {
    expect.assertions(1);
    const user = await global.server.app.getModel('User').findOne({
      email: userEmail,
    });
    const psw = user.password;
    user.email = 'rrrr';
    await user.save();
    user.email = userEmail;
    await user.save();

    expect(user.password).toBe(psw);
  });

  describe('getUserByEmailAndPassword', () => {
    it('should WORK with valid creds', async () => {
      expect.assertions(1);
      const userModel = await global.server.app.getModel('User');
      const user = await userModel.getUserByEmailAndPassword(
        userEmail,
        userPassword,
      );
      expect(user.id).toBe(globalUser.id);
    });

    it('should NOT with INvalid creds', async () => {
      expect.assertions(1);
      const userModel = await global.server.app.getModel('User');
      const user = await userModel.getUserByEmailAndPassword(
        userEmail,
        'wrongPassword',
      );
      expect(user).toBe(false);
    });
  });

  describe('getUserByVerificationToken', () => {
    it('should NOT work for non valid token', async () => {
      expect.assertions(2);

      const user = await global.server.app
        .getModel('User')
        .getUserByVerificationToken('fake one')
        .catch((e) => {
          expect(e).toBeDefined();
        });
      expect(user).toBeUndefined();
    });

    it('should  work for VALID token', async () => {
      expect.assertions(1);
      const token = await global.server.app
        .getModel('User')
        .generateUserVerificationToken(globalUser);

      const user = await global.server.app
        .getModel('User')
        .getUserByVerificationToken(token.token);
      expect(user.id).toBe(globalUser.id);
    });
  });

  describe('getUserByPasswordRecoveryToken', () => {
    it('should NOT work for non valid token', async () => {
      expect.assertions(2);

      const user = await global.server.app
        .getModel('User')
        .getUserByPasswordRecoveryToken('fake one')
        .catch((e) => {
          expect(e).toBeDefined();
        });
      expect(user).toBeUndefined();
    });

    it('should  work for VALID token', async () => {
      expect.assertions(1);
      const token = await global.server.app
        .getModel('User')
        .generateUserPasswordRecoveryToken(globalUser);

      const user = await global.server.app
        .getModel('User')
        .getUserByPasswordRecoveryToken(token.token);
      expect(user.id).toBe(globalUser.id);
    });
  });
});

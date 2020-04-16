const userEmail = 'testing@test.com';
const userPassword = 'SuperNiceSecret123$';

describe('user model', () => {
  it('can create user', async () => {
    expect.assertions(1);
    const user = await global.server.app.getModel('User').create({
      email: userEmail,
      password: userPassword,
      name: {
        nick: 'nickname',
      },
    });
    // eslint-disable-next-line no-underscore-dangle
    expect(user._id).toBeDefined();
  });

  it('passwords should be hashed', async () => {
    expect.assertions(1);

    const user = await global.server.app.getModel('User').findOne({
      email: userEmail,
    });
    expect(user.password !== userPassword).toBe(true);
  });

  it('passwords should not be changed on other fields save', async () => {
    expect.assertions(1);
    const user = await global.server.app.getModel('User').findOne({
      email: userEmail,
    });
    const psw = user.password;
    user.email = 'rrrr';
    user.save();

    expect(user.password === psw).toBe(true);
  });
});

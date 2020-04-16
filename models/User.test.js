const userEmail = 'testing@test.com';
const userPassword = 'SuperNiceSecret123$';

test('can create user', async () => {
  let user = await global.server.app.getModel('User').create({
    email: userEmail,
    password: userPassword,
    name: {
      nick: 'nickname',
    },
  });
});

test('passwords should be hashed', async () => {
  let user = await global.server.app.getModel('User').findOne({
    email: userEmail,
  });
  expect(user.password !== userPassword).toBeTruthy();
});

test('passwords should not be changed on other fields save', async () => {
  let user = await global.server.app.getModel('User').findOne({
    email: userEmail,
  });
  let psw = user.password;
  user.email = 'rrrr';
  user.save();

  expect(user.password === psw).toBeTruthy();
});

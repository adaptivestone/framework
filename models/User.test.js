const User = require('./User');

test('can create user', async () => {
    let user = await  User.create({
        email: "test@test.com",
        password: "test"
    });
});

test('passwords should be hashed', async () => {
    let user = await  User.findOne({
        email: "test@test.com",
    });
    expect(user.password !== "test").toBeTruthy();
});

test('passwords should not be changed on other fields save', async () => {
    let user = await  User.findOne({
        email: "test@test.com",
    });
    let psw = user.password;
    user.email = "rrrr";
    user.save();

    expect(user.password === psw).toBeTruthy();
});
const AbstractCommand = require('../modules/AbstractCommand');

// Example: node src/cli adduser --email=somemail@gmail.com  --password=somePassword --roles=user,admin,someOtherRoles
class AddUser extends AbstractCommand {
  async run() {
    const User = this.app.getModel('User');
    const { email, password, roles } = this.args;

    if (!email || !password) {
      this.logger.error('Input validation failded');
      this.logger.error('Please add "email" and "password" variables');
      return false;
    }
    const user = await User.create({
      email,
      password,
      roles: roles?.split(','),
    });
    this.logger.info(`User was created ${JSON.stringify(user, 0, 4)}`);

    return user;
  }
}

module.exports = AddUser;

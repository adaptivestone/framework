import AbstractCommand from '../modules/AbstractCommand.js';

// Example: node src/cli createuser --email=somemail@gmail.com  --password=somePassword --roles=user,admin,someOtherRoles
class CreateUser extends AbstractCommand {
  async run() {
    const User = this.app.getModel('User');
    const { id, email, password, roles, update } = this.args;

    if (!email && !id) {
      this.logger.error('Input validation failded');
      this.logger.error('Please add "email" or "id" variables');
      return false;
    }

    let user;

    if (id) {
      user = await User.findOne({ _id: id });
    } else if (email) {
      user = await User.findOne({ email });
    }

    if (user && !update) {
      this.logger.error(
        'We are found a user in database. But "update" option is not providing. Exitin',
      );
      return false;
    }

    if (!user && !password) {
      this.logger.error(
        'For a new user we alway asking for a password. Please provide it and rerun command',
      );
      return false;
    }

    if (!user && !email) {
      this.logger.error(
        'For a new user we alway asking for a email. Please provide it and rerun command',
      );
      return false;
    }

    if (!user) {
      user = new User();
    }

    if (password) {
      user.password = password;
    }
    if (email) {
      user.email = email;
    }

    if (roles) {
      user.roles = roles.split(',');
    }

    await user.save();

    await user.generateToken();

    this.logger.info(
      `User was created/updated ${JSON.stringify(user, null, 4)}`,
    );

    return user;
  }
}

export default CreateUser;

const Base = require('./Base');

class AbstractCommand extends Base {
  constructor(app, commands, args) {
    super(app);
    this.args = args;
    this.commands = commands;
  }

  static get loggerGroup() {
    return 'command';
  }
}

module.exports = AbstractCommand;

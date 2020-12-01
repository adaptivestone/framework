const Base = require('./Base');

class AbstractCommand extends Base {
  constructor(app, commands) {
    super(app);
    this.commands = commands;
  }

  static get loggerGroup() {
    return 'command';
  }
}

module.exports = AbstractCommand;

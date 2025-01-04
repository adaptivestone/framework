import Base from './Base.js';

class AbstractCommand extends Base {
  constructor(app, commands, args) {
    super(app);
    this.args = args;
    this.commands = commands;
  }

  static get description() {
    return 'Command description. PLEASE PROVIDE IT';
  }

  /**
   * Entry point to every command. This method should be overridden
   * @return {Promise<boolean>} resut
   */
  async run() {
    this.logger.error('You should implement run method');
    return false;
  }

  static get loggerGroup() {
    return 'command';
  }
}

export default AbstractCommand;

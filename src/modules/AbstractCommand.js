import Base from './Base.ts';

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
   * If true, then this command will load models and init mongo connection
   */
  static isShouldInitModels = true;

  /**
   * Get mongo connection name
   * @param {String} commandName
   * @param {object} args
   * @returns string
   */
  static getMongoConnectionName(commandName, args) {
    return `CLI: ${commandName} ${JSON.stringify(args)}`;
  }

  /**
   * You able to add command arguments for parsing there.
   * @see https://nodejs.org/api/util.html#utilparseargsconfig in config.options plus extended with description and required
   * @returns {import("../types/ICommandArguments.d.ts").ICommandArguments}
   */
  static get commandArguments() {
    return {};
  }

  /**
   * Entry point to every command. This method should be overridden
   * @return {Promise<boolean>} result
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

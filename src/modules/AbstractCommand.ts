import Base from './Base.ts';
import type { IApp } from '../server.ts';
import type { ParseArgsOptionsConfigExtended } from './BaseCli.ts';

class AbstractCommand extends Base {
  commands: Record<string, string>;

  args: Record<string, unknown>;

  constructor(
    app: IApp,
    commands: Record<string, string>,
    args: Record<string, unknown>,
  ) {
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
   * If true, then this command will get model paths with inheritance
   */
  static isShouldGetModelPaths = true;

  /**
   * Get mongo connection name
   * @param {String} commandName
   * @param {object} args
   */
  static getMongoConnectionName(
    commandName: string,
    args: Record<string, unknown>,
  ) {
    return `CLI: ${commandName} ${JSON.stringify(args)}`;
  }

  /**
   * You able to add command arguments for parsing there.
   * @see https://nodejs.org/api/util.html#utilparseargsconfig in config.options plus extended with description and required
   */
  static get commandArguments(): Record<
    string,
    ParseArgsOptionsConfigExtended
  > {
    return {};
  }

  /**
   * Entry point to every command. This method should be overridden
   */
  async run(): Promise<boolean> {
    this.logger?.error('You should implement run method');
    return false;
  }

  static get loggerGroup() {
    return 'command';
  }
}

export default AbstractCommand;

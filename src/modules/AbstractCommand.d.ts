import type Base from './Base.js';
import type { ICommandArguments } from '../types/ICommandArguments.d.ts';

abstract class AbstractCommand extends Base {
  constructor(
    app: Server['app'],
    commands: { [key: string]: string },
    args: {
      [longOption: string]:
        | undefined
        | string
        | boolean
        | Array<string | boolean>;
    },
  );

  static get description(): string;
  /**
   * If true, then this command will load models and init mongo connection
   */
  static isShouldInitModels = true;

  /**
   * Get mongo connection name
   */
  static getMongoConnectionName(
    commandName: string,
    args: {
      [longOption: string]:
        | undefined
        | string
        | boolean
        | Array<string | boolean>;
    },
  ): string;

  /**
   * You able to add command arguments for parsing there.
   * @see https://nodejs.org/api/util.html#utilparseargsconfig in config.options plus extended with description and required
   * @returns {import("../types/ICommandArguments.d.ts").ICommandArguments}
   */
  static get commandArguments(): ICommandArguments;

  /**
   * Entry point to every command. This method should be overridden
   */
  async run(): Promise<boolean | unknown>;
}

export default AbstractCommand;

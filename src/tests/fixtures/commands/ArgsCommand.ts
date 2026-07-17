import AbstractCommand from '../../../modules/AbstractCommand.ts';
import type { ParseArgsOptionsConfigExtended } from '../../../modules/BaseCli.ts';

export let runCount = 0;
export let receivedArgs: Record<string, unknown> | undefined;

export const resetArgsCommand = () => {
  runCount = 0;
  receivedArgs = undefined;
};

/** Controlled fixture for the CLI argument parsing and help paths. */
class ArgsCommand extends AbstractCommand {
  static get description(): string {
    return 'Fixture command with arguments';
  }

  static isShouldInitModels = false;

  static isShouldGetModelPaths = false;

  static get commandArguments(): Record<
    string,
    ParseArgsOptionsConfigExtended
  > {
    return {
      name: {
        type: 'string',
        description: 'Name to process',
        required: true,
      },
      mode: {
        type: 'string',
        description: 'Processing mode',
        default: 'safe',
      },
    };
  }

  async run(): Promise<boolean> {
    runCount += 1;
    receivedArgs = { ...this.args };
    return true;
  }
}

export default ArgsCommand;

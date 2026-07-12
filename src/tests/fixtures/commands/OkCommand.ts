import AbstractCommand from '../../../modules/AbstractCommand.ts';

/**
 * Fixture command whose `run()` succeeds. Counterpart to `ThrowingCommand` for
 * asserting the success path stays `true`. No Mongo (model init/paths disabled).
 */
class OkCommand extends AbstractCommand {
  static get description(): string {
    return 'Fixture command that always succeeds';
  }

  static isShouldInitModels = false;

  static isShouldGetModelPaths = false;

  async run(): Promise<boolean> {
    return true;
  }
}

export default OkCommand;

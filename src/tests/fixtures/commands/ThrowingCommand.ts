import AbstractCommand from '../../../modules/AbstractCommand.ts';

/**
 * Fixture command whose `run()` rejects. Exercises `BaseCli.run`'s thrown-command
 * path without touching Mongo (model init/paths disabled).
 */
class ThrowingCommand extends AbstractCommand {
  static get description(): string {
    return 'Fixture command that always throws';
  }

  static isShouldInitModels = false;

  static isShouldGetModelPaths = false;

  async run(): Promise<boolean> {
    throw new Error('boom from fixture command');
  }
}

export default ThrowingCommand;

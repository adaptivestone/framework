import AbstractCommand from '../../../modules/AbstractCommand.ts';

/** Fixture that exercises the model-aware CLI lifecycle without querying Mongo. */
class ModelCommand extends AbstractCommand {
  static get description(): string {
    return 'Fixture command that requires initialized models';
  }

  async run(): Promise<boolean> {
    return true;
  }
}

export default ModelCommand;

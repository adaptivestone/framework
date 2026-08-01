import AbstractCommand from '../modules/AbstractCommand.ts';
import type { AppModel } from '../server.ts';

class DropIndex extends AbstractCommand {
  static get description() {
    return 'Drop indexes of model';
  }

  /**
   * You able to add command arguments for parsing there.
   */
  static get commandArguments() {
    return {
      model: {
        type: 'string' as const,
        description: 'Model name',
        required: true,
      },
    };
  }

  async run() {
    let Model: AppModel;
    try {
      Model = this.app.getModelOrThrow(this.args.model as string);
    } catch {
      this.logger?.error('Not able to find model');
      return false;
    }

    await Model.collection.dropIndexes();

    this.logger?.info('Success');

    return true;
  }
}

export default DropIndex;

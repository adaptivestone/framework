import AbstractCommand from '../modules/AbstractCommand.ts';

class DropIndex extends AbstractCommand {
  static get description() {
    return 'Drop indexes of model';
  }

  /**
   * You able to add command arguments for parsing there.
   * @returns {import("../types/ICommandArguments.js").ICommandArguments}
   */
  static get commandArguments() {
    return {
      model: {
        type: 'string',
        description: 'Model name',
        required: true,
      },
    };
  }

  async run() {
    const Model = this.app.getModel(this.args.model);

    if (!Model) {
      this.logger.error('Not able to find model');
      return false;
    }

    await Model.collection.dropIndexes();

    this.logger.info('Success');

    return true;
  }
}

export default DropIndex;

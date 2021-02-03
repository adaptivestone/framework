const AbstractCommand = require('../modules/AbstractCommand');

class DropIndex extends AbstractCommand {
  async run() {
    if (!this.args.model) {
      this.logger.error('Please provide model name as "--model=BestUserModel"');
      return false;
    }

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

module.exports = DropIndex;

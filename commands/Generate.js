const AbstractCommand = require('../modules/AbstractCommand');

class Generate extends AbstractCommand {
  async run() {
    if (!this.args.type) {
      this.logger.error('Please provide type to generate "--type=model');

      return false;
    }
    return true;
  }
}

module.exports = Generate;

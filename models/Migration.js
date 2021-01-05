const AbstractModel = require('../modules/AbstractModel');

class Migration extends AbstractModel {
  // eslint-disable-next-line class-methods-use-this
  get modelSchema() {
    return {
      migrationFile: {
        type: String,
        unique: true,
      },
    };
  }
}

module.exports = Migration;

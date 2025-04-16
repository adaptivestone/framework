import AbstractModel from '../modules/AbstractModel.js';

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

export default Migration;

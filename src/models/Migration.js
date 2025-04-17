import AbstractModel from '../modules/AbstractModel.ts';

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

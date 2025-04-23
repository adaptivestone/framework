import AbstractModel from '../modules/AbstractModel.ts';

interface IMigration {
  migrationFile: string;
}

class Migration extends AbstractModel<IMigration> {
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

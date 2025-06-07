import { BaseModel } from '../modules/BaseModel.ts';

class Migration extends BaseModel {
  static get modelSchema() {
    return {
      migrationFile: {
        type: String,
        unique: true,
      },
    } as const;
  }
}

export default Migration;

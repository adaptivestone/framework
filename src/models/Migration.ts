import { BaseModel } from '../modules/BaseModel.ts';
import type { GetModelTypeFromClass } from '../modules/BaseModel.ts';

export type TMigration = GetModelTypeFromClass<typeof Migration>;
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

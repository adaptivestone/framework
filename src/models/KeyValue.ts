import { Schema } from 'mongoose';
import type { GetModelTypeFromClass } from '../modules/BaseModel.ts';
import { BaseModel } from '../modules/BaseModel.ts';

export type TKeyValue = GetModelTypeFromClass<typeof KeyValue>;

/**
 * Simple key/value storage backed by MongoDB.
 * Handy as a lightweight persistent cache, runtime config, feature flags, etc.
 * The key is the document `_id` (a string); the value can be anything.
 */
class KeyValue extends BaseModel {
  static get modelSchema() {
    return {
      _id: { type: String, required: true },
      value: { type: Schema.Types.Mixed, required: true },
    } as const;
  }
}

export default KeyValue;

import { BaseModel } from '../modules/BaseModel.ts';
import type {
  GetModelTypeLiteFromSchema,
  ExtractProperty,
} from '../modules/BaseModel.ts';

class Sequence extends BaseModel {
  static get modelSchema() {
    return {
      _id: { type: String, required: true },
      seq: { type: Number, default: 1 },
    } as const;
  }

  static get modelStatics() {
    type SequenceModelLite = GetModelTypeLiteFromSchema<
      typeof Sequence.modelSchema,
      ExtractProperty<typeof Sequence, 'schemaOptions'>
    >;
    return {
      getSequence: async function (this: SequenceModelLite, forType: string) {
        const sequence = await this.findByIdAndUpdate(
          { _id: forType },
          { $inc: { seq: 1 } },
          { new: true, upsert: true },
        );
        return sequence.seq;
      },
    } as const;
  }
}

export default Sequence;

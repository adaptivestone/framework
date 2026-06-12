import type {
  ExtractProperty,
  GetModelTypeFromClass,
  GetModelTypeLiteFromSchema,
} from '../modules/BaseModel.ts';
import { BaseModel } from '../modules/BaseModel.ts';

export type TSequence = GetModelTypeFromClass<typeof Sequence>;

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
      getSequence: async function (
        this: SequenceModelLite,
        forType: string,
      ): Promise<number> {
        // `findByIdAndUpdate` takes the id directly, not a filter object.
        const bump = () =>
          this.findByIdAndUpdate(
            forType,
            { $inc: { seq: 1 } },
            { returnDocument: 'after', upsert: true },
          );
        try {
          return (await bump()).seq;
        } catch (error) {
          // Two concurrent upserts on a brand-new _id can race to E11000 (a
          // documented Mongo upsert race) — the loser retries once and the doc
          // now exists, so the second `$inc` succeeds.
          if ((error as { code?: number }).code !== 11000) {
            throw error;
          }
          return (await bump()).seq;
        }
      },
    } as const;
  }
}

export default Sequence;

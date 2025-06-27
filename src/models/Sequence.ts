import type {
  ExtractProperty,
  GetModelTypeFromClass,
  GetModelTypeLiteFromSchema,
} from "../modules/BaseModel.ts";
import { BaseModel } from "../modules/BaseModel.ts";

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
      ExtractProperty<typeof Sequence, "schemaOptions">
    >;
    return {
      getSequence: async function (
        this: SequenceModelLite,
        forType: string,
      ): Promise<number> {
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

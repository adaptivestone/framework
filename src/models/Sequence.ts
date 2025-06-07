import { BaseModel } from '../modules/BaseModel.ts';
import type {
  GetModelTypeLiteFromSchema,
  SchemaOptionsReturnType,
} from '../modules/BaseModel.ts';

class Sequence extends BaseModel {
  static get modelSchema() {
    return {
      _id: { type: String, required: true },
      seq: { type: Number, default: 1 },
    } as const;
  }

  // static get modelMethods() {
  //   type SequenceModelLite = GetModelTypeLiteFromSchema<
  //     typeof Sequence.modelSchema,
  //     ModelOptionsReturnType<typeof Sequence>
  //   >;

  //   return {
  //     getPublic: async function (this: InstanceType<SequenceModelLite>) {
  //       return {
  //         _id: this._id,
  //         seq: this.seq,
  //       };
  //     },
  //   } as const;
  // }

  static get modelStatics() {
    type SequenceModelLite = GetModelTypeLiteFromSchema<
      typeof Sequence.modelSchema,
      SchemaOptionsReturnType<typeof Sequence>
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

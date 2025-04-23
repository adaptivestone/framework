import AbstractModel from '../modules/AbstractModel.ts';

import type {
  IAbstractModel,
  IAbstractModelMethods,
} from '../modules/AbstractModel.ts';

interface ISequence {
  _id: string;
  seq: Number;
}

interface IStatic
  extends IAbstractModel<ISequence, IAbstractModelMethods<ISequence>> {
  getSequence(forType: string): Promise<number>;
}

class Sequence extends AbstractModel<
  ISequence,
  IAbstractModelMethods<ISequence>,
  IStatic
> {
  // eslint-disable-next-line class-methods-use-this
  get modelSchema() {
    return {
      _id: { type: String, required: true },
      seq: { type: Number, default: 1 },
    };
  }

  static async getSequence(this: Sequence['mongooseModel'], forType: string) {
    const sequence = await this.findByIdAndUpdate(
      { _id: forType },
      { $inc: { seq: 1 } },
      { new: true, upsert: true },
    );
    return sequence.seq;
  }
}

export default Sequence;

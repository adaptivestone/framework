import AbstractModel from '../modules/AbstractModel.ts';

class Sequence extends AbstractModel {
  // eslint-disable-next-line class-methods-use-this
  get modelSchema() {
    return {
      _id: { type: String, required: true },
      seq: { type: Number, default: 1 },
    };
  }

  static async getSequence(forType) {
    const sequence = await this.findByIdAndUpdate(
      { _id: forType },
      { $inc: { seq: 1 } },
      { new: true, upsert: true },
    );
    return sequence.seq;
  }
}

export default Sequence;

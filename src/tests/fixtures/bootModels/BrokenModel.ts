import { BaseModel } from '../../../modules/BaseModel.ts';

// A model whose schema getter throws during `initialize()`. Boot must fail loudly
// and name this model, rather than logging-and-continuing into a request-time crash.
export default class BrokenModel extends BaseModel {
  static get modelSchema(): never {
    throw new Error('intentional model schema failure');
  }
}

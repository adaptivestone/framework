import type Base from './Base.js';
import { Model, Schema } from 'mongoose';
import type Server from '../server.js';

interface AbstractModel<T extends Document = Document> extends Model, Base {
  constructor(app: Server['app'], callback?: () => void);

  /**
   *  Return itself for internal methods.
   */
  getSuper(): this;

  /**
   *  Model schema in Js object (not a mongoose schema).
   */
  get modelSchema(): Object;

  /**
   * Mongoose schema.
   */
  mongooseSchema: Schema<T>;

  /**
   * Acces to mongoose model too
   */
  mongooseModel: Model<T>;

  /**
   * Init custom hooks before model
   */
  initHooks(): void;
}

abstract class AbstractModel<T extends Document = Document>
  extends Model
  implements AbstractModel
{
  abstract get modelSchema(): Object;

  /**
   * Return itself for internal methods.
   */
  static abstract getSuper(): this;

  mongooseSchema: Schema<T> = new Schema<T>(this.modelSchema);
}

export default AbstractModel;

import type { Model, Schema } from 'mongoose';
import mongoose from 'mongoose';

import type { IApp } from '../server.ts';
import Base from './Base.ts';

export interface IAbstractModelMethods<T> {
  getSuper(): AbstractModel<T> & this;
}

export interface IAbstractModel<IDocument, IMethods>
  extends Model<IDocument, object, IMethods> {
  getSuper(): AbstractModel<IDocument> & this;
}

class AbstractModel<
  IDocument = object,
  IMethods extends
    IAbstractModelMethods<IDocument> = IAbstractModelMethods<IDocument>,
  IModel extends IAbstractModel<IDocument, IMethods> = IAbstractModel<
    IDocument,
    IMethods
  >,
> extends Base {
  mongooseSchema: Schema<IDocument, IModel, IMethods>;

  mongooseModel: IModel;

  /**
   * @param IApp app
   * @param function callback optional callback when connection ready
   */
  constructor(app: IApp) {
    super(app);
    this.mongooseSchema = new mongoose.Schema<IDocument, IModel, IMethods>(
      this.modelSchema,
      this.modelSchemaOptions,
    );
    this.mongooseSchema.set('timestamps', true);
    this.mongooseSchema.set('minimize', false);
    this.mongooseSchema.loadClass(this.constructor);
    this.mongooseSchema.static('getSuper', () => this);
    this.mongooseSchema.method('getSuper', () => this);
    this.initHooks();
    this.mongooseModel = mongoose.model<IDocument, IModel>(
      this.constructor.name,
      this.mongooseSchema,
    );
  }

  /**
   * Mongoose schema
   */
  get modelSchema() {
    this.logger?.warn('You should provide modelSchema');
    return {};
  }

  /**
   * Mongoose schema options
   */
  get modelSchemaOptions() {
    return {};
  }

  static get loggerGroup() {
    return 'model';
  }

  initHooks() {
    this.logger?.verbose(`Model ${this.constructor.name} has no custom hooks.`);
  }
}
export default AbstractModel;

import mongoose from 'mongoose';
import Base from './Base.ts';

import type { IApp } from '../server.ts';
import type { Schema, Model } from 'mongoose';

export interface IAbstractModelMethods<T> {
  getSuper(): AbstractModel<T> & this;
}

export interface IAbstractModel<IDocument, IMethods>
  extends Model<IDocument, {}, IMethods> {
  getSuper(): AbstractModel<IDocument> & this;
}

class AbstractModel<
  IDocument = {},
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
  constructor(app: IApp, callback = () => {}) {
    super(app);
    this.mongooseSchema = new mongoose.Schema<IDocument, IModel, IMethods>(
      this.modelSchema,
      this.modelSchemaOptions,
    );
    mongoose.set('strictQuery', true);
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
    if (!mongoose.connection.readyState) {
      this.app.events.on('shutdown', async () => {
        this.logger?.verbose(
          'Shutdown was called. Closing all mongoose connections',
        );
        for (const c of mongoose.connections) {
          c.close(true);
        }
        // await mongoose.disconnect(); // TODO it have problems with replica-set
      });
      const connectionParams: {
        appName?: string;
      } = {};
      if (process.env.MONGO_APP_NAME) {
        connectionParams.appName = process.env.MONGO_APP_NAME;
      }
      // do not connect on test
      mongoose
        .connect(this.app.getConfig('mongo').connectionString, connectionParams)
        .then(
          () => {
            this.logger?.info(
              `Mongo connection success ${connectionParams.appName}`,
            );
            mongoose.connection.on('error', (err) => {
              this.logger?.error('Mongo connection error', err);
              console.error(err);
            });

            callback();
          },
          (error) => {
            this.logger?.error("Can't install mongodb connection", error);
          },
        );
    } else {
      callback();
    }
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
  // eslint-disable-next-line class-methods-use-this
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

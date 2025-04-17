import mongoose from 'mongoose';
import Base from './Base.ts';

import type { IApp } from '../server.ts';
import type {
  Schema,
  SchemaOptions,
  Model,
  HydratedDocument,
  SchemaDefinition,
  SchemaDefinitionType,
} from 'mongoose';

export interface BaseDocument extends Document {
  // getSuper(): AbstractModel<any, any>;
}

export interface BaseModel<
  TDoc extends BaseDocument,
  TQueryHelpers = {}, // Add if you use query helpers
> extends Model<HydratedDocument<TDoc>, TQueryHelpers> {
  // getSuper(): AbstractModel<any, any>;
}

class AbstractModel<
  TDocument extends BaseDocument,
  TModel extends BaseModel<TDocument>,
> extends Base {
  mongooseSchema: Schema<TDocument, TModel>;

  mongooseModel: TModel;

  /**
   * @param IApp app
   * @param function callback optional callback when connection ready
   */
  constructor(app: IApp, callback = () => {}) {
    super(app);
    this.mongooseSchema = new mongoose.Schema<TDocument, TModel>(
      this.modelSchema,
      this.modelSchemaOptions as any,
    );
    mongoose.set('strictQuery', true);
    this.mongooseSchema.set('timestamps', true);
    this.mongooseSchema.set('minimize', false);
    this.mongooseSchema.loadClass(this.constructor);
    this.mongooseSchema.statics.getSuper = () => this;
    this.mongooseSchema.methods.getSuper = () => this;
    this.initHooks();
    this.mongooseModel = mongoose.model<TDocument, TModel>(
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
  get modelSchema(): SchemaDefinition<SchemaDefinitionType<TDocument>> {
    this.logger?.warn('You should provide modelSchema');
    return {} as SchemaDefinition<SchemaDefinitionType<TDocument>>;
  }

  /**
   * Mongoose schema options
   */
  // eslint-disable-next-line class-methods-use-this
  get modelSchemaOptions(): SchemaOptions<TDocument> {
    return {} as SchemaOptions<TDocument>;
  }

  static get loggerGroup() {
    return 'model';
  }

  initHooks() {
    this.logger?.verbose('Model have no hooks');
  }
}
export default AbstractModel;

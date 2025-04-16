import mongoose from 'mongoose';
import Base from './Base.js';

class AbstractModel extends Base {
  mongooseSchema = null;

  mongooseModel = null;

  /**
   * @param {import('../server.js').default['app']} app  //TODO change to *.d.ts as this is a Server, not app
   * @param function callback optional callback when connection ready
   */
  constructor(app, callback = () => {}) {
    super(app);
    this.mongooseSchema = new mongoose.Schema(
      this.modelSchema,
      this.modelSchemaOptions,
    );
    mongoose.set('strictQuery', true);
    this.mongooseSchema.set('timestamps', true);
    this.mongooseSchema.set('minimize', false);
    this.mongooseSchema.loadClass(this.constructor);
    this.mongooseSchema.statics.getSuper = () => this;
    this.mongooseSchema.methods.getSuper = () => this;
    this.initHooks();
    this.mongooseModel = mongoose.model(
      this.constructor.name,
      this.mongooseSchema,
    );
    if (!mongoose.connection.readyState) {
      this.app.events.on('shutdown', async () => {
        this.logger.verbose(
          'Shutdown was called. Closing all mongoose connections',
        );
        for (const c of mongoose.connections) {
          c.close(true);
        }
        // await mongoose.disconnect(); // TODO it have problems with replica-set
      });
      const connectionParams = {};
      if (process.env.MONGO_APP_NAME) {
        connectionParams.appName = process.env.MONGO_APP_NAME;
      }
      // do not connect on test
      mongoose
        .connect(this.app.getConfig('mongo').connectionString, connectionParams)
        .then(
          () => {
            this.logger.info(
              `Mongo connection success ${connectionParams.appName}`,
            );
            mongoose.connection.on('error', (err) => {
              this.logger.error('Mongo connection error', err);
              console.error(err);
            });

            callback();
          },
          (error) => {
            this.logger.error("Can't install mongodb connection", error);
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
    this.logger.warn('You should provide modelSchema');
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
    this.logger.verbose('Model have no hooks');
  }
}
export default AbstractModel;

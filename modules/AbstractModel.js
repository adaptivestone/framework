const mongoose = require('mongoose');
const Base = require('./Base');

class AbstractModel extends Base {
  /**
   * @param {import('../server')} app  //TODO change to *.d.ts as this is a Server, not app
   * @param function callback optional callback when connection ready
   */
  constructor(app, callback = () => {}) {
    super(app);
    this.mongooseSchema = mongoose.Schema(this.modelSchema);
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
        for (const c of mongoose.connections) {
          c.close(true);
        }
        // await mongoose.disconnect(); // TODO it have problems with replica-set
      });
      // do not connect on test
      mongoose.connect(this.app.getConfig('mongo').connectionString, {}).then(
        () => {
          this.logger.info('Mongo connection success');

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

  static get loggerGroup() {
    return 'model';
  }

  initHooks() {
    this.logger.verbose('Model have no hooks');
  }
}
module.exports = AbstractModel;

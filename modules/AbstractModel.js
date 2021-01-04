const mongoose = require('mongoose');
const Base = require('./Base');

class AbstractModel extends Base {
  /**
   * @param {import('../Server')} app  //TODO change to *.d.ts as this is a Server, not app
   * @param function callback optional callback when connection ready
   */
  constructor(app, callback = () => {}) {
    super(app);
    this.mongooseSchema = mongoose.Schema(this.modelSchema);
    this.mongooseSchema.set('timestamps', true);
    this.mongooseSchema.set('minimize', false);
    this.mongooseSchema.loadClass(this.constructor);
    this.mongooseSchema.statics.getSuper = () => this;
    this.initHooks();
    this.mongooseModel = mongoose.model(
      this.constructor.name,
      this.mongooseSchema,
    );
    if (!mongoose.connection.readyState) {
      // do not connect on test
      mongoose
        .connect(this.app.getConfig('mongo').connectionString, {
          useNewUrlParser: true,
          useCreateIndex: true,
          useUnifiedTopology: true,
          useFindAndModify: false,
        })
        .then(
          () => {
            this.logger.info('Mongo connection success');
            this.app.events.on('die', () => {
              mongoose.disconnect();
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

  static get loggerGroup() {
    return 'model';
  }

  initHooks() {
    this.logger.verbose('Model have no hooks');
  }
}
module.exports = AbstractModel;

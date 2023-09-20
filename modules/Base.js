const { getFilesPathWithInheritance } = require('../helpers/files');

class Base {
  #realLogger = null;

  constructor(app) {
    this.app = app;
  }

  /**
   * In case of logging sometimes we might need to replace name
   */
  getConstructorName() {
    return this.constructor.name;
  }

  /**
   * Optimzation to lazy load logger. It will be inited only on request
   */
  get logger() {
    if (!this.#realLogger) {
      this.#realLogger = this.getLogger(
        this.constructor.loggerGroup + this.getConstructorName(),
      );
    }
    return this.#realLogger;
  }

  /**
   * Get winston loger for given label
   * @param {string} label name of logger
   */
  getLogger(label) {
    return this.app.logger.child({ label });
  }

  async getFilesPathWithInheritance(internalFolder, externalFolder) {
    return getFilesPathWithInheritance({
      internalFolder,
      externalFolder,
      logger: (text) => this.logger.verbose(text),
    });
  }

  /**
   * Return logger group. Just to have all logs groupped logically
   */
  static get loggerGroup() {
    return 'Base_please_overwrite_';
  }
}

module.exports = Base;

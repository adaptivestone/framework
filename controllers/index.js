const Base = require('../modules/Base');

/**
 * Class do autoloading a http comntrollers
 */
class ControllerManager extends Base {
  constructor(app) {
    super(app);
    this.app.controllers = {};
  }

  /**
   * Load controllers
   * @param {object} folderConfig
   * @param {object} folderConfig.folders  server folder config
   * @param {string} folderConfig.controllers  controller folder path
   */
  async initControllers(folderConfig) {
    const controllersToLoad = await this.loadFilesWithInheritance(
      __dirname,
      folderConfig.folders.controllers,
    );

    for (const controller of controllersToLoad) {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const ControllerModule = require(controller);
      const contollerName = ControllerModule.constructor.name.toLowerCase();
      this.app.controllers[contollerName] = new ControllerModule(this.app);
    }
  }

  static get loggerGroup() {
    return 'controller';
  }
}

module.exports = ControllerManager;

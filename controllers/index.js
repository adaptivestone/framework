const fs = require('fs').promises;
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
    let [internalFiles, externalFiles] = await Promise.all([
      fs.readdir(__dirname),
      fs.readdir(folderConfig.folders.controllers),
    ]);

    const filterIndexFile = (controller) => {
      return (
        controller[0] === controller[0].toUpperCase() &&
        controller[0] !== '.' &&
        !controller.includes('.test.js')
      );
    };

    internalFiles = internalFiles.filter(filterIndexFile);
    externalFiles = externalFiles.filter(filterIndexFile);
    const controllersToLoad = [];
    for (const file of internalFiles) {
      if (externalFiles.includes(file)) {
        this.logger.verbose(
          `Skipping register INTERNAL controller ${file} as it override by EXTERNAL ONE`,
        );
      } else {
        controllersToLoad.push(`${__dirname}/${file}`);
      }
    }

    for (const file of externalFiles) {
      controllersToLoad.push(`${folderConfig.folders.controllers}/${file}`);
    }

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

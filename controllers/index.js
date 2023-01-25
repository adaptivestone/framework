const path = require('node:path');
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
   */
  async initControllers() {
    const controllersToLoad = await this.getFilesPathWithInheritance(
      __dirname,
      this.app.foldersConfig.controllers,
    );

    controllersToLoad.sort((a, b) => {
      if (a.file.toLowerCase().endsWith('index.js')) {
        if (b.file.toLowerCase().endsWith('index.js')) {
          return 0;
        }
        return -1;
      }
      return 0;
    });

    for (const controller of controllersToLoad) {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const ControllerModule = require(controller.path);
      const contollerName = ControllerModule.name.toLowerCase();
      let prefix = path.dirname(controller.file);
      if (prefix === '.') {
        prefix = '';
      }
      const controllePath = prefix
        ? `${contollerName}/${contollerName}`
        : contollerName;
      this.app.controllers[controllePath] = new ControllerModule(
        this.app,
        prefix,
      );
    }
  }

  static get loggerGroup() {
    return 'controller';
  }
}

module.exports = ControllerManager;

import path from 'node:path';
import Base from '../modules/Base.js';

/**
 * Class do autoloading a http controllers
 */
class ControllerManager extends Base {
  constructor(app) {
    super(app);
    this.controllers = {};
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
    const controllers = [];
    for (const controller of controllersToLoad) {
      controllers.push(
        import(controller.path).then(({ default: ControllerModule }) => {
          const contollerName = ControllerModule.name.toLowerCase();
          let prefix = path.dirname(controller.file);
          if (prefix === '.') {
            prefix = '';
          }
          const controllePath = prefix
            ? `${prefix}/${contollerName}`
            : contollerName;
          this.controllers[controllePath] = new ControllerModule(
            this.app,
            prefix,
          );
        }),
      );
    }
    await Promise.all(controllers);
  }

  static get loggerGroup() {
    return 'controller';
  }
}

export default ControllerManager;

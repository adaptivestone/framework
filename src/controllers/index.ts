import path from 'node:path';
import * as url from 'node:url';
import type AbstractController from '../modules/AbstractController.ts';
import Base from '../modules/Base.ts';
import type { IApp } from '../server.ts';

/**
 * Class do autoloading a http controllers
 */
class ControllerManager extends Base {
  controllers: Record<string, AbstractController>;
  constructor(app: IApp) {
    super(app);
    this.controllers = {};
  }

  /**
   * Load controllers
   */
  async initControllers() {
    const dirname = url.fileURLToPath(new URL('.', import.meta.url));
    const controllersToLoad = await this.getFilesPathWithInheritance(
      dirname,
      this.app.foldersConfig.controllers,
    );

    controllersToLoad.sort((a, b) => {
      if (
        a.file.toLowerCase().endsWith('index.js') ||
        a.file.toLowerCase().endsWith('index.ts')
      ) {
        if (
          b.file.toLowerCase().endsWith('index.js') ||
          b.file.toLowerCase().endsWith('index.ts')
        ) {
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

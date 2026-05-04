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
   * Register a controller explicitly. Returns the constructed instance.
   * Routes mount on `app.httpServer.express` immediately via the controller's
   * constructor; for late registration (after `startServer` finishes) use
   * `Server.startServer`'s `callbackBefore404` hook.
   */
  registerController<T extends typeof AbstractController>(
    ControllerClass: T,
    prefix = '',
  ): InstanceType<T> {
    const name = ControllerClass.name.toLowerCase();
    const key = prefix ? `${prefix}/${name}` : name;
    const instance = new ControllerClass(this.app, prefix) as InstanceType<T>;
    this.controllers[key] = instance;
    return instance;
  }

  /**
   * Auto-load controllers from the framework's internal folder and the user's
   * external folder, then register each one. User overrides win when filenames
   * collide (handled by `getFilesPathWithInheritance`).
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
          let prefix = path.dirname(controller.file);
          if (prefix === '.') {
            prefix = '';
          }
          this.registerController(ControllerModule, prefix);
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

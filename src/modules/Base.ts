import type winston from 'winston';
import { getFilesPathWithInheritance } from '../helpers/files.ts';
import { consoleLogger, noopLogger } from '../helpers/logger.ts';
import type { IApp } from '../server.ts';

class Base {
  #realLogger: null | winston.Logger = null;

  app: IApp;

  constructor(app: IApp) {
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
  get logger(): winston.Logger {
    let current: winston.Logger | null;
    try {
      current = this.#realLogger;
    } catch {
      // `this` is not a real `Base` instance (private field read threw) — e.g.
      // accessed through a model proxy. Warn (every access, as before) and
      // return the no-op logger so callers never get null.
      console.warn(
        'logger accessed outside a Base instance (e.g. a model proxy); using a no-op logger — logs from this context are dropped. This can be ok for models.',
      );
      return noopLogger;
    }

    if (!current) {
      const { loggerGroup } = this.constructor as typeof Base;
      current = this.getLogger(loggerGroup + this.getConstructorName());
      this.#realLogger = current;
    }
    return current;
  }

  /**
   * Get winston loger for given label
   * @param {string} label name of logger
   */
  getLogger(label: string): winston.Logger {
    return this.app.logger.child({ label });
  }

  async getFilesPathWithInheritance(
    internalFolder: string,
    externalFolder: string,
    isUseSimpleLogger = false, // just to speed up to load logger in some cases
  ) {
    const logger = isUseSimpleLogger
      ? (m: string) => consoleLogger('info', m)
      : (m: string) => this.logger?.verbose(m);
    return getFilesPathWithInheritance({
      internalFolder,
      externalFolder,
      logger,
    });
  }

  /**
   * Return logger group. Just to have all logs groupped logically
   */
  static get loggerGroup() {
    return 'Base_please_overwrite_';
  }
}

export default Base;

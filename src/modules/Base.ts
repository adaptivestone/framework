import { getFilesPathWithInheritance } from '../helpers/files.ts';
import { consoleLogger } from '../helpers/logger.ts';

import type { IApp } from '../server.ts';
import type winston from 'winston';

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
  get logger(): winston.Logger | null {
    let l;
    try {
      l = this.#realLogger;
    } catch {
      console.warn(
        `You try to accees logger not from class. that can be ok in case of models.`,
      );
      return null;
    }

    if (!l) {
      const { loggerGroup } = this.constructor as typeof Base;
      this.#realLogger = this.getLogger(
        loggerGroup + this.getConstructorName(),
      );
    }
    return this.#realLogger;
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

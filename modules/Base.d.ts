import type winston from 'winston';
import type Server from '../server.js';
import type { Dirent } from 'node.fs';

declare class Base {
  app: Server['app'];
  #realLogger: null;

  constructor(app: Server['app']);

  /**
   * In case of logging sometimes we might need to replace name
   */
  getConstructorName(): string;

  /**
   * Optimzation to lazy load logger. It will be inited only on request
   */
  get logger(): winston.Logger;

  /**
   * Get winston loger for given label
   * @param label name of logger
   */
  getLogger(label: string): winston.Logger;

  getFilesPathWithInheritance(
    internalFolder: string,
    externalFolder: string,
  ): Promise<{ path: string; file: string }[]>;

  /**
   * Return logger group. Just to have all logs groupped logically
   */
  static get loggerGroup(): string;
}
export default Base;

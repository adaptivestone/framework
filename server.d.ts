import TFolderConfig from './types/TFoldersConfig';
import { ExpandDeep } from './types/Expand';

import EventEmitter from 'events';

import { Model as MongooseModel, Schema } from 'mongoose';

import BaseCli from './modules/BaseCli';
import Cache from './services/cache/Cache';

type ServerConfig = {
  folders: ExpandDeep<TFolderConfig>;
};

declare class Server {
  config: ServerConfig;
  app: {
    getConfig: Server['getConfig'];
    getModel: Server['getModel'];
    runCliCommand: Server['runCliCommand'];
    updateConfig: Server['updateConfig'];
    foldersConfig: Server['config']['folders'];
    events: EventEmitter;
    get cache(): Server['cacheService'];
    httpServer: null;
    controllerManager: null;
  };
  cacheService: Cache;

  cache: {
    configs: Map<string, {}>;
    models: Map<string, MongooseModel<any>>;
  };
  cli: boolean;

  /**
   *  Construct new server
   */
  constructor(config: ExpandDeep<ServerConfig>);

  /**
   * Start server (http  + init all http ralated functions)
   */
  startServer(callbackBefore404?: Promise<null>): Promise<null>;

  /**
   * Return config from {configName} (file name) on config folder.
   * Support cache and updating confing into cache
   * Also will update config based on NODE_ENV. If config.js and config.production.js
   * and NODE_ENV is production then we will load base config (config.js) and the load
   * environment config (config.production.js) and overwrite base config options
   * @see updateConfig
   * @TODO generate that based on real data
   */
  getConfig(configName: string): {};

  /**
   * Primary designed for tests when we need to update some configs before start testing
   * Should be called before any initialization was done
   */
  updateConfig(configName: string, config: {}): {};

  /**
   * Return model from {modelName} (file name) on model folder.
   * Support cache
   */
  getModel(modelName: string): MongooseModel<any>;

  /**
   * Run cli command into framework (http, ws, etc)
   */
  runCliCommand(commandName: string, args: {}): Promise<BaseCli['run']>;
}

export = Server;

/* eslint-disable no-console */
import EventEmitter from 'node:events';
import { hrtime } from 'node:process';
import * as url from 'node:url';
import path from 'node:path';

import 'dotenv/config';
import merge from 'deepmerge';
import winston from 'winston';
import { getFilesPathWithInheritance } from './helpers/files.js';
import { consoleLogger } from './helpers/logger.js';
import Cache from './services/cache/Cache.js';

/**
 * Main framework class.
 */
class Server {
  #realLogger = null;

  #isInited = false;

  cli = null;

  /**
   *  Construct new server
   * @param {Object} config main config object
   * @param {Object} config.folders folders config
   * @param {String} config.folders.config path to folder with config files
   * @param {String} config.folders.models path to folder with moidels files
   * @param {String} config.folders.controllers path to folder with controllers files
   * @param {String} config.folders.views path to folder with view files
   * @param {String} config.folders.public path to folder with public files
   * @param {String} config.folders.locales path to folder with locales files
   * @param {String} config.folders.emails path to folder with emails files
   */
  constructor(config) {
    this.config = config;
    const that = this;
    this.app = {
      getConfig: this.getConfig.bind(this),
      getModel: this.getModel.bind(this),
      runCliCommand: this.runCliCommand.bind(this),
      updateConfig: this.updateConfig.bind(this),
      foldersConfig: this.config.folders,
      events: new EventEmitter(),
      get cache() {
        return that.getCache();
      },
      get logger() {
        return that.getLogger();
      },
      httpServer: null,
      controllerManager: null,
    };

    this.cache = {
      configs: new Map(),
      models: new Map(),
      modelConstructors: new Map(),
    };
  }

  /**
   * Start server (http  + init all http ralated functions)
   * @param <Promise>callbackBefore404 code that should be executed before adding page 404
   * @returns {Promise}
   */
  async startServer(callbackBefore404 = async () => Promise.resolve()) {
    const [{ default: HttpServer }, { default: ControllerManager }] =
      await Promise.all([
        import('./services/http/HttpServer.js'), // Speed optimisation
        import('./controllers/index.js'), // Speed optimisation
        this.init(),
      ]);

    this.addErrorHandling();

    // TODO config
    this.app.httpServer = new HttpServer(this.app);

    this.app.controllerManager = new ControllerManager(this.app);

    await this.app.controllerManager.initControllers();
    await callbackBefore404();
    this.app.httpServer.add404Page();
  }

  /**
   * Do an initialization (config reading,  etc)
   * @returns {Promise}
   */
  async init({ isSkipModelInit = false } = {}) {
    if (this.#isInited) {
      return true;
    }

    console.time('Server init. Done');
    console.time('Loading config and model files. Time');
    await Promise.all([this.#initConfigFiles(), this.#loadModelFiles()]);
    console.timeEnd('Loading config and model files. Time');

    if (!isSkipModelInit) {
      await this.initAllModels();
    }

    this.#isInited = true;

    console.timeEnd('Server init. Done');

    return true;
  }

  /**
   * Load model and init them
   * @returns {Promise}
   */
  async initAllModels() {
    console.time('Initing models. Time');

    if (this.app.getConfig('mongo').connectionString) {
      for (const [modelName, ModelConstructor] of this.cache
        .modelConstructors) {
        try {
          const model = new ModelConstructor(this.app);
          this.cache.models.set(modelName, model.mongooseModel);
        } catch (e) {
          this.app.logger.error(
            `Problem with model ${modelName}, ${e.message}`,
          );
          this.app.logger.error(e);
        }
      }
    } else {
      this.app.logger.info(
        'Skipping inited models as we have no mongo connection string',
      );
    }

    console.timeEnd('Initing models. Time');
  }

  async #initConfigFiles() {
    const dirname = url.fileURLToPath(new URL('.', import.meta.url));
    const files = await getFilesPathWithInheritance({
      internalFolder: path.join(dirname, '/config'),
      externalFolder: this.app.foldersConfig.config,
      loggerFileType: 'CONFIG',
      logger: (m) => consoleLogger('info', m),
      filter: {
        startWithCapital: false,
      },
    });

    const configFiles = {};

    for (const file of files) {
      const config = file.file.split('.');
      if (!configFiles[config[0]]) {
        configFiles[config[0]] = {};
      }
      if (config.length === 2) {
        configFiles[config[0]].default = file.path;
      } else {
        configFiles[config[0]][config[1]] = file.path;
      }
    }

    const loadConfig = async (configName, values) => {
      const promises = [import(values.default)];
      if (process.env.NODE_ENV && values[process.env.NODE_ENV]) {
        promises.push(import(values[process.env.NODE_ENV]));
      }
      const result = await Promise.all(promises);
      return {
        name: configName,
        finalValue: merge(result[0].default, result[1]?.default || {}, {
          arrayMerge: (destinationArray, sourceArray) => sourceArray,
        }),
      };
    };

    const loadingPromises = [];

    for (const [configFile, value] of Object.entries(configFiles)) {
      loadingPromises.push(loadConfig(configFile, value));
    }

    const configs = await Promise.all(loadingPromises);

    for (const config of configs) {
      this.cache.configs.set(config.name, config.finalValue);
    }
    return true;
  }

  async #loadModelFiles() {
    const dirname = url.fileURLToPath(new URL('.', import.meta.url));
    const files = await getFilesPathWithInheritance({
      internalFolder: path.join(dirname, '/models'),
      externalFolder: this.app.foldersConfig.models,
      loggerFileType: 'MODEL',
      logger: (m) => consoleLogger('info', m),
    });

    const promises = [];
    for (const file of files) {
      const t = hrtime.bigint();
      promises.push(
        import(file.path).then((f) => ({
          name: file.file.split('.')[0],
          file: f,
          took: hrtime.bigint() - t,
        })),
      );
    }

    const loadedModels = await Promise.all(promises);

    for (const model of loadedModels) {
      this.cache.modelConstructors.set(model.name, model.file.default);
    }
    return true;
  }

  /**
   * Add error logging on promise reject
   */
  addErrorHandling() {
    process.on('uncaughtException', (e) =>
      this.app.logger.error('uncaughtException', e),
    );
    process.on('unhandledRejection', (e) => {
      this.app.logger.error('unhandledRejection', e);
    });
  }

  /**
   * Return config from {configName} (file name) on config folder.
   * Support cache and updating confing into cache
   * Also will update config based on NODE_ENV. If config.js and config.production.js
   * and NODE_ENV is production then we will load base config (config.js) and the load
   * environment config (config.production.js) and overwrite base config options
   * @see updateConfig
   * @param {String} configName name on config file to load
   * @returns {Object} config object. Structure depends of config file
   */
  getConfig(configName) {
    if (!this.cache.configs.has(configName)) {
      if (!this.#isInited) {
        throw new Error('You should call Server.init() before using getConfig');
      }
      this.app.logger.warn(
        `You asked for config ${configName} that not exists. Please check you codebase `,
      );
      return {};
    }
    return this.cache.configs.get(configName);
  }

  /**
   * Return or create new logger instance. This is a main logger instance
   */
  getLogger() {
    if (!this.#realLogger) {
      this.#realLogger = this.#createLogger();
    }
    return this.#realLogger;
  }

  #createLogger() {
    const alignColorsAndTime = winston.format.combine(
      winston.format.colorize({
        all: true,
      }),
      winston.format.timestamp(),
      winston.format.printf(
        (info) =>
          `(${process.pid}) \x1B[32m[${info.label ?? 'SERVER'}]\x1B[39m ${
            info.timestamp
          }  ${info.level} : ${info.message} ${info?.stack ?? ''} ${
            info.durationMs ? `Duration: ${info.durationMs}ms` : ''
          }`,
      ),
    );
    const logConfig = this.app.getConfig('log').transports;
    function IsConstructor(f) {
      try {
        Reflect.construct(String, [], f);
      } catch (e) {
        return false;
      }
      return true;
    }

    const logger = winston.createLogger({
      format: winston.format.errors({ stack: true }),
      level: 'silly',
    });

    for (const log of logConfig) {
      if (log.enable) {
        if (log.transport === 'console') {
          logger.add(
            new winston.transports.Console({
              level: log.transportOptions.level,
              format: winston.format.combine(
                winston.format.colorize(),
                alignColorsAndTime,
              ),
            }),
          );
        } else {
          import(log.transport).then((Tr) => {
            let Transport = Tr.default;
            if (!IsConstructor(Transport) && Transport.default) {
              Transport = Transport.default;
            } else {
              console.error(
                `${log.transport} not a constructor. Please check it`,
              );
              return;
            }
            logger.profile(`Adding new logger ${log.transport}`);
            logger.add(new Transport(log.transportOptions));
            logger.profile(`Adding new logger ${log.transport}`);
          });
        }
      }
    }

    return logger;
  }

  /**
   * Primary designed for tests when we need to update some configs before start testing
   * Should be called before any initialization was done
   * @TODO send event to all inited components to update config
   * @param {String} configName
   * @param {Object} config
   */
  updateConfig(configName, config) {
    // const confName = configName.charAt(0).toUpperCase() + configName.slice(1);
    const conf = this.getConfig(configName);
    const newConf = Object.assign(conf, config); // TODO deep clone
    this.cache.configs.set(configName, newConf);
    return newConf;
  }

  /**
   * Return model from {modelName} (file name) on model folder.
   * Support cache
   * @param {String} modelName name on config file to load
   * @returns {import('mongoose').Model | false| {}}
   */
  getModel(modelName) {
    if (modelName.endsWith('s')) {
      this.app.logger.warn(
        `Probably your model name '${modelName}' in plural from. Try to avoid plural form`,
      );
    }
    if (!this.#isInited) {
      this.app.logger.error(
        new Error('You should call Server.init() before using getModel'),
      );
      return false;
    }
    if (!this.cache.models.has(modelName)) {
      this.app.logger.warn(
        `You asked for model ${modelName} that not exists. Please check you codebase `,
      );
      return {};
    }
    return this.cache.models.get(modelName);
  }

  /**
   * Run cli command into framework (http, ws, etc)
   * @param {String} commandName name of command to load
   * @param {Object} args list of arguments to pass into command
   */
  async runCliCommand(commandName, args) {
    if (!this.cli) {
      const { default: BaseCli } = await import('./modules/BaseCli.js'); // Speed optimisation
      this.cli = new BaseCli(this);
    }
    return this.cli.run(commandName, args);
  }

  /**
   * Get internal cache service
   * @returns
   */
  getCache() {
    if (!this.cacheService) {
      this.cacheService = new Cache(this.app);
    }
    return this.cacheService;
  }
}

export default Server;

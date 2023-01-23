const EventEmitter = require('node:events');

/* eslint-disable global-require */
// eslint-disable-next-line jest/require-hook
require('dotenv').config();
const merge = require('deepmerge');

/**
 * Main framework class.
 */
class Server {
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
      httpServer: null,
      controllerManager: null,
    };

    this.cache = {
      configs: new Map(),
      models: new Map(),
    };

    this.cli = false;
  }

  /**
   * Start server (http + websocket + init all http and websocet ralated functions)
   * @param <Promise>callbackBefore404 code that should be executed before adding page 404
   * @returns {Promise}
   */
  async startServer(callbackBefore404 = async () => Promise.resolve()) {
    const HttpServer = require('./services/http/HttpServer'); // Speed optimisation
    const ControllerManager = require('./controllers/index'); // Speed optimisation
    this.addErrorHandling();

    // TODO config
    this.app.httpServer = new HttpServer(this.app, this.config);

    this.app.controllerManager = new ControllerManager(this.app);

    await this.app.controllerManager.initControllers(this.config);
    await callbackBefore404();
    this.app.httpServer.add404Page();
  }

  /**
   * Add error logging on promise reject
   */
  // eslint-disable-next-line class-methods-use-this
  addErrorHandling() {
    process.on('uncaughtException', console.error);
    process.on('unhandledRejection', function (reason, p) {
      console.log(
        'Possibly Unhandled Rejection at: Promise ',
        p,
        ' reason: ',
        reason,
      );
      console.trace('unhandledRejection');
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
    // const configName = name.charAt(0).toUpperCase() + name.slice(1);
    if (!this.cache.configs.has(configName)) {
      let envConfig = {};
      if (process.env.NODE_ENV) {
        envConfig =
          this.getFileWithExtendingInhirence(
            'config',
            `${configName}.${process.env.NODE_ENV}.js`,
          ) || envConfig;
      }
      this.cache.configs.set(
        configName,
        merge(
          this.getFileWithExtendingInhirence('config', configName),
          envConfig,
          { arrayMerge: (destinationArray, sourceArray) => sourceArray },
        ),
      );
    }
    return this.cache.configs.get(configName);
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
   * @returns {import('mongoose').Model}
   */
  getModel(modelName) {
    if (modelName.endsWith('s')) {
      console.warn(
        `Probably your model name '${modelName}' in plural from. Try to avoid plural form`,
      );
    }
    if (!this.cache.models.has(modelName)) {
      const Model = this.getFileWithExtendingInhirence('models', modelName);
      if (!Model) {
        console.error(`Model not found: ${modelName}`);
        return false;
      }
      try {
        const model = new Model(this.app);

        this.cache.models.set(modelName, model.mongooseModel);
      } catch (e) {
        console.error(`Problem with model ${modelName}, ${e.message}`);
        console.error(e);
      }
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
      const BaseCli = require('./modules/BaseCli'); // Speed optimisation
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
      const Cache = require('./services/cache/Cache'); // Speed optimisation
      this.cacheService = new Cache(this.app);
    }
    return this.cacheService;
  }

  /**
   * Get file using Inhirence (ability to overrite models, configs, etc)
   * @param {('models'|'config')} fileType  type of file to load
   * @param {string} fileName  name of file to load
   */
  getFileWithExtendingInhirence(fileType, fileName) {
    let file;
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      file = require(`${this.config.folders[fileType]}/${fileName}`);
    } catch (e) {
      try {
        // eslint-disable-next-line global-require, import/no-dynamic-require
        file = require(`./${fileType}/${fileName}`);
      } catch (e2) {
        const levels = [
          'error',
          'warn',
          'info',
          'http',
          'verbose',
          'debug',
          'silly',
        ];

        if (
          !process.env.LOGGER_CONSOLE_LEVEL ||
          levels.indexOf(process.env.LOGGER_CONSOLE_LEVEL) > 0 // as a warn level
        ) {
          console.warn(
            `Config not found '${fileName}'. This can be a normal (in case this an environment config)`,
          );
        }

        file = false;
      }
    }
    return file;
  }
}

module.exports = Server;

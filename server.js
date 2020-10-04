require('dotenv').config();
const merge = require('deepmerge');

const HttpServer = require('./services/http/HttpServer');
const WebSocket = require('./services/connectors/socket');
const ControllerManager = require('./controllers/index');

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
    this.app = {
      getConfig: this.getConfig.bind(this),
      getModel: this.getModel.bind(this),
      updateConfig: this.updateConfig.bind(this),
      foldersConfig: this.config.folders,
    };

    this.cache = {
      configs: new Map(),
      models: new Map(),
    };
  }

  /**
   * Start server (http + websocket + init all http and websocet ralated functions)
   * @param <Promise>callbackBefore404 code that should be executed before adding page 404
   * @returns {Promise}
   */
  async startServer(callbackBefore404 = async () => Promise.resolve()) {
    this.addErrorHandling();

    // TODO config
    this.app.httpServer = new HttpServer(this.app, this.config);

    // TODO config
    this.app.webSocket = new WebSocket(this.app);

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
    process.on('uncaughtException', console.log);
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
    const conf = this.getConfig(configName);
    const newConf = Object.assign(conf, config);
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
    if (!this.cache.models.has(modelName)) {
      const Model = this.getFileWithExtendingInhirence('models', modelName);
      this.cache.models.set(modelName, new Model(this.app).mongooseModel);
    }
    return this.cache.models.get(modelName);
  }

  /**
   * Get file using Inhirence (ability to overrite models, configs, etc)
   * @param {('models'|'config')} fileType  type of file to load
   * @param {string} fileName  name of file to load
   */
  getFileWithExtendingInhirence(fileType, fileName) {
    let file;
    try {
      file = require(this.config.folders[fileType] + '/' + fileName);
    } catch (e) {
      try {
        file = require(`./${fileType}/${fileName}`);
      } catch (e2) {
        console.warn(
          `Config not found '${fileName}'. This can be a normal (in case this an environment config)`,
        );
        file = false;
      }
    }
    return file;
  }
}

module.exports = Server;

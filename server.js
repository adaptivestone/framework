require('dotenv').config();
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
   * @returns {Promise}
   */
  async startServer() {
    this.addErrorHandling();

    // TODO config
    this.app.httpServer = new HttpServer(this.app, this.config);

    // TODO config
    this.app.webSocket = new WebSocket(this.app);

    this.app.controllerManager = new ControllerManager(this.app);

    await this.app.controllerManager.initControllers(this.config);
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
   * @see updateConfig
   * @param {String} configName name on config file to load
   * @returns {Object} config object. Structure depends of config file
   */
  getConfig(configName) {
    if (!this.cache.configs.has(configName)) {
      this.cache.configs.set(
        configName,
        this.getFileWithExtendingInhirence('config', configName),
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
      file = require(`./${fileType}/${fileName}`);
    }
    return file;
  }
}

module.exports = Server;

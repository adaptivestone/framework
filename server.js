"use strict";
require("dotenv").config();
const HttpServer = require("./services/http/HttpServer");
const WebSocket = require("./services/connectors/socket");
const ControllerManager = require("./controllers/index");


class Server {
  constructor(config) {
    this.config = config;
    this.app = {
      getConfig: this.getConfig.bind(this),
      getModel: this.getModel.bind(this),
      updateConfig: this.updateConfig.bind(this),
      folderConfig: this.config.folderConfig
    };

    this.cache = {
        configs: new Map(),
        models: new Map()
    }
  }

  async startServer(){
    this.addErrorHandling();

    //TODO config 
    this.app.httpServer = new HttpServer(this.app, this.config) ;

    //TODO config
    this.app.webSocket = new WebSocket(this.app);

    this.app.controllerManager = new ControllerManager(this.app);

    await this.app.controllerManager.initControllers(this.config);
    this.app.httpServer.add404Page();
  }

  addErrorHandling(){
    process.on("uncaughtException", console.log);
    process.on("unhandledRejection", function(reason, p) {
      console.log(
        "Possibly Unhandled Rejection at: Promise ",
        p,
        " reason: ",
        reason
      );
      console.trace("unhandledRejection");
    });
  }

  getConfig(configName) {
    if (!this.cache.configs.has(configName)){
        this.cache.configs.set(configName, this.getFileWithExtendingInhirence("config",configName));
    }
    return  this.cache.configs.get(configName);
  }

  /**
   * Primary designed for tests when we need to update some configs before start testing
   * Should be called before any initialization was done
   * @TODO send event to all inited components to update config
   * @param {String} configName 
   * @param {Object} config 
   */
  updateConfig(configName, config){
    const conf = this.getConfig(configName);
    const newConf = Object.assign(conf, config);
    this.cache.configs.set(configName,newConf);
    return newConf;
  }

  getModel(modelName){
    if (!this.cache.models.has(modelName)){
        let model = this.getFileWithExtendingInhirence("models",modelName);
        this.cache.models.set(modelName, new model(this.app).mongooseModel);
    }
    return  this.cache.models.get(modelName); 
  }

  getFileWithExtendingInhirence(fileType, fileName){
    let file;
    try {
      file = require(this.config.folders[fileType] +"/"+ fileName);
    } catch (e) {
      file = require(`./${fileType}/${fileName}`);
    }
    return file;
  }
}

module.exports = Server;
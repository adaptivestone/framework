const fs = require("fs").promises;
const Base = require("../modules/Base");

class ControllerManager extends Base {
  constructor(app) {
    super(app);
    this.app.controllers = {};
  }

  async initControllers(folderConfig) {
    let [internalFiles, externalFiles] = await Promise.all([
      fs.readdir(__dirname),
      fs.readdir(folderConfig.folders.controllers)
    ]);
    
    let filterIndexFile = (controller) => {
       return (controller[0] === controller[0].toUpperCase()) &&
        (controller[0] !== ".") && 
        (!controller.includes(".test.js"));
    }

    internalFiles = internalFiles.filter(filterIndexFile);
    externalFiles = externalFiles.filter(filterIndexFile);
    for (let file of internalFiles) {
      if (externalFiles.includes(file)) {
        this.logger.verbose(
          `Skipping register INTERNAL controller ${file} as it override by EXTERNAL ONE`
        );
        continue;
      }
      let controllerModule = require(__dirname + "/" + file);
      new controllerModule(this.app);
    }

    for (let file of externalFiles) {
      let controllerModule = require(folderConfig.folders.controllers +
        "/" +
        file);
      new controllerModule(this.app);
    }
  }

  static get loggerGroup(){
    return 'controller'
}
}

module.exports = ControllerManager;
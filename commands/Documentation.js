const AbstractCommand = require('../modules/AbstractCommand');
const ControllerManager = require('../controllers/index');

class Documentation extends AbstractCommand {
  async run() {
    const CM = new ControllerManager(this.app);
    this.app.documentation = [];
    await CM.initControllers({ folders: this.app.foldersConfig });
    console.log(JSON.stringify(this.app.documentation));
    return JSON.stringify(this.app.documentation);
  }
}

module.exports = Documentation;

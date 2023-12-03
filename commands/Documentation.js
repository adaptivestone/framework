import AbstractCommand from '../modules/AbstractCommand.js';
import ControllerManager from '../controllers/index.js';

class Documentation extends AbstractCommand {
  async run() {
    const CM = new ControllerManager(this.app);
    this.app.documentation = [];
    await CM.initControllers();
    return this.app.documentation;
  }
}

export default Documentation;

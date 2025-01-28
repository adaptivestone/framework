import path from 'node:path';
import * as url from 'node:url';
import AbstractCommand from '../modules/AbstractCommand.js';

class SyncIndexes extends AbstractCommand {
  async run() {
    const dirname = url.fileURLToPath(new URL('.', import.meta.url));
    const files = await this.getFilesPathWithInheritance(
      path.join(dirname, '/../models'),
      this.app.foldersConfig.models,
    );
    let models = [];

    for (const file of files) {
      models.push(path.basename(file.file, path.extname(file.file)));
    }
    models = models.sort();
    this.logger.info(`Total found ${models.length} models`);

    for (const modelName of models) {
      const Model = this.app.getModel(modelName);
      // eslint-disable-next-line no-await-in-loop
      const removedIndexes = await Model.syncIndexes(); // await in loop not a bug. Lets do one by one
      if (removedIndexes.length) {
        this.logger.info(
          `Model - ${modelName} removed indexes: ${removedIndexes}`,
        );
      } else {
        this.logger.info(`Model - ${modelName} NO removed indexes`);
      }
    }
    return true;
  }

  static get description() {
    return 'Synchronize indexes defined in models with a real one indexed on the database.  Command will remove all indexes from the database that do not exist on model OR have different parameters. Then it will create a new indexes   ';
  }
}

export default SyncIndexes;

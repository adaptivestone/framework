import AbstractCommand from '../modules/AbstractCommand.ts';

class SyncIndexes extends AbstractCommand {
  async run() {
    const models = this.app.internalFilesCache.models;
    const modelEntries = Array.from(models).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    this.logger?.info(`Total found ${modelEntries.length} models`);

    for (const [modelName, Model] of modelEntries) {
      const removedIndexes = await Model.syncIndexes(); // await in loop not a bug. Lets do one by one
      if (removedIndexes.length) {
        this.logger?.info(
          `Model - ${modelName} removed indexes: ${removedIndexes}`,
        );
      } else {
        this.logger?.info(`Model - ${modelName} NO removed indexes`);
      }
    }
    return true;
  }

  static get description() {
    return 'Synchronize indexes defined in models with a real one indexed on the database.  Command will remove all indexes from the database that do not exist on model OR have different parameters. Then it will create a new indexes   ';
  }
}

export default SyncIndexes;

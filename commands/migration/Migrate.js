import AbstractCommand from '../../modules/AbstractCommand.js';

class Migrate extends AbstractCommand {
  static get description() {
    return 'Run all pending migrations';
  }

  async run() {
    const files = await this.getFilesPathWithInheritance(
      `${__dirname}/../../migrations`,
      this.app.foldersConfig.migrations,
    );
    files.sort(
      (a, b) => Number(a.file.split('_')[0]) - Number(b.file.split('_')[0]),
    );
    const MigrationModel = this.app.getModel('Migration');
    const lastMigration = await MigrationModel.findOne({})
      .sort({ createdAt: -1 })
      .exec();

    let migrations = files;

    if (lastMigration) {
      const lastMigrationTime = Number(
        lastMigration.migrationFile.split('_')[0],
      );
      migrations = files.filter(
        (val) => Number(val.file.split('_')[0]) > lastMigrationTime,
      );
    }

    for (const migration of migrations) {
      this.logger.info(`=== Start migration ${migration.file} ===`);
      // eslint-disable-next-line no-await-in-loop
      const MigrationCommand = await import(migration.path);
      const migrationCommand = new MigrationCommand(this.app);
      // eslint-disable-next-line no-await-in-loop
      await migrationCommand.up();
      // eslint-disable-next-line no-await-in-loop
      await MigrationModel.create({
        migrationFile: migration.file,
      });
    }

    this.logger.info(
      `=== Migration Finished. Migrated ${migrations.length} files ===`,
    );
  }
}

export default Migrate;

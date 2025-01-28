import path from 'node:path';
import { promises as fs } from 'node:fs';
import AbstractCommand from '../../modules/AbstractCommand.js';

class CreateMigration extends AbstractCommand {
  static get description() {
    return 'Create new migration';
  }

  async run() {
    if (!this.args.name) {
      this.logger.error(
        'Please provide migration name with key "--name={someName}"',
      );
      return false;
    }
    if (this.args.name.match(/^\d/)) {
      this.logger.error('Command cant start from nubmer');
      return true;
    }
    const fileName = `${Date.now()}_${CreateMigration.camelSentence(
      this.args.name,
    )}.js`;

    const fileContent = CreateMigration.getTemplate(
      CreateMigration.camelSentence(this.args.name),
    );

    await fs.writeFile(
      path.join(this.app.foldersConfig.migrations, fileName),
      fileContent,
    );
    this.logger.info(`Migration created ${fileName}`);
    return true;
  }

  static camelSentence(str) {
    return ` ${str}`
      .toLowerCase()
      .replace(/[^a-zA-Z0-9]+(.)/g, (match, chr) => chr.toUpperCase());
  }

  static getTemplate(name) {
    return `/* eslint-disable class-methods-use-this */

import Base from '@adaptivestone/framework/modules/Base.js';

class ${name} extends Base {
  async up() {
    // put here your mirgation up logic
    // const YourModel = this.app.getModel('ModelName');
  }

  async down() {
    // put here your mirgation down logic
  }
}

export default ${name};
`;
  }
}

export default CreateMigration;

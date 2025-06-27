import { promises as fs } from 'node:fs';
import path from 'node:path';
import AbstractCommand from '../../modules/AbstractCommand.ts';

class CreateMigration extends AbstractCommand {
  static get description() {
    return 'Create new migration';
  }

  /**
   * You able to add command arguments for parsing there.
   */
  static get commandArguments() {
    return {
      name: {
        type: 'string' as const,
        description: 'Migration name',
        required: true,
      },
    };
  }

  async run() {
    const { name } = this.args as { name: string };
    if (name.match(/^\d/)) {
      this.logger?.error('Command cant start from nubmer');
      return false;
    }
    const fileName = `${Date.now()}_${CreateMigration.camelSentence(name)}.ts`;

    const fileContent = CreateMigration.getTemplate(
      CreateMigration.camelSentence(name),
    );

    await fs.writeFile(
      path.join(this.app.foldersConfig.migrations, fileName),
      fileContent,
    );
    this.logger?.info(`Migration created ${fileName}`);
    return true;
  }

  static camelSentence(str: string) {
    return ` ${str}`
      .toLowerCase()
      .replace(/[^a-zA-Z0-9]+(.)/g, (match, chr) => chr.toUpperCase());
  }

  static getTemplate(name: string) {
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

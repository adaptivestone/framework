/* eslint-disable no-underscore-dangle */
const path = require('path');
const fs = require('fs').promises;

const AbstractCommand = require('../../modules/AbstractCommand');

class CreateMigration extends AbstractCommand {
  static get description() {
    return 'Create new migration';
  }

  async run() {
    if (!this.args.name) {
      return this.logger.error(
        'Please provide migration name with key "--name={someName}"',
      );
    }
    if (this.args.name.match(/^\d/)) {
      return this.logger.error('Command cant start from nubmer');
    }
    const fileName = `${Date.now()}_${this.constructor.camelSentence(
      this.args.name,
    )}.js`;

    const fileContent = this.constructor.getTemplate(
      this.constructor.camelSentence(this.args.name),
    );

    await fs.writeFile(
      path.join(this.app.foldersConfig.migrations, fileName),
      fileContent,
    );
    return this.logger.info(`Migration created ${fileName}`);
  }

  // eslint-disable-next-line class-methods-use-this
  static camelSentence(str) {
    return ` ${str}`
      .toLowerCase()
      .replace(/[^a-zA-Z0-9]+(.)/g, (match, chr) => chr.toUpperCase());
  }

  static getTemplate(name) {
    return `/* eslint-disable class-methods-use-this */

const Base = require('@adaptivestone/framework/modules/Base');

class ${name} extends Base {
  async up() {
    // put here your mirgation up logic
    // const YourModel = this.app.getModel('ModelName');
  }

  async down() {
    // put here your mirgation down logic
  }
}

module.exports = ${name};
`;
  }
}

module.exports = CreateMigration;

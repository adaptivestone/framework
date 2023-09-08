/* eslint-disable no-console */
const path = require('node:path');
const Base = require('./Base');

class Cli extends Base {
  constructor(server) {
    super(server.app);
    this.server = server;
    this.commands = {};
  }

  async loadCommands() {
    if (Object.keys(this.commands).length) {
      return true;
    }
    const commandsToLoad = await this.getFilesPathWithInheritance(
      path.join(__dirname, '/../commands'),
      this.server.app.foldersConfig.commands,
    );
    for (const com of commandsToLoad) {
      if (com.file.endsWith('.js')) {
        const c = com.file.replace('.js', '');

        this.commands[c.toLowerCase()] = com.path;
      }
    }
    return true;
  }

  async run(command, args) {
    await this.loadCommands();

    if (!command) {
      console.log('Please provide command name');
      console.log(
        'Availalble commands:',
        Object.keys(this.commands).join(', '),
      );
      return false;
    }

    if (!this.commands[command]) {
      console.log(`Command ${command} not found `);
      console.log(
        'Availalble commands:',
        Object.keys(this.commands).join(', '),
      );
      return false;
    }
    // TODO wait until https://github.com/nodejs/node/issues/35889
    const { default: Command } = await import(this.commands[command]);

    // const Command = require(this.commands[command]);

    const c = new Command(this.app, this.commands, args);
    let result = false;

    result = await c.run().catch((e) => {
      this.logger.error(e.stack);
    });

    return result;
  }

  static get loggerGroup() {
    return 'CLI_';
  }
}

module.exports = Cli;

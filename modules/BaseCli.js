/* eslint-disable no-console */
import path from 'node:path';
import * as url from 'node:url';
import Base from './Base.js';

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
    const dirname = url.fileURLToPath(new URL('.', import.meta.url));
    const commandsToLoad = await this.getFilesPathWithInheritance(
      path.join(dirname, '../commands'),
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
    const { default: Command } = await import(this.commands[command]);

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

export default Cli;

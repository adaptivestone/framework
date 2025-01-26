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

  async printCommandTable() {
    const commands = Object.keys(this.commands).sort();
    const maxLength = commands.reduce((max, c) => Math.max(max, c.length), 0);
    console.log('Available commands:');
    let commandsClasses = [];
    for (const c of commands) {
      // eslint-disable-next-line no-await-in-loop
      commandsClasses.push(import(this.commands[c]));
      // console.log(
      //   ` \x1b[36m${c.padEnd(maxLength)}\x1b[0m - ${f.default.description}`,
      // );
    }
    commandsClasses = await Promise.all(commandsClasses);
    for (const [key, c] of Object.entries(commands)) {
      // eslint-disable-next-line no-await-in-loop
      console.log(
        ` \x1b[36m${c.padEnd(maxLength)}\x1b[0m - ${commandsClasses[key].default.description}`,
      );
    }
  }

  async run(command, args) {
    await this.loadCommands();

    if (!command) {
      console.log('Please provide command name');
      await this.printCommandTable();
      return false;
    }

    if (!this.commands[command]) {
      console.log(`Command ${command} not found `);
      await this.printCommandTable();
      return false;
    }
    const { default: Command } = await import(this.commands[command]);

    if (Command.isShouldInitModels) {
      this.logger.debug(
        `Command ${command} isShouldInitModels called. If you want to skip loading and init models, please set isShouldInitModels to false in tyou command`,
      );
      await this.server.initAllModels();
    } else {
      this.logger.debug(`Command ${command} NOT need to isShouldInitModels`);
    }

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

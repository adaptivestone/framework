const parseArgs = require('minimist');
const Base = require('./modules/Base');
const Server = require('./server');

class Cli extends Base {
  constructor(serverConfig) {
    const server = new Server(serverConfig);
    super(server.app);
    this.server = server;
    this.commands = {};
    this.args = parseArgs(process.argv.slice(3));
  }

  async loadCommands() {
    if (Object.keys(this.commands).length) {
      return true;
    }
    const commandsToLoad = await this.getFilesPathWithInheritance(
      `${__dirname}/commands`,
      this.server.app.foldersConfig.commands,
    );
    for (const com of commandsToLoad) {
      const c = com.file.replace('.js', '');

      this.commands[c.toLowerCase()] = com.path;
    }
    return true;
  }

  async run() {
    await this.loadCommands();

    const command = process.argv[2]?.toLowerCase();

    if (!command) {
      console.log('Please provide command name');
      console.log(
        'Availalble commands:',
        Object.keys(this.commands).join(', '),
      );
      return;
    }

    if (!this.commands[command]) {
      console.log(`Command ${command} not found `);
      console.log(
        'Availalble commands:',
        Object.keys(this.commands).join(', '),
      );
      return;
    }

    // eslint-disable-next-line global-require, import/no-dynamic-require
    const Command = require(this.commands[command]);
    const c = new Command(this.app, this.commands, this.args);

    try {
      await c.run();
    } catch (e) {
      this.logger.error(e.stack);
    }
    this.app.events.emit('die');
  }

  static get loggerGroup() {
    return 'CLI_';
  }
}

module.exports = Cli;

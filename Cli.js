const parseArgs = require('minimist');
const Base = require('./modules/Base');
const Server = require('./server');

class Cli extends Base {
  constructor(serverConfig) {
    const server = new Server(serverConfig);
    super(server.app);
    this.server = server;
    this.commands = {};
    this.args = parseArgs(process.argv.slice(2));
  }

  async run() {
    const commandsToLoad = await this.getFilesPathWithInheritance(
      `${__dirname}/commands`,
      this.server.app.foldersConfig.commands,
    );

    const command = process.argv[2]?.toLowerCase();

    for (const com of commandsToLoad) {
      const c = com.file.replace('.js', '');

      this.commands[c.toLowerCase()] = com.path;
    }
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

    await c.run();
    this.app.events.emit('die');
  }

  static get loggerGroup() {
    return 'CLI_';
  }
}

module.exports = Cli;

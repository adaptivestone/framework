const mongoose = require('mongoose');
const Base = require('./modules/Base');
const Server = require('./server');

class Cli extends Base {
  constructor(serverConfig) {
    const server = new Server(serverConfig);
    super(server.app);
    this.server = server;
    this.commands = {};
  }

  async run() {
    const commandsToLoad = await this.getFilesPathWithInheritance(
      `${__dirname}/commands`,
      this.server.app.foldersConfig.commands,
    );

    const command = process.argv[2]?.toLowerCase();

    for (const command of commandsToLoad) {
      const c = command.file.replace('.js', '');

      this.commands[c.toLowerCase()] = command.path;
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

    const Command = require(this.commands[command]);
    const c = new Command(this.app, this.commands);

    await c.run();
    await mongoose.disconnect();
  }

  static get loggerGroup() {
    return 'CLI_';
  }
}

module.exports = Cli;

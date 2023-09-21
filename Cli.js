const parseArgs = require('minimist');
const mongoose = require('mongoose');
const BaseCli = require('./modules/BaseCli');
const Server = require('./server');

class Cli extends BaseCli {
  constructor(serverConfig) {
    mongoose.set('autoIndex', false); // we do not need create indexes on CLI.
    const server = new Server(serverConfig);
    super(server);
    this.args = parseArgs(process.argv.slice(3));
  }

  async run() {
    await this.server.init();
    const command = process.argv[2]?.toLowerCase();
    await super.run(command, this.args);
    this.app.events.emit('shutdown');
  }
}

module.exports = Cli;

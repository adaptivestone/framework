import parseArgs from 'minimist';
import mongoose from 'mongoose';
import BaseCli from './modules/BaseCli.js';
import Server from './server.js';

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

export default Cli;

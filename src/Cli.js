import mongoose from 'mongoose';
import BaseCli from './modules/BaseCli.js';
import Server from './server.js';

class Cli extends BaseCli {
  constructor(serverConfig) {
    mongoose.set('autoIndex', false); // we do not need create indexes on CLI.
    const server = new Server(serverConfig);
    super(server);
  }

  async run() {
    await this.server.init({ isSkipModelInit: true, isSkipModelLoading: true });
    const command = process.argv[2]?.toLowerCase();
    await super.run(command);
    this.app.events.emit('shutdown');
    return true;
  }
}

export default Cli;

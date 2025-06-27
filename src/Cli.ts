import mongoose from 'mongoose';
import type { TFolderConfig } from './folderConfig.ts';
import BaseCli from './modules/BaseCli.ts';
import Server from './server.ts';

class Cli extends BaseCli {
  constructor(serverConfig: TFolderConfig) {
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

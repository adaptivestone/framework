import { randomBytes } from 'node:crypto';
import AbstractCommand from '../modules/AbstractCommand.ts';

class GenerateRandomBytes extends AbstractCommand {
  static get description() {
    return 'Generate random bytes ising randomBytes from  node:crypto';
  }

  static isShouldInitModels = false;

  async run() {
    const sizes = [16, 32, 64, 128, 256];
    for (const size of sizes) {
      const bytes = randomBytes(size).toString('hex');
      this.logger?.info(`${size} bytes: ${bytes}`);
    }
    return true;
  }
}

export default GenerateRandomBytes;

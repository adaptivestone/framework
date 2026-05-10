import { generateAll } from '../codegen/index.ts';
import AbstractCommand from '../modules/AbstractCommand.ts';

class GenerateTypes extends AbstractCommand {
  static get description(): string {
    return 'Generates TypeScript types (app-level + per-controller routes)';
  }

  static isShouldInitModels = false;

  async run(): Promise<boolean> {
    await generateAll(this.app, this.logger);
    return true;
  }
}

export default GenerateTypes;

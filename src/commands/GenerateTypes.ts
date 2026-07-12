import { generateAll } from '../codegen/index.ts';
import AbstractCommand from '../modules/AbstractCommand.ts';

class GenerateTypes extends AbstractCommand {
  static get description(): string {
    return 'Generates TypeScript types (app-level + per-controller routes)';
  }

  static isShouldInitModels = false;

  static get commandArguments() {
    return {
      check: {
        type: 'boolean' as const,
        description:
          'Verify generated files are up to date without writing; exit non-zero on any difference (CI drift guard)',
      },
    };
  }

  async run(): Promise<boolean> {
    const check = !!this.args.check;
    try {
      await generateAll(this.app, this.logger, { check });
    } catch (e) {
      if (check) {
        // CI drift guard: report just the mismatch (not a full stack) and fail
        // the command — a `false` result makes the CLI exit non-zero.
        this.logger?.error((e as Error).message);
        return false;
      }
      throw e;
    }
    return true;
  }
}

export default GenerateTypes;

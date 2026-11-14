import AbstractCommand from '../../../modules/AbstractCommand.ts';

/** Fixture that exercises the model-aware CLI lifecycle without querying Mongo. */
class ModelCommand extends AbstractCommand {
  static get commandArguments() {
    return {
      password: {
        type: 'string' as const,
        description: 'Fixture-only secret argument',
        sensitive: true,
      },
      label: {
        type: 'string' as const,
        description: 'Fixture-only diagnostic argument',
      },
      token: {
        type: 'boolean' as const,
        description: 'Fixture-only diagnostic flag',
      },
    };
  }

  static get description(): string {
    return 'Fixture command that requires initialized models';
  }

  async run(): Promise<boolean> {
    return true;
  }
}

export default ModelCommand;

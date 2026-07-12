import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import Transport from 'winston-transport';
import { serverInstance } from '../tests/testHelpers.ts';
import BaseCli from './BaseCli.ts';

const commandPath = (name: string) =>
  fileURLToPath(
    new URL(`../tests/fixtures/commands/${name}.ts`, import.meta.url),
  );

// Collects log entries so the throw path can be shown to still log the stack.
class CaptureTransport extends Transport {
  sink: string[];
  constructor(sink: string[]) {
    super({ level: 'silly' });
    this.sink = sink;
  }
  log(info: unknown, callback: () => void) {
    this.sink.push(JSON.stringify(info));
    callback();
  }
}

/**
 * A failed command must surface as a `false` result so the CLI entry can exit
 * non-zero — a throwing `run()` becomes one more `false` path, alongside the
 * not-found / bad-argument ones.
 */
describe('BaseCli.run — a thrown command resolves false', () => {
  const originalArgv = process.argv;
  afterEach(() => {
    process.argv = originalArgv;
  });

  // Pre-seed the command map (so `loadCommands` short-circuits) and pin argv
  // (so `parseArgs` sees no stray runner flags), then run one command.
  const run = (command: string) => {
    const cli = new BaseCli(serverInstance);
    cli.commands = {
      throwcmd: commandPath('ThrowingCommand'),
      okcmd: commandPath('OkCommand'),
    };
    process.argv = ['node', 'cli.ts', command];
    return cli.run(command);
  };

  it('resolves false, and still logs the stack, when run() rejects', async () => {
    const captured: string[] = [];
    const transport = new CaptureTransport(captured);
    serverInstance.app.logger.add(transport);
    try {
      await expect(run('throwcmd')).resolves.toBe(false);
    } finally {
      serverInstance.app.logger.remove(transport);
    }
    expect(captured.join('\n')).toContain('boom from fixture command');
  });

  it('resolves true when run() succeeds', async () => {
    await expect(run('okcmd')).resolves.toBe(true);
  });
});

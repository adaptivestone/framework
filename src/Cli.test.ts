import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import Cli from './Cli.ts';

const commandPath = (name: string) =>
  fileURLToPath(
    new URL(`./tests/fixtures/commands/${name}.ts`, import.meta.url),
  );

/**
 * `Cli.run` must return the actual command result (not a hardcoded `true`) so a
 * failure propagates to the process exit code. Exercised against a controlled
 * context: a stub `server.init` and a throwaway event emitter keep the real
 * `shutdown` emit from tearing down the shared test server, while `super.run`
 * still runs the real fixture command end to end.
 */
describe('Cli.run — returns the command result', () => {
  const originalArgv = process.argv;
  afterEach(() => {
    process.argv = originalArgv;
  });

  const run = (command: string) => {
    const ctx = {
      server: { init: async () => true },
      app: { events: new EventEmitter() },
      loadCommands: async () => true,
      commands: {
        throwcmd: commandPath('ThrowingCommand'),
        okcmd: commandPath('OkCommand'),
      },
    };
    process.argv = ['node', 'cli.ts', command];
    return Cli.prototype.run.call(ctx as unknown as Cli);
  };

  it('resolves false when the command run() rejects', async () => {
    await expect(run('throwcmd')).resolves.toBe(false);
  });

  it('resolves true when the command run() succeeds', async () => {
    await expect(run('okcmd')).resolves.toBe(true);
  });
});

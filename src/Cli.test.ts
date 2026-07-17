import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Cli from './Cli.ts';
import folderConfig from './folderConfig.ts';
import {
  appInstance,
  resetAppInstance,
  setAppInstance,
} from './helpers/appInstance.ts';
import Server from './server.ts';
import {
  receivedArgs,
  resetArgsCommand,
  runCount,
} from './tests/fixtures/commands/ArgsCommand.ts';

const commandPath = (name: string) =>
  fileURLToPath(
    new URL(`./tests/fixtures/commands/${name}.ts`, import.meta.url),
  );

describe('Cli construction', () => {
  it('creates its server and disables automatic index creation', () => {
    const originalApp = appInstance;
    const originalAutoIndex = mongoose.get('autoIndex');
    resetAppInstance();
    try {
      const cli = new Cli(folderConfig);
      expect(cli.server).toBeInstanceOf(Server);
      expect(mongoose.get('autoIndex')).toBe(false);
    } finally {
      mongoose.set('autoIndex', originalAutoIndex);
      resetAppInstance();
      setAppInstance(originalApp);
    }
  });
});

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

describe('Cli.run — argument validation', () => {
  const originalArgv = process.argv;

  afterEach(() => {
    process.argv = originalArgv;
    resetArgsCommand();
    vi.restoreAllMocks();
  });

  const run = (args: string[]) => {
    const ctx = {
      server: { init: async () => true },
      app: { events: new EventEmitter() },
      loadCommands: async () => true,
      commands: {
        argscmd: commandPath('ArgsCommand'),
      },
    };
    process.argv = ['node', 'cli.ts', 'argscmd', ...args];
    return Cli.prototype.run.call(ctx as unknown as Cli);
  };

  it('shows help without executing the command', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(run(['--help'])).resolves.toBe(true);

    expect(runCount).toBe(0);
    expect(log.mock.calls.flat().join('\n')).toContain('Name to process');
  });

  it('rejects an unknown option without executing the command', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(run(['--unknown'])).resolves.toBe(false);

    expect(runCount).toBe(0);
    expect(log.mock.calls.flat().join('\n')).toContain('Unknown option');
  });

  it('rejects a missing required option without executing the command', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(run([])).resolves.toBe(false);

    expect(runCount).toBe(0);
    expect(log.mock.calls.flat().join('\n')).toContain(
      'Please provide "name" argument',
    );
  });

  it('accepts an explicitly empty required string', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(run(['--name='])).resolves.toBe(true);

    expect(runCount).toBe(1);
    expect(receivedArgs).toMatchObject({ name: '', mode: 'safe' });
  });
});

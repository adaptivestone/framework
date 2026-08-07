import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { afterEach, describe, it, mock } from 'node:test';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import Cli from './Cli.ts';
import folderConfig from './folderConfig.ts';
import {
  appInstance,
  resetAppInstance,
  setAppInstance,
} from './helpers/appInstance.ts';
import Server from './server.ts';
import { assertMatchObject } from './tests/assertions.ts';
import {
  receivedArgs,
  resetArgsCommand,
  runCount,
} from './tests/fixtures/commands/ArgsCommand.ts';
import { mockImplementation } from './tests/mocks.ts';

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
      assert.ok(cli.server instanceof Server);
      assert.strictEqual(mongoose.get('autoIndex'), false);
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
    await assert.strictEqual(await run('throwcmd'), false);
  });

  it('resolves true when the command run() succeeds', async () => {
    await assert.strictEqual(await run('okcmd'), true);
  });
});

describe('Cli.run — argument validation', () => {
  const originalArgv = process.argv;

  afterEach(() => {
    process.argv = originalArgv;
    resetArgsCommand();
    mock.restoreAll();
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
    const log = mockImplementation(mock.method(console, 'log'), () => {});

    await assert.strictEqual(await run(['--help']), true);

    assert.strictEqual(runCount, 0);
    assert.ok(
      log.mock.calls
        .flatMap((call) => call.arguments)
        .join('\n')
        .includes('Name to process'),
    );
  });

  it('rejects an unknown option without executing the command', async () => {
    const log = mockImplementation(mock.method(console, 'log'), () => {});

    await assert.strictEqual(await run(['--unknown']), false);

    assert.strictEqual(runCount, 0);
    assert.ok(
      log.mock.calls
        .flatMap((call) => call.arguments)
        .join('\n')
        .includes('Unknown option'),
    );
  });

  it('rejects a missing required option without executing the command', async () => {
    const log = mockImplementation(mock.method(console, 'log'), () => {});

    await assert.strictEqual(await run([]), false);

    assert.strictEqual(runCount, 0);
    assert.ok(
      log.mock.calls
        .flatMap((call) => call.arguments)
        .join('\n')
        .includes('Please provide "name" argument'),
    );
  });

  it('accepts an explicitly empty required string', async () => {
    mockImplementation(mock.method(console, 'log'), () => {});

    await assert.strictEqual(await run(['--name=']), true);

    assert.strictEqual(runCount, 1);
    assertMatchObject(receivedArgs, { name: '', mode: 'safe' });
  });
});

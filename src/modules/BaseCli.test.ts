import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { fileURLToPath } from 'node:url';
import Transport from 'winston-transport';
import {
  assertCalledTimes,
  assertCalledWith,
  assertTextMatch,
  pattern,
} from '../tests/assertions.ts';
import { mockImplementation, mockResolvedValue } from '../tests/mocks.ts';
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
      await assert.strictEqual(await run('throwcmd'), false);
    } finally {
      serverInstance.app.logger.remove(transport);
    }
    assert.ok(captured.join('\n').includes('boom from fixture command'));
  });

  it('resolves true when run() succeeds', async () => {
    await assert.strictEqual(await run('okcmd'), true);
  });
});

describe('BaseCli command discovery and help', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('discovers supported files and keeps the first duplicate command', async () => {
    const cli = new BaseCli(serverInstance);
    const firstPath = commandPath('OkCommand');
    const duplicatePath = commandPath('ThrowingCommand');
    mockResolvedValue(mock.method(cli, 'getFilesPathWithInheritance'), [
      { file: 'Alpha.ts', path: firstPath },
      { file: 'alpha.js', path: duplicatePath },
      { file: 'README.md', path: '/ignored/README.md' },
    ]);
    const warn = mockImplementation(
      mock.method(cli.logger, 'warn'),
      () => cli.logger,
    );
    mockImplementation(mock.method(console, 'info'), () => {});
    mockImplementation(mock.method(console, 'time'), () => {});
    mockImplementation(mock.method(console, 'timeEnd'), () => {});
    mockImplementation(mock.method(console, 'log'), () => {});

    await assert.strictEqual(await cli.loadCommands(), true);

    assert.deepStrictEqual(cli.commands, { alpha: firstPath });
    assertCalledWith(warn, pattern.stringContaining('already exists'));
  });

  it('prints commands alphabetically with their descriptions', async () => {
    const cli = new BaseCli(serverInstance);
    cli.commands = {
      zulu: commandPath('ThrowingCommand'),
      alpha: commandPath('OkCommand'),
    };
    const log = mockImplementation(mock.method(console, 'log'), () => {});

    await cli.printCommandTable();

    const output = log.mock.calls
      .map(({ arguments: [message] }) => String(message))
      .join('\n');
    assert.ok(output.indexOf('alpha') < output.indexOf('zulu'));
    assert.ok(output.includes('Fixture command that always succeeds'));
    assert.ok(output.includes('Usage'));
  });

  it('returns false and prints the command table for absent command names', async () => {
    const cli = new BaseCli(serverInstance);
    cli.commands = { okcmd: commandPath('OkCommand') };
    const printCommandTable = mockResolvedValue(
      mock.method(cli, 'printCommandTable'),
      undefined,
    );
    mockImplementation(mock.method(console, 'log'), () => {});

    await assert.strictEqual(await cli.run(''), false);
    await assert.strictEqual(await cli.run('missing'), false);

    assertCalledTimes(printCommandTable, 2);
  });
});

describe('BaseCli model-aware command lifecycle', () => {
  const originalArgv = process.argv;
  const originalMongoAppName = process.env.MONGO_APP_NAME;

  afterEach(() => {
    process.argv = originalArgv;
    if (originalMongoAppName === undefined) {
      delete process.env.MONGO_APP_NAME;
    } else {
      process.env.MONGO_APP_NAME = originalMongoAppName;
    }
    mock.restoreAll();
  });

  it('loads model paths, waits for models, and preserves an operator app name', async () => {
    const cli = new BaseCli(serverInstance);
    cli.commands = { modelcmd: commandPath('ModelCommand') };
    const getModelPaths = mockResolvedValue(
      mock.method(serverInstance, 'getModelFilesPathsWithInheritance'),
      [],
    );
    const initAllModels = mockResolvedValue(
      mock.method(serverInstance, 'initAllModels'),
      undefined,
    );
    mockImplementation(mock.method(console, 'info'), () => {});
    process.argv = ['node', 'cli.ts', 'modelcmd'];

    delete process.env.MONGO_APP_NAME;
    await assert.strictEqual(await cli.run('modelcmd'), true);
    assert.ok(process.env.MONGO_APP_NAME);
    assertTextMatch(process.env.MONGO_APP_NAME, /^CLI: modelcmd /);

    process.env.MONGO_APP_NAME = 'operator-supplied-name';
    await assert.strictEqual(await cli.run('modelcmd'), true);

    assert.strictEqual(process.env.MONGO_APP_NAME, 'operator-supplied-name');
    assertCalledTimes(getModelPaths, 2);
    assertCalledTimes(initAllModels, 2);
    assertCalledWith(initAllModels, { waitForConnection: true });
  });
});

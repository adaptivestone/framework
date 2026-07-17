import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

describe('BaseCli command discovery and help', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('discovers supported files and keeps the first duplicate command', async () => {
    const cli = new BaseCli(serverInstance);
    const firstPath = commandPath('OkCommand');
    const duplicatePath = commandPath('ThrowingCommand');
    vi.spyOn(cli, 'getFilesPathWithInheritance').mockResolvedValue([
      { file: 'Alpha.ts', path: firstPath },
      { file: 'alpha.js', path: duplicatePath },
      { file: 'README.md', path: '/ignored/README.md' },
    ]);
    const warn = vi
      .spyOn(cli.logger, 'warn')
      .mockImplementation(() => cli.logger);
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'time').mockImplementation(() => {});
    vi.spyOn(console, 'timeEnd').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(cli.loadCommands()).resolves.toBe(true);

    expect(cli.commands).toEqual({ alpha: firstPath });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('already exists'),
    );
  });

  it('prints commands alphabetically with their descriptions', async () => {
    const cli = new BaseCli(serverInstance);
    cli.commands = {
      zulu: commandPath('ThrowingCommand'),
      alpha: commandPath('OkCommand'),
    };
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await cli.printCommandTable();

    const output = log.mock.calls
      .map(([message]) => String(message))
      .join('\n');
    expect(output.indexOf('alpha')).toBeLessThan(output.indexOf('zulu'));
    expect(output).toContain('Fixture command that always succeeds');
    expect(output).toContain('Usage');
  });

  it('returns false and prints the command table for absent command names', async () => {
    const cli = new BaseCli(serverInstance);
    cli.commands = { okcmd: commandPath('OkCommand') };
    const printCommandTable = vi
      .spyOn(cli, 'printCommandTable')
      .mockResolvedValue();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(cli.run('')).resolves.toBe(false);
    await expect(cli.run('missing')).resolves.toBe(false);

    expect(printCommandTable).toHaveBeenCalledTimes(2);
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
    vi.restoreAllMocks();
  });

  it('loads model paths, waits for models, and preserves an operator app name', async () => {
    const cli = new BaseCli(serverInstance);
    cli.commands = { modelcmd: commandPath('ModelCommand') };
    const getModelPaths = vi
      .spyOn(serverInstance, 'getModelFilesPathsWithInheritance')
      .mockResolvedValue([]);
    const initAllModels = vi
      .spyOn(serverInstance, 'initAllModels')
      .mockResolvedValue();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    process.argv = ['node', 'cli.ts', 'modelcmd'];

    delete process.env.MONGO_APP_NAME;
    await expect(cli.run('modelcmd')).resolves.toBe(true);
    expect(process.env.MONGO_APP_NAME).toMatch(/^CLI: modelcmd /);

    process.env.MONGO_APP_NAME = 'operator-supplied-name';
    await expect(cli.run('modelcmd')).resolves.toBe(true);

    expect(process.env.MONGO_APP_NAME).toBe('operator-supplied-name');
    expect(getModelPaths).toHaveBeenCalledTimes(2);
    expect(initAllModels).toHaveBeenCalledTimes(2);
    expect(initAllModels).toHaveBeenCalledWith({ waitForConnection: true });
  });
});

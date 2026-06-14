import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { appInstance } from '../helpers/appInstance.ts';
import AbstractCommand from './AbstractCommand.ts';

/**
 * `AbstractCommand` is the CLI command base. Its one piece of real logic is
 * `getMongoConnectionName`: Mongo's `appName` handshake field is capped (128
 * bytes), so a long command + args must collapse to a stable hash instead of a
 * raw, oversized name.
 */
describe('AbstractCommand.getMongoConnectionName', () => {
  it('returns the readable name verbatim when it is short', () => {
    expect(AbstractCommand.getMongoConnectionName('seed', { n: 1 })).toBe(
      'CLI: seed {"n":1}',
    );
  });

  it('hashes (and warns) when the name reaches 64 chars', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const args = { veryLongArgumentNameThatPushesPastSixtyFourChars: true };
    const name = AbstractCommand.getMongoConnectionName('migrate', args);

    const expectedHash = createHash('sha256')
      .update(JSON.stringify(args))
      .digest('hex')
      .substring(0, 32);
    expect(name).toBe(`CLI: migrate ${expectedHash}`);
    expect(name.length).toBeLessThan(64);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe('AbstractCommand defaults', () => {
  it('exposes overridable static defaults', () => {
    expect(AbstractCommand.description).toContain('PLEASE PROVIDE IT');
    expect(AbstractCommand.commandArguments).toEqual({});
    expect(AbstractCommand.loggerGroup).toBe('command');
    expect(AbstractCommand.isShouldInitModels).toBe(true);
  });

  it('run() warns and resolves false until a subclass overrides it', async () => {
    const cmd = new AbstractCommand(appInstance, {}, {});
    await expect(cmd.run()).resolves.toBe(false);
  });
});

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it, mock } from 'node:test';
import { appInstance } from '../helpers/appInstance.ts';
import { assertCalledTimes } from '../tests/assertions.ts';
import { mockImplementation } from '../tests/mocks.ts';
import AbstractCommand from './AbstractCommand.ts';

/**
 * `AbstractCommand` is the CLI command base. Its one piece of real logic is
 * `getMongoConnectionName`: Mongo's `appName` handshake field is capped (128
 * bytes), so a long command + args must collapse to a stable hash instead of a
 * raw, oversized name.
 */
describe('AbstractCommand.getMongoConnectionName', () => {
  it('returns the readable name verbatim when it is short', () => {
    assert.strictEqual(
      AbstractCommand.getMongoConnectionName('seed', { n: 1 }),
      'CLI: seed {"n":1}',
    );
  });

  it('hashes (and warns) when the name reaches 64 chars', () => {
    const warn = mockImplementation(mock.method(console, 'warn'), () => {});
    const args = { veryLongArgumentNameThatPushesPastSixtyFourChars: true };
    const name = AbstractCommand.getMongoConnectionName('migrate', args);

    const expectedHash = createHash('sha256')
      .update(JSON.stringify(args))
      .digest('hex')
      .substring(0, 32);
    assert.strictEqual(name, `CLI: migrate ${expectedHash}`);
    assert.ok(name.length < 64);
    assertCalledTimes(warn, 1);
    warn.mock.restore();
  });
});

describe('AbstractCommand defaults', () => {
  it('exposes overridable static defaults', () => {
    assert.ok(AbstractCommand.description.includes('PLEASE PROVIDE IT'));
    assert.deepStrictEqual(AbstractCommand.commandArguments, {});
    assert.strictEqual(AbstractCommand.loggerGroup, 'command');
    assert.strictEqual(AbstractCommand.isShouldInitModels, true);
  });

  it('run() warns and resolves false until a subclass overrides it', async () => {
    const cmd = new AbstractCommand(appInstance, {}, {});
    await assert.strictEqual(await cmd.run(), false);
  });
});

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, it, mock } from 'node:test';
import folderConfig from './folderConfig.ts';
import {
  appInstance,
  resetAppInstance,
  setAppInstance,
} from './helpers/appInstance.ts';
import BaseCli from './modules/BaseCli.ts';
import Server from './server.ts';
import {
  assertCalledTimes,
  assertCalledWith,
  assertHasProperty,
  assertNthCalledWith,
  assertThrowsLike,
  pattern,
} from './tests/assertions.ts';
import { mockImplementation, mockResolvedValue } from './tests/mocks.ts';
import { serverInstance } from './tests/testHelpers.ts';

/**
 * `getModel` / `getConfig` are the two lookups every consumer uses. These pin
 * their DX-safety guards on the already-initialized app: the low-level server
 * lookup still warns and returns a safe empty value for an unknown runtime
 * name, while the app's explicit dynamic API throws instead of returning a
 * `false | Model` union. A plural name nudges toward the singular convention.
 */
describe('Server lookups — DX guards', () => {
  it('getModel warns and returns false for an unknown model', () => {
    const warn = mockImplementation(
      mock.method(appInstance.logger, 'warn'),
      () => appInstance.logger,
    );
    assert.strictEqual(serverInstance.getModel('NoSuchModel'), false);
    assertCalledTimes(warn, 1);
    warn.mock.restore();
  });

  it('getModel warns about a plural model name', () => {
    const warn = mockImplementation(
      mock.method(appInstance.logger, 'warn'),
      () => appInstance.logger,
    );
    serverInstance.getModel('Users'); // plural → nudge + (also unknown) → false
    assert.strictEqual(
      warn.mock.calls.some(({ arguments: [message] }) =>
        String(message).includes('plural'),
      ),
      true,
    );
    warn.mock.restore();
  });

  it('getModel returns a real model for a known name', () => {
    assert.ok(appInstance.getModel('User'));
  });

  it('getModelOrThrow returns a real model for a known name', () => {
    assert.strictEqual(
      appInstance.getModelOrThrow('User'),
      appInstance.getModel('User'),
    );
  });

  it('getModelOrThrow throws for an unknown runtime name', () => {
    const warn = mockImplementation(
      mock.method(appInstance.logger, 'warn'),
      () => appInstance.logger,
    );
    assertThrowsLike(
      () => appInstance.getModelOrThrow('NoSuchModel'),
      "Model 'NoSuchModel' is not available",
    );
    assertCalledTimes(warn, 1);
    warn.mock.restore();
  });

  it('getConfig warns and returns {} for an unknown config', () => {
    const warn = mockImplementation(
      mock.method(appInstance.logger, 'warn'),
      () => appInstance.logger,
    );
    assert.deepStrictEqual(appInstance.getConfig('noSuchConfig'), {});
    assertCalledTimes(warn, 1);
    warn.mock.restore();
  });

  it('getConfig returns the cached config for a known name', () => {
    assertHasProperty(appInstance.getConfig('auth'), 'hashRounds');
  });

  it('fails clearly when config/model lookups happen before init', () => {
    const original = appInstance;
    resetAppInstance();
    try {
      const server = new Server(folderConfig);
      const error = mock.fn();
      Object.defineProperty(server.app, 'logger', {
        value: { error, warn: mock.fn() },
      });

      assert.strictEqual(server.getModel('Uninitialized'), false);
      assertThrowsLike(
        () => server.getModelOrThrow('Uninitialized'),
        "Model 'Uninitialized' is not available",
      );
      assertCalledWith(
        error,
        pattern.objectContaining({
          message: 'You should call Server.init() before using getModel',
        }),
      );
      assertThrowsLike(
        () => server.getConfig('missing'),
        'You should call Server.init() before using getConfig',
      );
    } finally {
      resetAppInstance();
      setAppInstance(original);
    }
  });
});

describe('Server.runCliCommand', () => {
  it('lazily creates one CLI and delegates subsequent commands to it', async () => {
    const run = mockResolvedValue(mock.method(BaseCli.prototype, 'run'), true);
    serverInstance.cli = null;
    try {
      await assert.strictEqual(
        await serverInstance.runCliCommand('first'),
        true,
      );
      // `serverInstance.cli = null` above narrows the property to `null` for
      // the rest of this block, so read it back through its declared type and
      // let the runtime guard below do the narrowing.
      const readCli = (): BaseCli | null => serverInstance.cli;
      const cli = readCli();
      await assert.strictEqual(
        await serverInstance.runCliCommand('second'),
        true,
      );

      assert.ok(cli);
      assert.ok(cli instanceof BaseCli);
      assert.strictEqual(serverInstance.cli, cli);
      assertNthCalledWith(run, 1, 'first');
      assertNthCalledWith(run, 2, 'second');
    } finally {
      run.mock.restore();
      serverInstance.cli = null;
    }
  });
});

/**
 * Both `folderConfig`'s defaults and `app.frameworkFolder` derive filesystem
 * paths from `import.meta.url`. They must decode the URL (`fileURLToPath`), not
 * read `.pathname` — the latter leaves percent-encoding in place, so a checkout
 * under a directory with a space yields `%20`-laden paths that miss on disk.
 * These pin real, on-disk paths free of any `%` so the encoded form can't return.
 */
describe('Filesystem paths from import.meta.url are decoded, not percent-encoded', () => {
  it('folderConfig folders exist on disk and are not percent-encoded', () => {
    for (const folder of Object.values(folderConfig.folders)) {
      assert.ok(!folder.includes('%'));
      assert.strictEqual(existsSync(folder), true);
    }
  });

  it('app.frameworkFolder exists on disk and is not percent-encoded', () => {
    assert.ok(!appInstance.frameworkFolder.includes('%'));
    assert.strictEqual(existsSync(appInstance.frameworkFolder), true);
  });
});

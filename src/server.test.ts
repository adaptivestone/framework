import { existsSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import folderConfig from './folderConfig.ts';
import {
  appInstance,
  resetAppInstance,
  setAppInstance,
} from './helpers/appInstance.ts';
import BaseCli from './modules/BaseCli.ts';
import Server from './server.ts';
import { serverInstance } from './tests/testHelpers.ts';

/**
 * `getModel` / `getConfig` are the two lookups every consumer uses. These pin
 * their DX-safety guards on the already-initialized app: an unknown name warns
 * and returns a safe empty value (never throws mid-request), and a plural model
 * name nudges toward the singular convention.
 */
describe('Server lookups — DX guards', () => {
  it('getModel warns and returns false for an unknown model', () => {
    const warn = vi
      .spyOn(appInstance.logger, 'warn')
      .mockImplementation(() => appInstance.logger);
    expect(appInstance.getModel('NoSuchModel')).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('getModel warns about a plural model name', () => {
    const warn = vi
      .spyOn(appInstance.logger, 'warn')
      .mockImplementation(() => appInstance.logger);
    appInstance.getModel('Users'); // plural → nudge + (also unknown) → false
    expect(warn.mock.calls.some(([m]) => String(m).includes('plural'))).toBe(
      true,
    );
    warn.mockRestore();
  });

  it('getModel returns a real model for a known name', () => {
    expect(appInstance.getModel('User')).toBeTruthy();
  });

  it('getConfig warns and returns {} for an unknown config', () => {
    const warn = vi
      .spyOn(appInstance.logger, 'warn')
      .mockImplementation(() => appInstance.logger);
    expect(appInstance.getConfig('noSuchConfig')).toEqual({});
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('getConfig returns the cached config for a known name', () => {
    expect(appInstance.getConfig('auth')).toHaveProperty('hashRounds');
  });

  it('fails clearly when config/model lookups happen before init', () => {
    const original = appInstance;
    resetAppInstance();
    try {
      const server = new Server(folderConfig);
      const error = vi.fn();
      Object.defineProperty(server.app, 'logger', {
        value: { error, warn: vi.fn() },
      });

      expect(server.getModel('Uninitialized')).toBe(false);
      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'You should call Server.init() before using getModel',
        }),
      );
      expect(() => server.getConfig('missing')).toThrow(
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
    const run = vi.spyOn(BaseCli.prototype, 'run').mockResolvedValue(true);
    serverInstance.cli = null;
    try {
      await expect(serverInstance.runCliCommand('first')).resolves.toBe(true);
      const cli = serverInstance.cli;
      await expect(serverInstance.runCliCommand('second')).resolves.toBe(true);

      expect(cli).toBeInstanceOf(BaseCli);
      expect(serverInstance.cli).toBe(cli);
      expect(run).toHaveBeenNthCalledWith(1, 'first');
      expect(run).toHaveBeenNthCalledWith(2, 'second');
    } finally {
      run.mockRestore();
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
      expect(folder).not.toContain('%');
      expect(existsSync(folder)).toBe(true);
    }
  });

  it('app.frameworkFolder exists on disk and is not percent-encoded', () => {
    expect(appInstance.frameworkFolder).not.toContain('%');
    expect(existsSync(appInstance.frameworkFolder)).toBe(true);
  });
});

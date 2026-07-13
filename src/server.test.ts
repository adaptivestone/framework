import { existsSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import folderConfig from './folderConfig.ts';
import { appInstance } from './helpers/appInstance.ts';

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

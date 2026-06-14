import { describe, expect, it, vi } from 'vitest';
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

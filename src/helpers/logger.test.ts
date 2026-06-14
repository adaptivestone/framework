import { describe, expect, it, vi } from 'vitest';
import { consoleLogger, levels, noopLogger } from './logger.ts';

/**
 * `noopLogger` is the non-null fallback returned by `Base.logger` when a real
 * logger isn't reachable (e.g. through a Mongoose model proxy), so chained calls
 * like `logger.child(...).info(...)` must never throw. `consoleLogger` is the
 * pre-winston early-boot logger.
 */
describe('noopLogger', () => {
  it('exposes every level the framework calls, as silent no-ops', () => {
    for (const level of levels) {
      expect(noopLogger[level]('msg')).toBeUndefined();
    }
    expect(noopLogger.verbose('msg')).toBeUndefined();
  });

  it('child() returns the same no-op logger so deep chaining stays safe', () => {
    expect(noopLogger.child({ label: 'x' })).toBe(noopLogger);
    expect(noopLogger.child({}).child({}).info('still fine')).toBeUndefined();
  });
});

describe('consoleLogger', () => {
  it('routes to the matching console method', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleLogger('warn', 'hello');
    expect(spy).toHaveBeenCalledWith('hello');
    spy.mockRestore();
  });

  it('falls back to console.log when that console method is unavailable', () => {
    const orig = console.info;
    // Simulate a runtime whose console lacks `.info` → the else branch.
    (console as { info?: unknown }).info = undefined;
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleLogger('info', 'fallback');
    expect(log).toHaveBeenCalledWith('fallback');
    console.info = orig;
    log.mockRestore();
  });
});

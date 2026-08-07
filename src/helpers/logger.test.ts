import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { assertCalledWith } from '../tests/assertions.ts';
import { mockImplementation } from '../tests/mocks.ts';
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
      assert.strictEqual(noopLogger[level]('msg'), undefined);
    }
    assert.strictEqual(noopLogger.verbose('msg'), undefined);
  });

  it('child() returns the same no-op logger so deep chaining stays safe', () => {
    assert.strictEqual(noopLogger.child({ label: 'x' }), noopLogger);
    assert.strictEqual(
      noopLogger.child({}).child({}).info('still fine'),
      undefined,
    );
  });
});

describe('consoleLogger', () => {
  it('routes to the matching console method', () => {
    const spy = mockImplementation(mock.method(console, 'warn'), () => {});
    consoleLogger('warn', 'hello');
    assertCalledWith(spy, 'hello');
    spy.mock.restore();
  });

  it('falls back to console.log when that console method is unavailable', () => {
    const orig = console.info;
    // Simulate a runtime whose console lacks `.info` → the else branch.
    (console as { info?: unknown }).info = undefined;
    const log = mockImplementation(mock.method(console, 'log'), () => {});
    consoleLogger('info', 'fallback');
    assertCalledWith(log, 'fallback');
    console.info = orig;
    log.mock.restore();
  });
});

import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { appInstance } from '../helpers/appInstance.ts';
import { noopLogger } from '../helpers/logger.ts';
import { assertCalledTimes } from '../tests/assertions.ts';
import { mockImplementation } from '../tests/mocks.ts';
import Base from './Base.ts';

/**
 * `Base` is the root of every framework module. Its lazy `logger` getter has a
 * critical safety branch: when reached through something that isn't a real
 * `Base` instance (a Mongoose model proxy reads the private `#realLogger` and
 * throws), it must degrade to the no-op logger instead of crashing.
 */
describe('Base', () => {
  it('getConstructorName returns the (possibly subclassed) class name', () => {
    assert.strictEqual(new Base(appInstance).getConstructorName(), 'Base');
    class Child extends Base {}
    assert.strictEqual(new Child(appInstance).getConstructorName(), 'Child');
  });

  it('lazily builds a real child logger and caches it', () => {
    const base = new Base(appInstance);
    const logger = base.logger;
    assert.strictEqual(typeof logger.info, 'function');
    assert.notStrictEqual(logger, noopLogger);
    assert.strictEqual(base.logger, logger); // memoized on #realLogger, not rebuilt
  });

  it('degrades to the no-op logger (and warns) when read off a non-Base `this`', () => {
    const warn = mockImplementation(mock.method(console, 'warn'), () => {});
    const get = Object.getOwnPropertyDescriptor(Base.prototype, 'logger')
      ?.get as () => unknown;
    // `{}` has no `#realLogger` private field → the read throws → catch branch.
    assert.strictEqual(get.call({}), noopLogger);
    assertCalledTimes(warn, 1);
    warn.mock.restore();
  });

  it('exposes an overridable loggerGroup default', () => {
    assert.strictEqual(Base.loggerGroup, 'Base_please_overwrite_');
  });
});

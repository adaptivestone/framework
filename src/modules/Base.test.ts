import { describe, expect, it, vi } from 'vitest';
import { appInstance } from '../helpers/appInstance.ts';
import { noopLogger } from '../helpers/logger.ts';
import Base from './Base.ts';

/**
 * `Base` is the root of every framework module. Its lazy `logger` getter has a
 * critical safety branch: when reached through something that isn't a real
 * `Base` instance (a Mongoose model proxy reads the private `#realLogger` and
 * throws), it must degrade to the no-op logger instead of crashing.
 */
describe('Base', () => {
  it('getConstructorName returns the (possibly subclassed) class name', () => {
    expect(new Base(appInstance).getConstructorName()).toBe('Base');
    class Child extends Base {}
    expect(new Child(appInstance).getConstructorName()).toBe('Child');
  });

  it('lazily builds a real child logger and caches it', () => {
    const base = new Base(appInstance);
    const logger = base.logger;
    expect(typeof logger.info).toBe('function');
    expect(logger).not.toBe(noopLogger);
    expect(base.logger).toBe(logger); // memoized on #realLogger, not rebuilt
  });

  it('degrades to the no-op logger (and warns) when read off a non-Base `this`', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const get = Object.getOwnPropertyDescriptor(Base.prototype, 'logger')
      ?.get as () => unknown;
    // `{}` has no `#realLogger` private field → the read throws → catch branch.
    expect(get.call({})).toBe(noopLogger);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('exposes an overridable loggerGroup default', () => {
    expect(Base.loggerGroup).toBe('Base_please_overwrite_');
  });
});

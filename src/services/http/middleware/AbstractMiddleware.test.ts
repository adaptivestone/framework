import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { appInstance } from '../../../helpers/appInstance.ts';
import type { FrameworkRequest } from '../HttpServer.ts';
import AbstractMiddleware from './AbstractMiddleware.ts';

/**
 * Base class every middleware extends. Covers its real default behavior: a
 * middleware that forgets to implement `middleware()` warns and falls through
 * (never silently drops the request), and `getMiddleware()` returns a bound
 * handler. The deprecated instance schema getters (removed in v6) are left
 * uncovered on purpose.
 */
describe('AbstractMiddleware base behavior', () => {
  it('default middleware warns and calls next() (request never dropped)', async () => {
    class Bare extends AbstractMiddleware {}
    const mw = new Bare(appInstance);
    const warn = vi
      .spyOn(mw.logger, 'warn')
      .mockImplementation(() => mw.logger);
    const next = vi.fn();
    await mw.middleware({} as FrameworkRequest, {} as Response, next);
    expect(next).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('getMiddleware returns the handler bound to the instance', async () => {
    class Bare extends AbstractMiddleware {}
    const mw = new Bare(appInstance);
    const bound = mw.getMiddleware();
    expect(typeof bound).toBe('function');
    const next = vi.fn();
    // `this` is preserved even when called detached (as Express does).
    await (bound as (...a: unknown[]) => Promise<unknown>)({}, {}, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('exposes overridable defaults', () => {
    expect(AbstractMiddleware.description).toContain('Please provide');
    expect(AbstractMiddleware.relatedQueryParameters).toBeNull();
    expect(AbstractMiddleware.relatedRequestParameters).toBeNull();
    expect(AbstractMiddleware.loggerGroup).toBe('middleware');
  });
});

import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import type { Response } from 'express';
import { appInstance } from '../../../helpers/appInstance.ts';
import { assertCalledTimes } from '../../../tests/assertions.ts';
import { mockImplementation } from '../../../tests/mocks.ts';
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
    const warn = mockImplementation(
      mock.method(mw.logger, 'warn'),
      () => mw.logger,
    );
    const next = mock.fn();
    await mw.middleware({} as FrameworkRequest, {} as Response, next);
    assertCalledTimes(next, 1);
    assertCalledTimes(warn, 1);
    warn.mock.restore();
  });

  it('getMiddleware returns the handler bound to the instance', async () => {
    class Bare extends AbstractMiddleware {}
    const mw = new Bare(appInstance);
    const bound = mw.getMiddleware();
    assert.strictEqual(typeof bound, 'function');
    const next = mock.fn();
    // `this` is preserved even when called detached (as Express does).
    await (bound as (...a: unknown[]) => Promise<unknown>)({}, {}, next);
    assertCalledTimes(next, 1);
  });

  it('exposes overridable defaults', () => {
    assert.ok(AbstractMiddleware.description.includes('Please provide'));
    assert.strictEqual(AbstractMiddleware.relatedQueryParameters, null);
    assert.strictEqual(AbstractMiddleware.relatedRequestParameters, null);
    assert.strictEqual(AbstractMiddleware.loggerGroup, 'middleware');
  });
});

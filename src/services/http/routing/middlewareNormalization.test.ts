import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertThrowsLike } from '../../../tests/assertions.ts';
import type AbstractMiddleware from '../middleware/AbstractMiddleware.ts';
import {
  type MiddlewareSpec,
  normalizeMiddleware,
  normalizeMiddlewares,
} from './middlewareNormalization.ts';

// Synthetic middleware class for tests — we only check identity and the
// fact that it's a function, so a minimal stand-in is enough.
class FakeMw {
  readonly kind = 'middleware';
  static get name() {
    return 'FakeMw';
  }
}

describe('normalizeMiddleware', () => {
  it('handles bare class form (no params)', () => {
    // biome-ignore lint/suspicious/noExplicitAny: synthetic stand-in for a real middleware class
    const entry = normalizeMiddleware(FakeMw as any);
    assert.strictEqual(entry.Class, FakeMw);
    assert.strictEqual(entry.params, undefined);
  });

  it('handles tuple form [Class, params]', () => {
    const entry = normalizeMiddleware(
      // biome-ignore lint/suspicious/noExplicitAny: synthetic stand-in
      [FakeMw as any, { max: 5 }] as any,
    );
    assert.strictEqual(entry.Class, FakeMw);
    assert.deepStrictEqual(entry.params, { max: 5 });
  });

  it('throws TypeError on tuple with non-class first element', () => {
    assertThrowsLike(
      () =>
        // biome-ignore lint/suspicious/noExplicitAny: deliberate bad input
        normalizeMiddleware(['not-a-class' as any, {}] as any),
      TypeError,
    );
  });

  it('throws TypeError when tuple length is not exactly two', () => {
    assertThrowsLike(
      () =>
        // biome-ignore lint/suspicious/noExplicitAny: deliberate malformed runtime input
        normalizeMiddleware([FakeMw as any] as any),
      'expected exactly [Class, params]',
    );

    assertThrowsLike(
      () =>
        // biome-ignore lint/suspicious/noExplicitAny: deliberate malformed runtime input
        normalizeMiddleware([FakeMw as any, {}, 'extra'] as any),
      'expected exactly [Class, params]',
    );
  });

  it('throws TypeError when tuple params are not a plain object shape', () => {
    assertThrowsLike(
      () =>
        // biome-ignore lint/suspicious/noExplicitAny: deliberate malformed runtime input
        normalizeMiddleware([FakeMw as any, null] as any),
      'expected a params object',
    );

    assertThrowsLike(
      () =>
        // biome-ignore lint/suspicious/noExplicitAny: deliberate malformed runtime input
        normalizeMiddleware([FakeMw as any, []] as any),
      'expected a params object',
    );
  });

  it('throws TypeError on plain non-class, non-tuple input', () => {
    assertThrowsLike(
      () =>
        // biome-ignore lint/suspicious/noExplicitAny: deliberate bad input
        normalizeMiddleware('plain-string' as any),
      TypeError,
    );
  });
});

describe('normalizeMiddlewares', () => {
  it('maps over an array of mixed specs', () => {
    const specs: MiddlewareSpec[] = [
      // biome-ignore lint/suspicious/noExplicitAny: synthetic
      FakeMw as any as typeof AbstractMiddleware,
      // biome-ignore lint/suspicious/noExplicitAny: synthetic
      [FakeMw as any as typeof AbstractMiddleware, { x: 1 }],
    ];
    const out = normalizeMiddlewares(specs);

    assert.strictEqual(out.length, 2);
    assert.strictEqual(out[0]?.Class, FakeMw);
    assert.strictEqual(out[0]?.params, undefined);
    assert.strictEqual(out[1]?.Class, FakeMw);
    assert.deepStrictEqual(out[1]?.params, { x: 1 });
  });

  it('empty input → empty output', () => {
    assert.deepStrictEqual(normalizeMiddlewares([]), []);
  });
});

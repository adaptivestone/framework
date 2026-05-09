import { describe, expect, it } from 'vitest';
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

const source = {
  kind: 'package' as const,
  spec: '@adaptivestone/framework/middleware/Fake',
};

describe('normalizeMiddleware', () => {
  it('handles bare class form (no params)', () => {
    // biome-ignore lint/suspicious/noExplicitAny: synthetic stand-in for a real middleware class
    const entry = normalizeMiddleware(FakeMw as any, source);
    expect(entry.Class).toBe(FakeMw);
    expect(entry.params).toBeUndefined();
    expect(entry.source).toBe(source);
  });

  it('handles tuple form [Class, params]', () => {
    const entry = normalizeMiddleware(
      // biome-ignore lint/suspicious/noExplicitAny: synthetic stand-in
      [FakeMw as any, { max: 5 }] as any,
      source,
    );
    expect(entry.Class).toBe(FakeMw);
    expect(entry.params).toEqual({ max: 5 });
    expect(entry.source).toBe(source);
  });

  it('throws TypeError on tuple with non-class first element', () => {
    expect(() =>
      normalizeMiddleware(
        // biome-ignore lint/suspicious/noExplicitAny: deliberate bad input
        ['not-a-class' as any, {}] as any,
        source,
      ),
    ).toThrow(TypeError);
  });

  it('throws TypeError on plain non-class, non-tuple input', () => {
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: deliberate bad input
      normalizeMiddleware('plain-string' as any, source),
    ).toThrow(TypeError);
  });

  it('preserves the source reference (does not copy)', () => {
    // biome-ignore lint/suspicious/noExplicitAny: synthetic
    const e = normalizeMiddleware(FakeMw as any, source);
    expect(e.source).toBe(source);
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
    const out = normalizeMiddlewares(specs, source);

    expect(out).toHaveLength(2);
    expect(out[0]?.Class).toBe(FakeMw);
    expect(out[0]?.params).toBeUndefined();
    expect(out[1]?.Class).toBe(FakeMw);
    expect(out[1]?.params).toEqual({ x: 1 });
  });

  it('empty input → empty output', () => {
    expect(normalizeMiddlewares([], source)).toEqual([]);
  });
});

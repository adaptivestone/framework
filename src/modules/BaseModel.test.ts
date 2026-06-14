import { describe, expect, it } from 'vitest';
import { BaseModel } from './BaseModel.ts';

/**
 * `BaseModel`'s static getters are the customization contract: a model overrides
 * the ones it needs and inherits empty defaults for the rest. These pin that the
 * un-overridden defaults are empty (so `initialize` composes a valid schema even
 * for a model that only declares `modelSchema`).
 */
describe('BaseModel default getters', () => {
  it('return empty shapes when not overridden', () => {
    expect(BaseModel.modelSchema).toEqual({});
    expect(BaseModel.schemaOptions).toEqual({});
    expect(BaseModel.modelInstanceMethods).toEqual({});
    expect(BaseModel.modelVirtuals).toEqual({});
    expect(BaseModel.modelStatics).toEqual({});
  });

  it('initHooks default is a no-op (no throw without a hook override)', () => {
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: only the no-op default is under test
      BaseModel.initHooks({} as any),
    ).not.toThrow();
  });
});

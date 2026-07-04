import { describe, expect, it } from 'vitest';
import { BaseModel, isBaseModelSubclassShape } from './BaseModel.ts';

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

/**
 * The model loader's structural discriminator: recognizes a BaseModel subclass
 * from a *different installed framework copy* (where `instanceof` is false)
 * while never matching a genuinely-legacy AbstractModel-based model.
 */
describe('isBaseModelSubclassShape (duplicate-copy discriminator)', () => {
  it('is true for a genuine BaseModel subclass', () => {
    class RealModel extends BaseModel {
      static get modelSchema() {
        return { name: { type: String } } as const;
      }
    }
    expect(isBaseModelSubclassShape(RealModel)).toBe(true);
  });

  it('is true for a BaseModel-shaped class from a different copy (not instanceof)', () => {
    // biome-ignore lint/complexity/noStaticOnlyClass: mirrors BaseModel's static surface without extending it
    class DuplicateCopyModel {
      static get modelSchema() {
        return { name: { type: String } } as const;
      }
      static initialize() {
        throw new Error(
          'the loader must reject this before calling initialize',
        );
      }
    }
    expect(DuplicateCopyModel.prototype instanceof BaseModel).toBe(false);
    expect(isBaseModelSubclassShape(DuplicateCopyModel)).toBe(true);
  });

  it('is false for a legacy AbstractModel-style model (routes to the legacy branch)', () => {
    // Legacy shape: `modelSchema` is an instance getter, no static `initialize`.
    class LegacyModel {
      get modelSchema() {
        return {};
      }
    }
    expect(isBaseModelSubclassShape(LegacyModel)).toBe(false);
  });

  it('is false for a class with only one of the two markers', () => {
    // biome-ignore lint/complexity/noStaticOnlyClass: fixture with a single static marker
    class OnlyInitialize {
      static initialize() {}
    }
    // biome-ignore lint/complexity/noStaticOnlyClass: fixture with a single static marker
    class OnlyModelSchema {
      static get modelSchema() {
        return {};
      }
    }
    expect(isBaseModelSubclassShape(OnlyInitialize)).toBe(false);
    expect(isBaseModelSubclassShape(OnlyModelSchema)).toBe(false);
  });

  it('is false for non-class values', () => {
    expect(isBaseModelSubclassShape(undefined)).toBe(false);
    expect(isBaseModelSubclassShape(null)).toBe(false);
    expect(isBaseModelSubclassShape({})).toBe(false);
    expect(isBaseModelSubclassShape(() => {})).toBe(false);
  });
});

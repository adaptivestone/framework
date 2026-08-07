import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BaseModel, isBaseModelSubclassShape } from './BaseModel.ts';

/**
 * `BaseModel`'s static getters are the customization contract: a model overrides
 * the ones it needs and inherits empty defaults for the rest. These pin that the
 * un-overridden defaults are empty (so `initialize` composes a valid schema even
 * for a model that only declares `modelSchema`).
 */
describe('BaseModel default getters', () => {
  it('return empty shapes when not overridden', () => {
    assert.deepStrictEqual(BaseModel.modelSchema, {});
    assert.deepStrictEqual(BaseModel.schemaOptions, {});
    assert.deepStrictEqual(BaseModel.modelInstanceMethods, {});
    assert.deepStrictEqual(BaseModel.modelVirtuals, {});
    assert.deepStrictEqual(BaseModel.modelStatics, {});
  });

  it('initHooks default is a no-op (no throw without a hook override)', () => {
    assert.doesNotThrow(() =>
      // biome-ignore lint/suspicious/noExplicitAny: only the no-op default is under test
      BaseModel.initHooks({} as any),
    );
  });

  it('passes schema-level lean defaults to the runtime Mongoose schema', () => {
    class LeanDefaultOptionRecord extends BaseModel {
      static get modelSchema() {
        return { title: { type: String, required: true } } as const;
      }

      static get schemaOptions() {
        return { lean: true } as const;
      }
    }

    const Model = LeanDefaultOptionRecord.initialize();
    try {
      assert.strictEqual(Model.schema.options.lean, true);
    } finally {
      Model.db.deleteModel(Model.modelName);
    }
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
    assert.strictEqual(isBaseModelSubclassShape(RealModel), true);
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
    assert.strictEqual(
      DuplicateCopyModel.prototype instanceof BaseModel,
      false,
    );
    assert.strictEqual(isBaseModelSubclassShape(DuplicateCopyModel), true);
  });

  it('is false for a legacy AbstractModel-style model (routes to the legacy branch)', () => {
    // Legacy shape: `modelSchema` is an instance getter, no static `initialize`.
    class LegacyModel {
      get modelSchema() {
        return {};
      }
    }
    assert.strictEqual(isBaseModelSubclassShape(LegacyModel), false);
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
    assert.strictEqual(isBaseModelSubclassShape(OnlyInitialize), false);
    assert.strictEqual(isBaseModelSubclassShape(OnlyModelSchema), false);
  });

  it('is false for non-class values', () => {
    assert.strictEqual(isBaseModelSubclassShape(undefined), false);
    assert.strictEqual(isBaseModelSubclassShape(null), false);
    assert.strictEqual(isBaseModelSubclassShape({}), false);
    assert.strictEqual(
      isBaseModelSubclassShape(() => {}),
      false,
    );
  });
});

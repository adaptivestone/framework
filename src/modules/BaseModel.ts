import type {
  // DefaultSchemaOptions,
  HydratedDocument,
  InferRawDocType,
  Schema,
  SchemaOptions,
} from 'mongoose';
import mongoose, { type Model } from 'mongoose';

export type Merge<M, N> = Omit<M, keyof N> & N;

/** The timestamp fields Mongoose adds when `timestamps` is on (the default).
 * Typed `required: true` so `InferRawDocType` resolves them to a non-null `Date`
 * on the hydrated doc — Mongoose always sets them, so a `| null | undefined`
 * would force a needless guard at every read. */
type Timestamps = {
  createdAt: { type: DateConstructor; required: true };
  updatedAt: { type: DateConstructor; required: true };
};

type TimestampFieldName<Value, DefaultName extends string> = Value extends false
  ? never
  : Value extends string
    ? Value
    : DefaultName;

type TimestampFieldsFromConfig<TConfig> = {
  [K in keyof Timestamps as K extends keyof TConfig
    ? TimestampFieldName<TConfig[K], K>
    : K]: Timestamps[K];
};

/**
 * Timestamp schema fields implied by the effective Mongoose schema options.
 *
 * The framework enables both default timestamp paths unless a model overrides
 * that default. Object-form options can disable either path independently or
 * rename it. An omitted key in an object config keeps its default field, which
 * matches Mongoose's runtime `handleTimestampOption()` behavior.
 */
export type WithTimestamps<TOptions> = TOptions extends {
  timestamps: infer TConfig;
}
  ? TConfig extends false
    ? object
    : TConfig extends true
      ? Timestamps
      : TConfig extends object
        ? TimestampFieldsFromConfig<TConfig>
        : Timestamps
  : Timestamps;

export type ExtractProperty<
  T,
  K extends PropertyKey,
  Default = object, // Optional: a default type if the property doesn't exist
> = T extends { [P in K]: infer R } ? R : Default;

/**
 * Phantom per-field type override. Intersect a schema field with this to type
 * that field as `T` instead of the type Mongoose infers from `type:` — for
 * fields a plugin reshapes at runtime (`mongoose-intl`, encrypted fields,
 * custom getters), so the static type matches what's actually stored. `__tsType`
 * is never set at runtime; only the compile-time type changes. Opt-in and a
 * strict no-op for any field that doesn't carry the marker.
 *
 * @example
 *   // app-side, ideally behind a small factory:
 *   title: { type: String, intl: true } as { type: StringConstructor; intl: true } &
 *     TsTypeOverride<IntlSubDocValue<string>>;
 */
export interface TsTypeOverride<T> {
  readonly __tsType?: T;
}

/**
 * A leaf field definition — a bare constructor (`String`, `ObjectId`), a
 * `{ type: SomeConstructor, … }` form (String, Number, ObjectId, Date, Map,
 * Buffer, …), or a pre-built mongoose `Schema` instance reused as a (sub-)doc
 * definition (`field: SubSchema` / `[SubSchema]`). This mirrors how Mongoose
 * itself decides "leaf field" vs "nested schema", so {@link ApplyTsOverrides}
 * and {@link HasTsOverride} recurse only into nested *schemas* (a record of
 * field defs) and leave built-in instances (ObjectId, Date, Map) and `Schema`
 * instances untouched. The `Schema` case is essential: a `Schema` instance's own
 * type is deeply self-referential (`childSchemas`, `options`, …), so scanning
 * into it triggers a TS2615 circular mapped-type error — and it can carry no
 * `__tsType` marker anyway, so stopping there is always correct.
 */
type IsLeafFieldDef<S> = S extends Schema
  ? true
  : S extends abstract new (
        ...args: never
      ) => unknown
    ? true
    : S extends { type: infer Tp }
      ? Tp extends Schema
        ? true
        : Tp extends abstract new (
              ...args: never
            ) => unknown
          ? true
          : false
      : false;

/**
 * Walk an inferred raw-doc type alongside its schema and replace each field
 * marked with {@link TsTypeOverride} by the declared override type. Recurses
 * into nested objects and subdocument arrays (a reshaped field can appear at any
 * depth); leaves everything else — including arrays of primitives and built-in
 * instances (ObjectId/Date/Map, via {@link IsLeafFieldDef}) — untouched. A
 * schema with no markers maps to a structurally identical type, so existing
 * models are unaffected. The marker is detected by the *presence* of the
 * `__tsType` key (not by `extends TsTypeOverride`, which an optional property
 * would match on every field).
 */
export type ApplyTsOverrides<Doc, Schema> = {
  [K in keyof Doc]: K extends keyof Schema
    ? '__tsType' extends keyof Schema[K]
      ? Schema[K] extends TsTypeOverride<infer U>
        ? U
        : Doc[K]
      : NonNullable<Schema[K]> extends readonly (infer E)[]
        ? NonNullable<Doc[K]> extends readonly (infer D)[]
          ? D extends object
            ? IsLeafFieldDef<E> extends true
              ? Doc[K]
              : ApplyTsOverrides<D, E>[] | Exclude<Doc[K], readonly unknown[]>
            : Doc[K]
          : Doc[K]
        : NonNullable<Schema[K]> extends object
          ? NonNullable<Doc[K]> extends object
            ? IsLeafFieldDef<NonNullable<Schema[K]>> extends true
              ? Doc[K]
              :
                  | ApplyTsOverrides<
                      NonNullable<Doc[K]>,
                      NonNullable<Schema[K]>
                    >
                  | Exclude<Doc[K], object>
            : Doc[K]
          : Doc[K]
    : Doc[K];
};

/**
 * True when a schema carries at least one {@link TsTypeOverride} marker anywhere
 * — at the top level, inside a nested object, or inside a subdocument array.
 * Recurses with the same leaf/array/object shape as {@link ApplyTsOverrides}, so
 * it cannot miss a marker the override pass would have applied. Used to skip the
 * whole override mapping for the overwhelmingly common marker-free model, so its
 * doc type is the plain Mongoose inference with no `ApplyTsOverrides<…>` wrapper
 * in hovers and no extra compile work.
 */
type HasTsOverride<S> = S extends object
  ? '__tsType' extends keyof S
    ? true
    : IsLeafFieldDef<S> extends true
      ? false
      : S extends readonly (infer E)[]
        ? HasTsOverride<E>
        : true extends { [K in keyof S]: HasTsOverride<S[K]> }[keyof S]
          ? true
          : false
  : false;

/** {@link ApplyTsOverrides} only when the schema actually has a marker;
 * otherwise the inferred doc verbatim (a strict no-op, but without the wrapper). */
type MaybeApplyOverrides<Doc, Schema> =
  HasTsOverride<Schema> extends true ? ApplyTsOverrides<Doc, Schema> : Doc;

/**
 * Remove readonly modifiers introduced by `as const` before handing a schema
 * definition to Mongoose's `InferRawDocType`.
 *
 * Mongoose recommends literal-preserving schema definitions, but its required
 * path detection currently recognizes mutable `[true, message]` tuples and
 * mutable array definitions only. Without this boundary normalization,
 * `required: [true, 'message'] as const` and `type: [String] as const` are
 * incorrectly inferred as optional. Literal values (`true`, `false`, enum
 * members) are preserved; only readonly containers/properties become mutable.
 *
 * Runtime/opaque values that can legally appear in schema definitions stop the
 * recursion. `Schema` and `SchemaType` are especially important because their
 * instance types are deeply self-referential.
 */
type SchemaInferenceAtomic =
  | Schema
  | mongoose.SchemaType
  | Date
  | RegExp
  | Buffer
  | Map<unknown, unknown>
  | Set<unknown>
  | { readonly _bsontype: string };

type MutableSchemaForInference<T> = T extends SchemaInferenceAtomic
  ? T
  : T extends abstract new (
        ...args: never[]
      ) => unknown
    ? T
    : T extends (...args: never[]) => unknown
      ? T
      : T extends readonly unknown[]
        ? { -readonly [K in keyof T]: MutableSchemaForInference<T[K]> }
        : T extends object
          ? { -readonly [K in keyof T]: MutableSchemaForInference<T[K]> }
          : T;

/** Schema options after applying the same framework defaults used at runtime. */
type EffectiveSchemaOptions<TOptions> = Merge<typeof defaultOptions, TOptions>;

// biome-ignore lint/suspicious/noExplicitAny: unfinished class members must stay variance-neutral in Mongoose's Schema carrier
type UnfinishedSchemaMember = any;

type InferredRawDocFromSchema<
  TSchema extends typeof BaseModel.modelSchema,
  TOptions,
> = InferRawDocType<
  MutableSchemaForInference<TSchema> &
    WithTimestamps<EffectiveSchemaOptions<TOptions>>
>;

type OverriddenRawDocFromSchema<
  TSchema extends typeof BaseModel.modelSchema,
  TOptions,
> = MaybeApplyOverrides<InferredRawDocFromSchema<TSchema, TOptions>, TSchema>;

/** The raw doc type Mongoose infers from a class's `modelSchema` + timestamps. */
type InferredRawDoc<T extends typeof BaseModel> = InferredRawDocFromSchema<
  ExtractProperty<T, 'modelSchema'>,
  ExtractProperty<T, 'schemaOptions'>
>;

/** {@link InferredRawDoc} with any per-field `__tsType` overrides applied —
 * and, for a marker-free schema, exactly {@link InferredRawDoc} with no wrapper. */
type OverriddenRawDoc<T extends typeof BaseModel> = MaybeApplyOverrides<
  InferredRawDoc<T>,
  ExtractProperty<T, 'modelSchema'>
>;

// Type utility to get the complete Schema type for a BaseModel class
export type GetModelSchemaTypeFromClass<T extends typeof BaseModel> = Schema<
  OverriddenRawDoc<T>, // TRawDocType
  Model<
    OverriddenRawDoc<T>,
    object, // TQueryHelpers
    ExtractProperty<T, 'modelInstanceMethods'>, // TInstanceMethods
    ExtractProperty<T, 'modelVirtuals'> // TVirtuals
  >, // TModelType
  ExtractProperty<T, 'modelInstanceMethods'>, // TInstanceMethods
  object, // TQueryHelpers
  ExtractProperty<T, 'modelVirtuals'>, // TVirtuals
  ExtractProperty<T, 'modelStatics'>, // TStaticMethods
  ExtractProperty<T, 'schemaOptions'> // TSchemaOptions
>;

export type VirtualType<T> = {
  [P in keyof T]: T[P] extends { get: () => infer R } ? R : never;
};

/**
 * Caller-facing view of instance methods: drop the authored `this` constraint
 * from each method when projecting them onto the document type. A method body
 * may declare an explicit `this: <bridge>` (a narrower hand-written shape the
 * body needs — e.g. a populated ref or a plugin-reshaped field); that bridge is
 * deliberately not assignable-from the framework-computed hydrated doc, so a
 * direct `doc.method(...)` call would otherwise fail the this-context check
 * (TS2684) even though `this` is always correctly bound at runtime. Stripping it
 * here fixes the false positive while leaving the authored definitions
 * untouched, so method bodies stay type-checked against their declared `this`.
 * `OmitThisParameter` returns non-function members (and methods with no explicit
 * `this`) unchanged, so this is a strict no-op for ordinary instance methods.
 *
 * Known limitation: a method that is BOTH generic AND declares an explicit
 * `this` loses its type parameters here (they collapse to their constraint) —
 * `OmitThisParameter` rebuilds the signature via `infer`, which can't carry
 * generics. This is rare (instance methods are seldom generic), and the
 * alternative was worse: such a method was previously uncallable (TS2684). A
 * generic method WITHOUT an explicit `this` is untouched (no-op) and keeps its
 * generics; drop the `this` annotation if generic inference matters.
 */
export type DocFacingMethods<M> = {
  [K in keyof M]: OmitThisParameter<M[K]>;
};

// this came from moongose. Look at the Model and Schema types.
export type GetModelTypeFromClass<T extends typeof BaseModel> = Model<
  OverriddenRawDoc<T>, // TRawDocType
  object, // TQueryHelpers
  DocFacingMethods<ExtractProperty<T, 'modelInstanceMethods'>>, // TInstanceMethods
  ExtractProperty<T, 'modelVirtuals'>, // TVirtuals
  HydratedDocument<
    OverriddenRawDoc<T>, // TRawDocType
    VirtualType<ExtractProperty<T, 'modelVirtuals'>> &
      DocFacingMethods<ExtractProperty<T, 'modelInstanceMethods'>> & {
        id: string;
      }, // TVirtuals & TInstanceMethods (caller-facing `this` stripped)
    object, // TQueryHelpers
    // Resolve virtuals to their getter's return type here too (not the raw
    // `{ get, set, options }` def): this slot feeds mongoose's inner
    // `Document<…, TVirtuals, …>`, and a raw def would intersect with the
    // resolved `VirtualType<…>` above to give an ugly `string & { get; … }`
    // instead of a clean `string` on `doc.<virtual>`.
    VirtualType<ExtractProperty<T, 'modelVirtuals'>> // TVirtuals
  >,
  GetModelSchemaTypeFromClass<T> // TSchema
> &
  ExtractProperty<T, 'modelStatics'>; // Add intersection with static methods

/**
 * A reduced Mongoose model type inferred from the runtime schema definition.
 *
 * Use this only as an authoring context inside a model class, where resolving
 * `GetModelTypeFromClass<typeof CurrentClass>` would circularly reference the
 * class member still being inferred. It has native Mongoose model operations
 * and schema fields, but intentionally cannot contain that unfinished class's
 * custom statics, methods, or virtuals.
 *
 * Pass the model's literal `schemaOptions` as `TOptions` when they affect query
 * results. In particular, Mongoose 9.9 uses the schema generic to make
 * schema-level `lean: true` queries return plain objects by default and
 * `{ lean: false }` queries return hydrated documents.
 *
 * This is a TypeScript authoring limitation, not a second runtime schema. Use
 * {@link GetModelTypeFromClass} for complete model handles after class
 * definition.
 */
export type GetModelTypeLiteFromSchema<
  T extends typeof BaseModel.modelSchema,
  TOptions = object,
> = Model<
  OverriddenRawDocFromSchema<T, TOptions>, // TRawDocType
  object, // TQueryHelpers
  object, // TInstanceMethods (unfinished in this authoring context)
  object, // TVirtuals (unfinished in this authoring context)
  HydratedDocument<OverriddenRawDocFromSchema<T, TOptions>>,
  Schema<
    OverriddenRawDocFromSchema<T, TOptions>,
    UnfinishedSchemaMember, // TModelType: the owning class is unfinished here
    UnfinishedSchemaMember, // TInstanceMethods: keep complete models assignable
    UnfinishedSchemaMember, // TQueryHelpers
    UnfinishedSchemaMember, // TVirtuals
    UnfinishedSchemaMember, // TStaticMethods
    EffectiveSchemaOptions<TOptions>
  > // TSchema: preserves schema-level query defaults such as `lean`
>;

export const defaultOptions = { timestamps: true, minimize: false } as const;

export type TBaseModel = GetModelTypeFromClass<typeof BaseModel>;
// biome-ignore lint/complexity/noStaticOnlyClass: TODO think about it in future
export class BaseModel {
  static get modelSchema() {
    return {} as const;
  }

  static get schemaOptions() {
    return {} as const;
  }

  static get modelInstanceMethods() {
    return {};
  }

  static get modelVirtuals() {
    return {};
  }

  static get modelStatics() {
    return {};
  }

  static initHooks(_schema: Schema) {
    // Add hooks here
  }

  // Properly typed static method with generic constraints
  public static initialize<T extends typeof BaseModel>(this: T) {
    const schema = new mongoose.Schema(this.modelSchema, {
      ...defaultOptions,
      ...(this.schemaOptions as SchemaOptions),
      methods: this.modelInstanceMethods,
      statics: this.modelStatics,
      virtuals: this.modelVirtuals,
    }) as GetModelSchemaTypeFromClass<T>;

    this.initHooks(schema);

    const mongooseModel = mongoose.model(
      this.name,
      schema,
    ) as GetModelTypeFromClass<T>;

    return mongooseModel;
  }
}

/**
 * Structural "is a BaseModel subclass" check by static shape (`initialize` +
 * `modelSchema`), not `instanceof`. The model loader uses it to catch a subclass
 * extending BaseModel from a *different installed copy* of
 * `@adaptivestone/framework` (duplicate/undeduped install): `instanceof`
 * compares prototype identity, so it's false across the copy boundary. Requiring
 * both markers means a legacy AbstractModel-based model can never match — its
 * `modelSchema` is an instance getter and it has no static `initialize`.
 */
export function isBaseModelSubclassShape(candidate: unknown): boolean {
  if (typeof candidate !== 'function') {
    return false;
  }
  const ctor = candidate as { initialize?: unknown; modelSchema?: unknown };
  if (typeof ctor.initialize !== 'function') {
    return false;
  }
  try {
    return ctor.modelSchema !== undefined;
  } catch {
    // A throwing static getter still means the static slot exists.
    return true;
  }
}

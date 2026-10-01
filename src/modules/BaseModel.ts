import type {
  HydratedDocument,
  InferHydratedDocType,
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
 * its raw/stored value as `TRaw` instead of the type Mongoose infers from
 * `type:` — for fields a plugin reshapes at runtime (`mongoose-intl`, encrypted
 * fields, custom getters). When a getter exposes a different hydrated value,
 * pass it as `THydrated`; the default preserves the original one-type behavior.
 * Both marker properties are compile-time only and are never set at runtime.
 * The override is opt-in and a strict no-op for unmarked fields.
 *
 * @example
 *   // app-side, ideally behind a small factory:
 *   title: { type: String, intl: true } as { type: StringConstructor; intl: true } &
 *     TsTypeOverride<IntlText, string | IntlText>;
 */
export interface TsTypeOverride<TRaw, THydrated = TRaw> {
  readonly __tsType?: TRaw;
  readonly __tsHydratedType?: THydrated;
}

type TsOverrideSurface = 'raw' | 'hydrated';

type RawTsOverride<S> = S extends { readonly __tsType?: infer T } ? T : never;

type HydratedTsOverride<S> = S extends object
  ? '__tsHydratedType' extends keyof S
    ? S extends { readonly __tsHydratedType?: infer T }
      ? T
      : RawTsOverride<S>
    : RawTsOverride<S>
  : never;

type TsOverrideFor<
  S,
  Surface extends TsOverrideSurface,
> = Surface extends 'hydrated' ? HydratedTsOverride<S> : RawTsOverride<S>;

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
type IsLeafFieldDef<S, TypeKey extends string = 'type'> = S extends Schema
  ? true
  : S extends abstract new (
        ...args: never[]
      ) => unknown
    ? true
    : TypeKey extends keyof S
      ? S[TypeKey] extends Schema
        ? true
        : S[TypeKey] extends abstract new (
              ...args: never[]
            ) => unknown
          ? true
          : false
      : false;

type SchemaArrayElement<S, TypeKey extends string = 'type'> =
  NonNullable<S> extends readonly (infer E)[]
    ? E
    : TypeKey extends keyof NonNullable<S>
      ? NonNullable<S>[TypeKey] extends readonly (infer E)[]
        ? E
        : never
      : never;

type SchemaArrayElementWithIdMarker<
  S,
  TypeKey extends string = 'type',
> = S extends { readonly _id: false }
  ? SchemaArrayElement<S, TypeKey> & { readonly _id: false }
  : SchemaArrayElement<S, TypeKey>;

type SchemaSingleNestedDefinition<
  S,
  TypeKey extends string = 'type',
> = TypeKey extends keyof NonNullable<S>
  ? NonNullable<S>[TypeKey] extends infer Definition
    ? Definition extends Schema
      ? never
      : Definition extends abstract new (
            ...args: never[]
          ) => unknown
        ? never
        : Definition extends readonly unknown[]
          ? never
          : Definition extends object
            ? Definition
            : never
    : never
  : never;

type SingleNestedDefinitionOrSelf<S, TypeKey extends string = 'type'> = [
  SchemaSingleNestedDefinition<S, TypeKey>,
] extends [never]
  ? S
  : SchemaSingleNestedDefinition<S, TypeKey>;

type ApplyTsOverrideArray<
  DocField,
  ElementSchema,
  Surface extends TsOverrideSurface,
  TypeKey extends string = 'type',
> =
  NonNullable<DocField> extends mongoose.Types.DocumentArray<
    infer Raw,
    infer Hydrated
  >
    ? IsLeafFieldDef<ElementSchema, TypeKey> extends true
      ? DocField
      :
          | mongoose.Types.DocumentArray<
              ApplyTsOverrides<Raw, ElementSchema, 'raw', TypeKey>,
              ApplyTsOverrides<
                Hydrated,
                ElementSchema,
                'hydrated',
                TypeKey
              > extends mongoose.Types.Subdocument
                ? ApplyTsOverrides<Hydrated, ElementSchema, 'hydrated', TypeKey>
                : Hydrated
            >
          | Extract<DocField, null | undefined>
    : NonNullable<DocField> extends readonly (infer Item)[]
      ? Item extends object
        ? IsLeafFieldDef<ElementSchema, TypeKey> extends true
          ? DocField
          :
              | ApplyTsOverrides<Item, ElementSchema, Surface, TypeKey>[]
              | Exclude<DocField, readonly unknown[]>
        : DocField
      : DocField;

/**
 * Walk an inferred document type alongside its schema and replace each field
 * marked with {@link TsTypeOverride} by the override for the selected surface.
 * The default remains `raw` for compatibility with existing two-argument uses.
 * Recurses into nested objects and subdocument arrays (a reshaped field can
 * appear at any depth); leaves everything else — including arrays of primitives
 * and built-in instances (ObjectId/Date/Map, via {@link IsLeafFieldDef}) —
 * untouched. A schema with no markers maps to a structurally identical type, so
 * existing models are unaffected. The marker is detected by the *presence* of
 * the `__tsType` key (not by `extends TsTypeOverride`, which an optional property
 * would match on every field).
 */
export type ApplyTsOverrides<
  Doc,
  Schema,
  Surface extends TsOverrideSurface = 'raw',
  TypeKey extends string = 'type',
> = {
  [K in keyof Doc]: K extends keyof Schema
    ? '__tsType' extends keyof Schema[K]
      ? TsOverrideFor<Schema[K], Surface>
      : [SchemaArrayElement<Schema[K], TypeKey>] extends [never]
        ? NonNullable<Schema[K]> extends object
          ? NonNullable<Doc[K]> extends object
            ? IsLeafFieldDef<NonNullable<Schema[K]>, TypeKey> extends true
              ? Doc[K]
              :
                  | ApplyTsOverrides<
                      NonNullable<Doc[K]>,
                      SingleNestedDefinitionOrSelf<
                        NonNullable<Schema[K]>,
                        TypeKey
                      >,
                      Surface,
                      TypeKey
                    >
                  | Exclude<Doc[K], object>
            : Doc[K]
          : Doc[K]
        : ApplyTsOverrideArray<
            Doc[K],
            SchemaArrayElement<Schema[K], TypeKey>,
            Surface,
            TypeKey
          >
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
type HasTsOverride<S, TypeKey extends string = 'type'> = S extends object
  ? '__tsType' extends keyof S
    ? true
    : IsLeafFieldDef<S, TypeKey> extends true
      ? false
      : S extends readonly (infer E)[]
        ? HasTsOverride<E, TypeKey>
        : true extends { [K in keyof S]: HasTsOverride<S[K], TypeKey> }[keyof S]
          ? true
          : false
  : false;

/** {@link ApplyTsOverrides} only when the schema actually has a marker;
 * otherwise the inferred doc verbatim (a strict no-op, but without the wrapper). */
type MaybeApplyOverrides<
  Doc,
  Schema,
  Surface extends TsOverrideSurface = 'raw',
  TypeKey extends string = 'type',
> =
  HasTsOverride<Schema, TypeKey> extends true
    ? ApplyTsOverrides<Doc, Schema, Surface, TypeKey>
    : Doc;

/**
 * True for a *plain nested path* — an object of field definitions with no
 * `type` key, e.g. `name: { first: String, last: String }`.
 *
 * Mongoose groups those paths under a prefix but never builds a subdocument for
 * them, so they carry no `_id` at runtime (`doc.name._id` is `undefined`); only
 * the `{ type: { … } }` spelling produces a real subdocument with a generated
 * id. Anything with a `type` key, a leaf definition, or an array is therefore
 * excluded here — same discriminator {@link SchemaSingleNestedDefinition} uses.
 */
type IsPlainNestedPath<S, TypeKey extends string = 'type'> = S extends object
  ? S extends readonly unknown[]
    ? false
    : IsLeafFieldDef<S, TypeKey> extends true
      ? false
      : TypeKey extends keyof S
        ? false
        : true
  : false;

type HasDisabledSubdocumentId<S, TypeKey extends string = 'type'> = S extends {
  readonly _id: false;
}
  ? true
  : S extends object
    ? IsLeafFieldDef<S, TypeKey> extends true
      ? false
      : S extends readonly (infer E)[]
        ? HasDisabledSubdocumentId<E, TypeKey>
        : true extends {
              [K in keyof S]: HasDisabledSubdocumentId<S[K], TypeKey>;
            }[keyof S]
          ? true
          : false
    : false;

type CorrectRawSubdocumentElement<
  Doc,
  Schema,
  TypeKey extends string = 'type',
> = Doc extends object
  ? Schema extends { readonly _id: false }
    ? Omit<
        CorrectRawSubdocumentIds<
          MaybeApplyOverrides<Doc, Schema, 'raw', TypeKey>,
          Schema,
          TypeKey
        >,
        '_id'
      >
    : CorrectRawSubdocumentIds<
        MaybeApplyOverrides<Doc, Schema, 'raw', TypeKey>,
        Schema,
        TypeKey
      >
  : Doc;

/** Resolve schema structure before mapping document fields. Keeping these
 * steps separate avoids recursive generic instantiation in Mongoose model types.
 * Custom-key array elements also need fresh inference: Mongoose 9.9.4 infers
 * inline array elements using its default `type` key. */
type RawIdFields<Definition, TypeKey extends string> = {
  [K in keyof Definition as TypeKey extends 'type'
    ? HasDisabledSubdocumentId<Definition[K], TypeKey> extends true
      ? K
      : never
    : IsLeafFieldDef<Definition[K], TypeKey> extends true
      ? never
      : K]: RawIdShape<Definition[K], TypeKey>;
};

type RawIdObject<Definition, TypeKey extends string> = {
  fields: RawIdFields<Definition, TypeKey>;
  removeId: Definition extends { readonly _id: false } ? true : false;
};

type RawIdShape<Definition, TypeKey extends string> = [
  SchemaArrayElement<Definition, TypeKey>,
] extends [never]
  ? [SchemaSingleNestedDefinition<Definition, TypeKey>] extends [never]
    ? RawIdObject<Definition, TypeKey>
    : RawIdObject<
        SingleNestedDefinitionWithIdMarker<Definition, TypeKey>,
        TypeKey
      >
  : TypeKey extends 'type'
    ? {
        array: RawIdObject<
          SchemaArrayElementWithIdMarker<Definition, TypeKey>,
          TypeKey
        >;
      }
    : IsLeafFieldDef<
          SchemaArrayElement<Definition, TypeKey>,
          TypeKey
        > extends true
      ? object
      : {
          array: RawIdObject<
            SchemaArrayElementWithIdMarker<Definition, TypeKey>,
            TypeKey
          >;
          item: MaybeApplyOverrides<
            InferRawDocType<
              MutableSchemaForInference<
                SchemaArrayElement<Definition, TypeKey>
              >,
              { typeKey: TypeKey }
            >,
            SchemaArrayElement<Definition, TypeKey>,
            'raw',
            TypeKey
          >;
        };

type ApplyRawIdFields<Doc, Fields> = {
  [K in keyof Doc]: K extends keyof Fields
    ? ApplyRawIdShape<Doc[K], Fields[K]>
    : Doc[K];
};

type ApplyRawIdShape<Doc, Shape> = Doc extends readonly (infer Item)[]
  ? Shape extends { array: infer Element }
    ? ApplyRawIdShape<
        Shape extends { item: infer Inferred } ? Inferred : Item,
        Element
      >[]
    : Doc
  : Doc extends object
    ? Shape extends { fields: infer Fields; removeId: infer Remove }
      ? Remove extends true
        ? Omit<ApplyRawIdFields<Doc, Fields>, '_id'>
        : ApplyRawIdFields<Doc, Fields>
      : Doc
    : Doc;

/** Correct disabled IDs and custom-key array inference on the raw surface. */
type CorrectRawSubdocumentIds<
  Doc,
  Definition,
  TypeKey extends string = 'type',
> = ApplyRawIdFields<Doc, RawIdFields<Definition, TypeKey>>;

type CorrectHydratedSubdocumentElement<
  Raw,
  Schema,
  TypeKey extends string = 'type',
> =
  CorrectRawSubdocumentElement<Raw, Schema, TypeKey> extends infer CorrectedRaw
    ? CorrectHydratedSubdocumentIds<
        // Rebuilding a subdocument must retain the hydrated override surface.
        MaybeApplyOverrides<
          InferHydratedDocType<
            MutableSchemaForInference<Schema>,
            { typeKey: TypeKey }
          >,
          Schema,
          'hydrated',
          TypeKey
        >,
        Schema,
        TypeKey
      > extends infer Fields
      ? Schema extends { readonly _id: false }
        ? mongoose.Types.Subdocument<undefined, unknown, CorrectedRaw> &
            Omit<Fields, '_id'>
        : mongoose.Types.Subdocument<
            ExtractProperty<Fields, '_id', mongoose.Types.ObjectId>,
            unknown,
            CorrectedRaw
          > &
            Fields
      : never
    : never;

/**
 * The single-nested definition a subdocument is re-derived from, keeping an
 * `_id: false` the *wrapper* carries.
 *
 * A subdocument spelled `field: { type: { … }, _id: false }` puts the marker
 * next to `type`, so unwrapping to the inner definition loses it and the
 * subdocument keeps an `_id` the runtime never generates. The
 * `field: { type: { _id: false, … } }` spelling survives the unwrap on its own
 * and needs no re-attachment.
 */
type SingleNestedDefinitionWithIdMarker<
  S,
  TypeKey extends string = 'type',
> = S extends { readonly _id: false }
  ? SchemaSingleNestedDefinition<S, TypeKey> & { readonly _id: false }
  : SchemaSingleNestedDefinition<S, TypeKey>;

/** Inspect schema definitions before rebuilding a hydrated subdocument. Most
 * arrays contain only leaf fields and need no correction or extra inference. */
type HasHydratedCorrection<
  Definition,
  TypeKey extends string,
> = Definition extends { readonly _id: false }
  ? true
  : IsLeafFieldDef<Definition, TypeKey> extends true
    ? false
    : Definition extends object
      ? true extends {
          [K in keyof Definition]: FieldNeedsHydratedCorrection<
            Definition[K],
            TypeKey
          >;
        }[keyof Definition]
        ? true
        : false
      : false;

type FieldNeedsHydratedCorrection<
  Field,
  TypeKey extends string,
> = Field extends { readonly _id: false }
  ? true
  : IsLeafFieldDef<Field, TypeKey> extends true
    ? false
    : [SchemaArrayElement<Field, TypeKey>] extends [never]
      ? [SchemaSingleNestedDefinition<Field, TypeKey>] extends [never]
        ? IsPlainNestedPath<Field, TypeKey>
        : HasHydratedCorrection<
            SchemaSingleNestedDefinition<Field, TypeKey>,
            TypeKey
          >
      : TypeKey extends 'type'
        ? HasHydratedCorrection<SchemaArrayElement<Field, TypeKey>, TypeKey>
        : IsLeafFieldDef<
              SchemaArrayElement<Field, TypeKey>,
              TypeKey
            > extends true
          ? false
          : true;

/**
 * Preserve Mongoose's hydrated array APIs while respecting inline `_id: false`,
 * and drop the `_id` Mongoose's hydrated inference adds to plain nested paths.
 * Mongoose otherwise exposes a phantom `_id: Types.ObjectId` on `_id: false`
 * subdocument elements (verified up to 9.9.4 — the correction is still
 * required), and intersects `{ _id: ObjectId }` onto every nested path — a
 * field that never exists at runtime, and one that makes assigning the real
 * runtime shape (`doc.name = { first: 'a' }`) a type error.
 */
type CorrectHydratedSubdocumentIds<
  Doc,
  Schema,
  TypeKey extends string = 'type',
> = {
  [K in keyof Doc]: K extends keyof Schema
    ? IsPlainNestedPath<NonNullable<Schema[K]>, TypeKey> extends true
      ? NonNullable<Doc[K]> extends object
        ?
            | ('_id' extends keyof NonNullable<Schema[K]>
                ? CorrectHydratedSubdocumentIds<
                    NonNullable<Doc[K]>,
                    NonNullable<Schema[K]>,
                    TypeKey
                  >
                : Omit<
                    CorrectHydratedSubdocumentIds<
                      NonNullable<Doc[K]>,
                      NonNullable<Schema[K]>,
                      TypeKey
                    >,
                    '_id'
                  >)
            | Exclude<Doc[K], object>
        : Doc[K]
      : FieldNeedsHydratedCorrection<Schema[K], TypeKey> extends true
        ? [SchemaArrayElement<Schema[K], TypeKey>] extends [never]
          ? [SchemaSingleNestedDefinition<Schema[K], TypeKey>] extends [never]
            ? Doc[K]
            : NonNullable<Doc[K]> extends object
              ?
                  | CorrectHydratedSubdocumentElement<
                      InferRawDocType<
                        MutableSchemaForInference<
                          SchemaSingleNestedDefinition<Schema[K], TypeKey>
                        >,
                        { typeKey: TypeKey }
                      >,
                      SingleNestedDefinitionWithIdMarker<Schema[K], TypeKey>,
                      TypeKey
                    >
                  | Exclude<Doc[K], object>
              : Doc[K]
          : NonNullable<Doc[K]> extends { isMongooseDocumentArray: true }
            ?
                | mongoose.Types.DocumentArray<
                    CorrectRawSubdocumentElement<
                      InferRawDocType<
                        MutableSchemaForInference<
                          SchemaArrayElement<Schema[K], TypeKey>
                        >,
                        { typeKey: TypeKey }
                      >,
                      SchemaArrayElementWithIdMarker<Schema[K], TypeKey>,
                      TypeKey
                    >,
                    CorrectHydratedSubdocumentElement<
                      InferRawDocType<
                        MutableSchemaForInference<
                          SchemaArrayElement<Schema[K], TypeKey>
                        >,
                        { typeKey: TypeKey }
                      >,
                      SchemaArrayElementWithIdMarker<Schema[K], TypeKey>,
                      TypeKey
                    >
                  >
                | Extract<Doc[K], null | undefined>
            : Doc[K]
        : Doc[K]
    : Doc[K];
};

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

type EffectiveTypeKey<TOptions> =
  EffectiveSchemaOptions<TOptions> extends {
    typeKey: infer Key extends string;
  }
    ? Key
    : 'type';

type TimestampSchema<TOptions> = {
  [K in keyof WithTimestamps<EffectiveSchemaOptions<TOptions>>]: {
    [P in keyof WithTimestamps<
      EffectiveSchemaOptions<TOptions>
    >[K] as P extends 'type' ? EffectiveTypeKey<TOptions> : P]: WithTimestamps<
      EffectiveSchemaOptions<TOptions>
    >[K][P];
  };
};

type InferenceOptions<TOptions> = Omit<
  EffectiveSchemaOptions<TOptions>,
  'timestamps'
> & {
  timestamps: false;
  typeKey: EffectiveTypeKey<TOptions>;
};

// biome-ignore lint/suspicious/noExplicitAny: unfinished class members must stay variance-neutral in Mongoose's Schema carrier
type UnfinishedSchemaMember = any;

type InferredRawDocFromSchema<
  TSchema extends typeof BaseModel.modelSchema,
  TOptions,
> = TOptions extends { typeKey: string } | { _id: false }
  ? InferRawDocType<
      MutableSchemaForInference<TSchema> & TimestampSchema<TOptions>,
      InferenceOptions<TOptions>
    >
  : InferRawDocType<
      MutableSchemaForInference<TSchema> &
        WithTimestamps<EffectiveSchemaOptions<TOptions>>
    >;

type OverriddenRawDocFromSchema<
  TSchema extends typeof BaseModel.modelSchema,
  TOptions,
> = CorrectTopLevelRawId<
  CorrectRawSubdocumentIds<
    MaybeApplyOverrides<
      InferredRawDocFromSchema<TSchema, TOptions>,
      TSchema,
      'raw',
      EffectiveTypeKey<TOptions>
    >,
    TSchema,
    EffectiveTypeKey<TOptions>
  >,
  TSchema,
  TOptions
>;

type InferredHydratedDocFromSchema<
  TSchema extends typeof BaseModel.modelSchema,
  TOptions,
> = TOptions extends { typeKey: string } | { _id: false }
  ? InferHydratedDocType<
      MutableSchemaForInference<TSchema> & TimestampSchema<TOptions>,
      InferenceOptions<TOptions>
    >
  : InferHydratedDocType<
      MutableSchemaForInference<TSchema> &
        WithTimestamps<EffectiveSchemaOptions<TOptions>>
    >;

type OverriddenHydratedDocFromSchema<
  TSchema extends typeof BaseModel.modelSchema,
  TOptions,
> =
  MaybeApplyOverrides<
    InferredHydratedDocFromSchema<TSchema, TOptions>,
    TSchema,
    'hydrated',
    EffectiveTypeKey<TOptions>
  > extends infer Doc
    ? HasHydratedCorrection<TSchema, EffectiveTypeKey<TOptions>> extends true
      ? CorrectHydratedSubdocumentIds<Doc, TSchema, EffectiveTypeKey<TOptions>>
      : Doc
    : never;

type HasDisabledTopLevelId<Definition, Options> =
  EffectiveSchemaOptions<Options> extends { _id: false }
    ? '_id' extends keyof Definition
      ? false
      : true
    : false;

/** An optional undefined marker stops Mongoose's lean helpers reintroducing an ObjectId. */
type CorrectTopLevelRawId<Doc, Definition, Options> =
  HasDisabledTopLevelId<Definition, Options> extends true
    ? Doc & { _id?: undefined }
    : Doc;

type CorrectTopLevelHydratedId<Doc, Definition, Options, Virtuals = object> =
  HasDisabledTopLevelId<Definition, Options> extends true
    ? Omit<
        Doc,
        '_id' | ('id' extends keyof Definition | keyof Virtuals ? never : 'id')
      > & { _id?: undefined }
    : Doc;

/** Raw schema inference with per-field overrides and runtime-shape corrections. */
type OverriddenRawDoc<T extends typeof BaseModel> = OverriddenRawDocFromSchema<
  ExtractProperty<T, 'modelSchema'>,
  ExtractProperty<T, 'schemaOptions'>
>;

type OverriddenHydratedDoc<T extends typeof BaseModel> =
  OverriddenHydratedDocFromSchema<
    ExtractProperty<T, 'modelSchema'>,
    ExtractProperty<T, 'schemaOptions'>
  >;

type HydratedDocumentFromClass<T extends typeof BaseModel> =
  CorrectTopLevelHydratedId<
    HydratedDocument<
      OverriddenHydratedDoc<T>,
      // No `& { id: string }`: Mongoose adds the `id` virtual itself and skips it
      // for `id: false` options or a schema-declared `id` path. Forcing it back on
      // typed a runtime `undefined` as a string and re-typed a custom `id` path.
      VirtualType<ExtractProperty<T, 'modelVirtuals'>> &
        DocFacingMethods<ExtractProperty<T, 'modelInstanceMethods'>>,
      object,
      VirtualType<ExtractProperty<T, 'modelVirtuals'>>,
      OverriddenRawDoc<T>,
      EffectiveSchemaOptions<ExtractProperty<T, 'schemaOptions'>>
    >,
    ExtractProperty<T, 'modelSchema'>,
    ExtractProperty<T, 'schemaOptions'>,
    ExtractProperty<T, 'modelVirtuals'>
  >;

// Type utility to get the complete Schema type for a BaseModel class
export type GetModelSchemaTypeFromClass<T extends typeof BaseModel> = Schema<
  OverriddenRawDoc<T>, // TRawDocType
  Model<
    OverriddenRawDoc<T>,
    object, // TQueryHelpers
    ExtractProperty<T, 'modelInstanceMethods'>, // TInstanceMethods
    ExtractProperty<T, 'modelVirtuals'>, // TVirtuals
    HydratedDocumentFromClass<T> // THydratedDocumentType
  >, // TModelType
  ExtractProperty<T, 'modelInstanceMethods'>, // TInstanceMethods
  object, // TQueryHelpers
  ExtractProperty<T, 'modelVirtuals'>, // TVirtuals
  ExtractProperty<T, 'modelStatics'>, // TStaticMethods
  ExtractProperty<T, 'schemaOptions'> // TSchemaOptions
>;

/**
 * Project each declared virtual onto the value the document exposes for it: a
 * getter's return type whatever arguments Mongoose passes it, otherwise the
 * setter's input type plus `undefined` when there is no getter, and
 * `unknown` for a virtual with neither — a populate virtual's shape is not
 * knowable from the schema, so reading it must force a narrowing.
 */
type VirtualValue<V> = V extends { get: (...args: never[]) => infer R }
  ? R
  : V extends { set: (value: infer S, ...rest: never[]) => unknown }
    ? S | undefined
    : unknown;

type SetterVirtualKeys<T> = {
  [P in keyof T]: T[P] extends { set: (...args: never[]) => unknown }
    ? P
    : never;
}[keyof T];

export type VirtualType<T> = [SetterVirtualKeys<T>] extends [never]
  ? { [P in keyof T]: VirtualValue<T[P]> }
  : {
      [P in keyof T as P extends SetterVirtualKeys<T>
        ? never
        : P]: VirtualValue<T[P]>;
    } & {
      -readonly [P in keyof T as P extends SetterVirtualKeys<T>
        ? P
        : never]: VirtualValue<T[P]>;
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
  HydratedDocumentFromClass<T>,
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
  CorrectTopLevelHydratedId<
    HydratedDocument<
      OverriddenHydratedDocFromSchema<T, TOptions>,
      object,
      object,
      object,
      OverriddenRawDocFromSchema<T, TOptions>,
      EffectiveSchemaOptions<TOptions>
    >,
    T,
    TOptions
  >,
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

import type {
  // DefaultSchemaOptions,
  HydratedDocument,
  InferRawDocType,
  Schema,
  SchemaOptions,
} from 'mongoose';
import mongoose, { type Model } from 'mongoose';

export type Merge<M, N> = Omit<M, keyof N> & N;

export type WithTimestamps<TOptions> = TOptions extends { timestamps: true }
  ? { createdAt: Schema.Types.Date; updatedAt: Schema.Types.Date }
  : TOptions extends { timestamps: false }
    ? object
    : { createdAt: Schema.Types.Date; updatedAt: Schema.Types.Date };

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
 * Walk an inferred raw-doc type alongside its schema and replace each field
 * marked with {@link TsTypeOverride} by the declared override type. Recurses
 * into nested objects and subdocument arrays (a reshaped field can appear at any
 * depth); leaves everything else — including arrays of primitives — untouched.
 * A schema with no markers maps to a structurally identical type, so existing
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
            ? ApplyTsOverrides<D, E>[] | Exclude<Doc[K], readonly unknown[]>
            : Doc[K]
          : Doc[K]
        : NonNullable<Schema[K]> extends object
          ? NonNullable<Doc[K]> extends object
            ?
                | ApplyTsOverrides<NonNullable<Doc[K]>, NonNullable<Schema[K]>>
                | Exclude<Doc[K], object>
            : Doc[K]
          : Doc[K]
    : Doc[K];
};

/** The raw doc type Mongoose infers from a class's `modelSchema` + timestamps. */
type InferredRawDoc<T extends typeof BaseModel> = InferRawDocType<
  ExtractProperty<T, 'modelSchema'> &
    WithTimestamps<
      Merge<typeof defaultOptions, ExtractProperty<T, 'schemaOptions'>>
    >
>;

/** {@link InferredRawDoc} with any per-field `__tsType` overrides applied
 * (identical to it when the schema carries no markers). */
type OverriddenRawDoc<T extends typeof BaseModel> = ApplyTsOverrides<
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

// this came from moongose. Look at the Model and Schema types.
export type GetModelTypeFromClass<T extends typeof BaseModel> = Model<
  OverriddenRawDoc<T>, // TRawDocType
  object, // TQueryHelpers
  ExtractProperty<T, 'modelInstanceMethods'>, // TInstanceMethods
  ExtractProperty<T, 'modelVirtuals'>, // TVirtuals
  HydratedDocument<
    OverriddenRawDoc<T>, // TRawDocType
    VirtualType<ExtractProperty<T, 'modelVirtuals'>> &
      ExtractProperty<T, 'modelInstanceMethods'> & { id: string }, // TVirtuals & TInstanceMethods
    object, // TQueryHelpers
    ExtractProperty<T, 'modelVirtuals'> // TVirtuals
  >,
  GetModelSchemaTypeFromClass<T> // TSchema
> &
  ExtractProperty<T, 'modelStatics'>; // Add intersection with static methods

export type GetModelTypeLiteFromSchema<
  T extends typeof BaseModel.modelSchema,
  TOptions = object,
> = Model<
  // TRawDocType, with any per-field `__tsType` overrides applied.
  ApplyTsOverrides<
    InferRawDocType<T & WithTimestamps<Merge<typeof defaultOptions, TOptions>>>,
    T
  >
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

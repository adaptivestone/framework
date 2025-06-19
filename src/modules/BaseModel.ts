import mongoose, { Model } from 'mongoose';

import type {
  SchemaOptions,
  Schema,
  InferRawDocType,
  // DefaultSchemaOptions,
  HydratedDocument,
} from 'mongoose';

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

// Type utility to get the complete Schema type for a BaseModel class
export type GetModelSchemaTypeFromClass<T extends typeof BaseModel> = Schema<
  InferRawDocType<
    ExtractProperty<T, 'modelSchema'> &
      WithTimestamps<
        Merge<typeof defaultOptions, ExtractProperty<T, 'schemaOptions'>>
      >
  >, // TRawDocType
  Model<
    InferRawDocType<
      ExtractProperty<T, 'modelSchema'> &
        WithTimestamps<
          Merge<typeof defaultOptions, ExtractProperty<T, 'schemaOptions'>>
        >
    >,
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
  InferRawDocType<
    ExtractProperty<T, 'modelSchema'> &
      WithTimestamps<
        Merge<typeof defaultOptions, ExtractProperty<T, 'schemaOptions'>>
      >
  >, // TRawDocType
  object, // TQueryHelpers
  ExtractProperty<T, 'modelInstanceMethods'>, // TInstanceMethods
  ExtractProperty<T, 'modelVirtuals'>, // TVirtuals
  HydratedDocument<
    InferRawDocType<
      ExtractProperty<T, 'modelSchema'> &
        WithTimestamps<
          Merge<typeof defaultOptions, ExtractProperty<T, 'schemaOptions'>>
        >
    >, //TRawDocType
    VirtualType<ExtractProperty<T, 'modelVirtuals'>> &
      ExtractProperty<T, 'modelInstanceMethods'>, // TVirtuals & TInstanceMethods
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
  InferRawDocType<T & WithTimestamps<Merge<typeof defaultOptions, TOptions>>> // TRawDocType
>;

export const defaultOptions = { timestamps: true, minimize: false } as const;

export type TBaseModel = GetModelTypeFromClass<typeof BaseModel>;
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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  static initHooks(schema: Schema) {
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

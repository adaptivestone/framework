import mongoose, { Model } from 'mongoose';

import type {
  SchemaOptions,
  Schema,
  InferRawDocType,
  // DefaultSchemaOptions,
  // HydratedDocument,
} from 'mongoose';

export type Merge<M, N> = Omit<M, keyof N> & N;

export type WithTimestamps<TOptions> = TOptions extends { timestamps: true }
  ? { createdAt: Date; updatedAt: Date }
  : TOptions extends { timestamps: false }
    ? {}
    : { createdAt: Date; updatedAt: Date };

// Helper type to extract schema type from modelSchema getter
export type ModelSchemaReturnType<T> = T extends { modelSchema: infer R }
  ? R
  : never;

// Helper types to extract return types from getter methods
export type ModelMethodsReturnType<T> = T extends {
  modelMethods: infer R;
}
  ? R
  : {};
export type ModelStaticsReturnType<T> = T extends {
  modelStatics: infer R;
}
  ? R
  : {};
export type SchemaOptionsReturnType<T> = T extends {
  schemaOptions: infer R;
}
  ? R
  : {};

// Type utility to get the complete Schema type for a BaseModel class
export type GetModelSchemaTypeFromClass<T extends typeof BaseModel> = Schema<
  InferRawDocType<
    ModelSchemaReturnType<T> &
      WithTimestamps<Merge<typeof defaultOptions, SchemaOptionsReturnType<T>>>
  >, // TRawDocType
  Model<any>, // TModel
  ModelMethodsReturnType<T>, // TInstanceMethods
  {}, // TQueryHelpers
  {}, // TVirtuals
  ModelStaticsReturnType<T>, // TStaticMethods
  SchemaOptionsReturnType<T> // TSchemaOptions
>;

export type GetModelTypeFromClass<T extends typeof BaseModel> = Model<
  InferRawDocType<
    ModelSchemaReturnType<T> &
      WithTimestamps<Merge<typeof defaultOptions, SchemaOptionsReturnType<T>>>
  >, // TRawDocType
  ModelMethodsReturnType<T>, // TInstanceMethods
  GetModelSchemaTypeFromClass<T> // TSchema
> &
  ModelStaticsReturnType<T>; // Add intersection with static methods

export type GetModelTypeLiteFromSchema<
  T extends typeof BaseModel.modelSchema,
  TOptions = {},
> = Model<
  InferRawDocType<T & WithTimestamps<Merge<typeof defaultOptions, TOptions>>> // TRawDocType
>;

export const defaultOptions = { timestamps: true, minimize: false } as const;

export class BaseModel {
  static isABaseModel = true; // Flag to identify BaseModel instances

  static get modelSchema() {
    return {} as const;
  }

  static get schemaOptions() {
    return {} as const;
  }

  static get modelMethods() {
    return {} as const;
  }

  static get modelStatics() {
    return {} as const;
  }

  static initHooks(schema: Schema) {
    // Add hooks here
  }

  // Properly typed static method with generic constraints
  public static initialize<T extends typeof BaseModel>(this: T) {
    const schema = new mongoose.Schema(this.modelSchema, {
      ...(this.schemaOptions as SchemaOptions),
      methods: this.modelMethods,
      statics: this.modelStatics,
    }) as GetModelSchemaTypeFromClass<T>;

    this.initHooks(schema);

    const mongooseModel = mongoose.model(
      this.name,
      schema,
    ) as GetModelTypeFromClass<T>;

    return mongooseModel;
  }
}

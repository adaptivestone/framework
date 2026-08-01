/**
 * Compile-time coverage for tenant-scoped model patterns.
 *
 * Covers reusable schema fragments, query/aggregate middleware, const-enum
 * fields, nested document arrays whose own field is named `type`, nested
 * `_id: false` objects, local validation hooks, DTO instance methods, model
 * statics, Mixed answer values, and created-only timestamps.
 */

import mongoose, {
  type Aggregate,
  type MongooseDefaultQueryMiddleware,
  type Query,
  type Schema,
  type Types,
} from 'mongoose';
import type {
  GetModelTypeFromClass,
  GetModelTypeLiteFromSchema,
} from '../../modules/BaseModel.ts';
import { BaseModel } from '../../modules/BaseModel.ts';

const organizationField = {
  type: mongoose.Schema.Types.ObjectId,
  ref: 'Organization',
  required: true,
  index: true,
} as const;

const QUERY_HOOKS: MongooseDefaultQueryMiddleware[] = [
  'countDocuments',
  'find',
  'findOne',
  'findOneAndUpdate',
  'findOneAndDelete',
  'updateOne',
  'updateMany',
  'deleteOne',
  'deleteMany',
];

function tenantScoped(schema: Schema): void {
  schema.pre(
    QUERY_HOOKS,
    function addOrganizationFilter(this: Query<unknown, unknown>) {
      const current = this.getFilter();
      if (current.organization === undefined) {
        this.where({ organization: new mongoose.Types.ObjectId() });
      }
    },
  );

  schema.pre(
    'aggregate',
    function addOrganizationStage(this: Aggregate<unknown>) {
      const pipeline = this.pipeline();
      const first = pipeline[0];
      if (!first || !('$match' in first)) {
        pipeline.unshift({
          $match: { organization: new mongoose.Types.ObjectId() },
        });
      }
    },
  );
}

const ITEM_TYPES = ['numeric', 'single', 'multiple', 'text'] as const;
const DEFINITION_STATES = ['draft', 'active', 'closed'] as const;

class TenantDefinition extends BaseModel {
  static get modelSchema() {
    return {
      organization: organizationField,
      uuid: { type: String, required: true, unique: true },
      title: { type: String, required: true },
      state: {
        type: String,
        enum: DEFINITION_STATES,
        default: 'draft',
      },
      items: {
        type: [
          {
            code: { type: String, required: true },
            type: {
              type: String,
              enum: ITEM_TYPES,
              required: true,
            },
            label: { type: String, required: true },
            required: { type: Boolean, default: false },
            order: { type: Number, required: true, min: 0 },
            tags: { type: [Number], default: [] },
            options: {
              type: [
                {
                  code: { type: String, required: true },
                  label: { type: String, required: true },
                },
              ],
              default: [],
            },
            scale: {
              _id: false,
              min: { type: Number },
              max: { type: Number },
              minLabel: { type: String },
              maxLabel: { type: String },
            },
          },
        ],
        default: [],
      },
      owner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
      },
    } as const;
  }

  static get modelVirtuals() {
    return {
      itemCount: {
        options: { type: Number },
        get(this: TenantDefinitionDocument): number {
          return this.items.length;
        },
      },
    } as const;
  }

  static get modelStatics() {
    return {
      findActive(
        this: TenantDefinitionModelLite,
        organization: Types.ObjectId,
      ) {
        return this.find({ organization, state: 'active' }).sort({
          createdAt: -1,
        });
      },
    } as const;
  }

  static get modelInstanceMethods() {
    return {
      serialize(this: TenantDefinitionDocument) {
        return {
          id: this.uuid,
          title: this.title,
          state: this.state,
          items: this.items.map((item) => ({
            code: item.code,
            type: item.type,
            label: item.label,
            required: item.required ?? false,
            options: item.options.map((option) => ({
              code: option.code,
              label: option.label,
            })),
          })),
        };
      },
    } as const;
  }

  static initHooks(schema: Schema) {
    tenantScoped(schema);
    schema.pre(
      'validate',
      function validateItemOrder(this: TenantDefinitionDocument) {
        const orders = this.items.map((item) => item.order);
        if (new Set(orders).size !== orders.length) {
          this.invalidate('items', 'item order must be unique');
        }
      },
    );
  }
}

type TenantDefinitionModelLite = GetModelTypeLiteFromSchema<
  typeof TenantDefinition.modelSchema
>;
type TenantDefinitionDocument = InstanceType<TenantDefinitionModelLite>;
type TenantDefinitionModel = GetModelTypeFromClass<typeof TenantDefinition>;

class TenantEventRecord extends BaseModel {
  static get modelSchema() {
    return {
      organization: organizationField,
      uuid: { type: String, required: true, unique: true },
      definition: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'TenantDefinition',
        required: true,
      },
      actor: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
      },
      values: {
        type: [
          {
            itemCode: { type: String, required: true },
            value: { type: mongoose.Schema.Types.Mixed, required: true },
          },
        ],
        required: true,
        default: [],
      },
      recordedAt: { type: Date, required: true, default: Date.now },
    } as const;
  }

  static get schemaOptions() {
    return {
      timestamps: { createdAt: true, updatedAt: false },
    } as const;
  }

  static initHooks(schema: Schema) {
    tenantScoped(schema);
    schema.pre('save', function rejectEdits() {
      if (!this.isNew && this.isModified()) {
        throw new Error('record is append-only');
      }
    });

    for (const operation of [
      'updateOne',
      'updateMany',
      'findOneAndUpdate',
      'findOneAndReplace',
      'replaceOne',
    ] as const) {
      schema.pre(operation, function rejectUpdate() {
        throw new Error('record is append-only');
      });
    }
  }
}

type TenantEventModelLite = GetModelTypeLiteFromSchema<
  typeof TenantEventRecord.modelSchema,
  typeof TenantEventRecord.schemaOptions
>;
type TenantEventDocument = InstanceType<TenantEventModelLite>;
type TenantEventModel = GetModelTypeFromClass<typeof TenantEventRecord>;

export async function checkTenantScopedPatterns(
  Definition: TenantDefinitionModel,
  EventRecord: TenantEventModel,
) {
  const definition = await Definition.findOne();
  if (definition) {
    const organization: Types.ObjectId = definition.organization;
    const state: 'draft' | 'active' | 'closed' = definition.state;
    const item = definition.items[0];
    const itemType: 'numeric' | 'single' | 'multiple' | 'text' = item.type;
    const itemId: Types.ObjectId = item._id;
    const tag: number | undefined = item.tags[0];
    const optionCode: string | undefined = item.options[0]?.code;
    // Mongoose currently exposes the `_id: false` schema marker itself as an
    // `unknown` property in InferRawDocType even though no runtime path exists.
    // The useful scale fields remain precise; the marker mismatch is recorded
    // separately as an upstream inference boundary.
    const scaleMinimum: number | null | undefined = item.scale?.min;
    const count: number = definition.itemCount;
    const dto = definition.serialize();
    const dtoType: 'numeric' | 'single' | 'multiple' | 'text' | undefined =
      dto.items[0]?.type;

    await Definition.findActive(organization);
    void [
      state,
      itemType,
      itemId,
      tag,
      optionCode,
      scaleMinimum,
      count,
      dtoType,
    ];
  }

  const eventRecord = await EventRecord.findOne();
  if (eventRecord) {
    const eventDocument: TenantEventDocument = eventRecord;
    const definition: Types.ObjectId = eventRecord.definition;
    const recordedAt: Date = eventRecord.recordedAt;
    const createdAt: Date = eventRecord.createdAt;
    const storedValue: unknown = eventRecord.values[0]?.value;
    // @ts-expect-error created-only timestamps must not expose updatedAt
    eventRecord.updatedAt;
    void [eventDocument, definition, recordedAt, createdAt, storedValue];
  }
}

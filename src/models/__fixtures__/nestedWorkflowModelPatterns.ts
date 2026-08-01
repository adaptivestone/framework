/**
 * Compile-time coverage for nested workflow model patterns.
 *
 * This fixture deliberately keeps the business names generic while preserving
 * the type-sensitive shapes: required-message tuples, ObjectId arrays,
 * generated subdocument ids, nested `{ type: { ... } }` objects, projections
 * through the native collection, document/query hooks, virtuals, and custom
 * statics/instance methods.
 */

import {
  Schema as MongooseSchema,
  type Query,
  type Schema,
  Types,
} from 'mongoose';
import type {
  GetModelTypeFromClass,
  GetModelTypeLiteFromSchema,
} from '../../modules/BaseModel.ts';
import { BaseModel } from '../../modules/BaseModel.ts';

const WORKFLOW_STATES = ['pending', 'active', 'complete'] as const;

class NestedWorkflowRecord extends BaseModel {
  static get modelSchema() {
    return {
      code: {
        type: String,
        required: [true, 'crud.mandatory'],
      },
      state: {
        type: String,
        enum: WORKFLOW_STATES,
        required: [true, 'crud.mandatory'],
        default: 'pending',
      },
      relatedEntityIds: {
        type: [MongooseSchema.Types.ObjectId],
        ref: 'RelatedEntity',
      },
      entries: {
        type: [
          {
            _id: {
              type: MongooseSchema.Types.ObjectId,
              default: () => new Types.ObjectId(),
            },
            target: {
              type: MongooseSchema.Types.ObjectId,
              ref: 'RelatedEntity',
              required: [true, 'crud.mandatory'],
            },
            sourceEntry: {
              type: MongooseSchema.Types.ObjectId,
              ref: 'NestedWorkflowRecord.entries',
              required: false,
            },
            amount: {
              type: Number,
              required: [true, 'crud.mandatory'],
              min: 1,
            },
            value: {
              type: Number,
              required: [true, 'crud.mandatory'],
              min: 0,
            },
            flagged: { type: Boolean, default: false },
            allocation: {
              type: {
                _id: false,
                primary: { type: Number, default: 0, min: 0 },
                secondary: { type: Number, default: 0, min: 0 },
              },
            },
          },
        ],
        default: [],
      },
    } as const;
  }

  static get modelVirtuals() {
    return {
      hasFlaggedEntries: {
        options: { type: Boolean },
        get(this: NestedWorkflowDocument): boolean {
          return this.entries.some((entry) => entry.flagged === true);
        },
      },
    } as const;
  }

  static get modelInstanceMethods() {
    return {
      calculateTotal(this: NestedWorkflowDocument): number {
        return this.entries.reduce(
          (sum, entry) => sum + entry.amount * entry.value,
          0,
        );
      },
      targetIds(this: NestedWorkflowDocument): Types.ObjectId[] {
        return this.entries.map((entry) => entry.target);
      },
    } as const;
  }

  static get modelStatics() {
    return {
      findForRelatedEntity(
        this: NestedWorkflowModelLite,
        relatedEntityId: Types.ObjectId,
      ) {
        return this.find({ relatedEntityIds: relatedEntityId }).sort({
          createdAt: -1,
        });
      },
      async readItemProjection(
        this: NestedWorkflowModelLite,
        ids: Types.ObjectId[],
      ) {
        return this.collection
          .find<{
            _id: Types.ObjectId;
            entries: Array<{
              _id: Types.ObjectId;
              target: Types.ObjectId;
              amount: number;
            }>;
          }>({ 'entries._id': { $in: ids } }, { projection: { entries: 1 } })
          .toArray();
      },
    } as const;
  }

  static initHooks(schema: Schema) {
    schema.pre(
      'save',
      function rememberStatus(
        this: NestedWorkflowDocument & {
          $locals: { previousState?: string };
        },
      ) {
        this.$locals.previousState = this.state;
        const code: string = this.code;
        void code;
      },
    );

    schema.pre(
      'findOneAndDelete',
      function protectSubmitted(this: Query<unknown, NestedWorkflowDocument>) {
        const filter: Record<string, unknown> = this.getFilter();
        this.where({ ...filter, state: 'pending' });
      },
    );
  }
}

type NestedWorkflowModelLite = GetModelTypeLiteFromSchema<
  typeof NestedWorkflowRecord.modelSchema
>;
type NestedWorkflowDocument = InstanceType<NestedWorkflowModelLite>;
type NestedWorkflowModel = GetModelTypeFromClass<typeof NestedWorkflowRecord>;

export async function checkNestedWorkflowPatterns(M: NestedWorkflowModel) {
  const relatedEntityId = new Types.ObjectId();
  const targetId = new Types.ObjectId();
  const itemId = new Types.ObjectId();

  const created = await M.create({
    code: 'record-100',
    state: 'pending',
    relatedEntityIds: [relatedEntityId],
    entries: [
      {
        _id: itemId,
        target: targetId,
        amount: 2,
        value: 12,
        allocation: { primary: 2, secondary: 0 },
      },
    ],
  });

  const code: string = created.code;
  const state: 'pending' | 'active' | 'complete' = created.state;
  const relatedEntityIds: Types.ObjectId[] = created.relatedEntityIds;
  const firstItem = created.entries[0];
  const itemIdType: Types.ObjectId = firstItem._id;
  const target: Types.ObjectId = firstItem.target;
  const amount: number = firstItem.amount;
  const sourceEntry: Types.ObjectId | null | undefined = firstItem.sourceEntry;
  const primaryAllocation: number | null | undefined =
    firstItem.allocation?.primary;
  const total: number = created.calculateTotal();
  const flagged: boolean = created.hasFlaggedEntries;

  await M.findForRelatedEntity(relatedEntityId);
  const projection = await M.readItemProjection([itemId]);
  const projectedAmount: number | undefined = projection[0]?.entries[0]?.amount;

  const recoveredModel = created.$model<NestedWorkflowModelLite>();
  await recoveredModel.updateOne(
    { _id: created._id },
    { $set: { state: 'active' } },
  );

  void [
    code,
    state,
    relatedEntityIds,
    itemIdType,
    target,
    amount,
    sourceEntry,
    primaryAllocation,
    total,
    flagged,
    projectedAmount,
  ];
}

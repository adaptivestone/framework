/**
 * Type-level fixture (compiled by the `ModelTyping.typecheck.test.ts` tsc-gate,
 * excluded from the build). Pins the reduced schema-derived model type used in
 * a `this:` context while the full class is still being authored.
 *
 *  - as a `this:` **Model** type in a static — native Mongoose reads, writes,
 *    aggregation, bulk operations, and constructors stay available;
 *  - through `InstanceType<…>`, a document with precise access and mutation;
 *  - in instance methods, async virtuals, and `initHooks` pre-hook contexts;
 *  - custom schema options including disabled, one-sided, and renamed
 *    timestamps.
 *
 * There is one runtime schema. "Lite" describes only this incomplete authoring
 * view: TypeScript cannot resolve the class member currently being inferred.
 * Exported/generated handles use the complete class-derived model type.
 */

import { Schema, type Types } from 'mongoose';
import type {
  GetModelTypeFromClass,
  GetModelTypeLiteFromSchema,
} from '../../modules/BaseModel.ts';
import { BaseModel } from '../../modules/BaseModel.ts';

class Account extends BaseModel {
  static get modelSchema() {
    return {
      email: { type: String, required: true },
      active: { type: Boolean, default: false },
      labels: [String],
      roleIds: [{ type: Schema.Types.ObjectId, ref: 'Role' }],
    } as const;
  }

  static get modelVirtuals() {
    return {
      roleCount: {
        options: { type: Number },
        async get(this: AccountSchemaDocument): Promise<number> {
          return this.roleIds.length;
        },
      },
      populatedRoles: {
        options: {
          ref: 'Role',
          localField: 'roleIds',
          foreignField: '_id',
        },
      },
    } as const;
  }

  static get modelInstanceMethods() {
    return {
      addLabel: async function addLabel(
        this: AccountSchemaDocument,
        label: string,
      ) {
        this.labels.push(label);
        await this.save();
      },
      loadRoles: async function loadRoles(this: AccountSchemaDocument) {
        const populated = await this.populate<{
          roleIds: Array<{ _id: Types.ObjectId; name: string }>;
        }>('roleIds');
        return populated.roleIds;
      },
    } as const;
  }

  static get modelStatics() {
    return {
      findActive: async function findActive(this: AccountModelLite) {
        const list = await this.find({ active: true });
        const first = list[0];
        const email: string | undefined = first?.email; // precise field access
        return email;
      },
      rebuild: async function rebuild(this: AccountModelLite) {
        const aggregateRows = await this.aggregate<{ email: string }>([
          { $match: { active: true } },
          { $project: { email: 1 } },
        ]);
        const rawRows = await this.collection
          .aggregate<{ email: string }>([
            { $match: { active: true } },
            { $project: { email: 1 } },
          ])
          .toArray();
        await this.bulkWrite([
          {
            updateMany: {
              filter: { active: true },
              update: { $set: { active: false } },
            },
          },
        ]);
        await this.collection.bulkWrite([
          {
            updateOne: {
              filter: { email: 'a@b.io' },
              update: { $set: { active: false } },
            },
          },
        ]);
        return [...aggregateRows, ...rawRows];
      },
    };
  }

  static initHooks(schema: Schema) {
    schema.pre('save', async function preSave(this: AccountSchemaDocument) {
      // `this` is the document — fields are typed:
      const email: string = this.email;
      void email;
    });
  }
}

type AccountModelLite = GetModelTypeLiteFromSchema<typeof Account.modelSchema>;
type AccountSchemaDocument = InstanceType<AccountModelLite>;
type AccountHandle = GetModelTypeFromClass<typeof Account>;

export function asDocument(doc: AccountSchemaDocument) {
  const id: string = doc.id; // Mongoose's default top-level id virtual
  const email: string = doc.email; // required → non-null
  const active: boolean | null | undefined = doc.active;
  const labels: string[] = doc.labels;
  doc.roleIds[0]?.toHexString();
  void [id, email, active, labels];
}

// The schema-derived type preserves the native Mongoose model surface used by
// common statics, controllers, services, commands, and tests.
export async function asModel(M: AccountModelLite) {
  const one = await M.findOne({ email: 'a@b.io' });
  const email: string | undefined = one?.email;
  const found = await M.find({ active: true }).lean();
  const created = await M.create({ email: 'created@b.io' });
  const inserted = await M.insertMany([{ email: 'inserted@b.io' }]);
  const constructed = new M({ email: 'new@b.io' });
  const modelFromDocument = created.$model<AccountModelLite>();
  await modelFromDocument.findById(created._id);
  await M.updateOne({ email: 'a@b.io' }, { $set: { active: false } });
  await M.findOneAndUpdate({ email: 'a@b.io' }, { $set: { active: true } });
  await M.findByIdAndUpdate(created._id, { $set: { active: true } });
  await M.exists({ email: 'a@b.io' });
  await M.deleteMany({ active: false });
  await M.findOneAndDelete({ email: 'old@b.io' });
  const count: number = await M.countDocuments({ active: true });
  const emails = await M.distinct('email');
  const aggregateRows = await M.aggregate<{ email: string }>([
    { $match: { active: true } },
  ]);
  await M.bulkWrite([
    {
      updateOne: {
        filter: { email: 'a@b.io' },
        update: { $set: { active: false } },
      },
    },
  ]);

  const createdDocument: AccountSchemaDocument = created;
  const insertedDocument: AccountSchemaDocument | undefined = inserted[0];
  const constructedDocument: AccountSchemaDocument = constructed;
  const foundLabel: string | undefined = found[0]?.labels[0];
  const aggregateEmail: string | undefined = aggregateRows[0]?.email;
  void [
    email,
    count,
    emails,
    createdDocument,
    insertedDocument,
    constructedDocument,
    foundLabel,
    aggregateEmail,
  ];
}

// The exported/generated class-derived handle adds the authored statics,
// methods, and virtuals to the same schema-derived field surface.
export async function asCompleteModel(M: AccountHandle) {
  await M.findActive();
  await M.rebuild();
  const doc = await M.findOne();
  if (doc) {
    await doc.addLabel('reviewed');
    const roles = await doc.loadRoles();
    const roleCount: number = await doc.roleCount;
    const roleName: string | undefined = roles[0]?.name;
    void [roleCount, roleName];
  }
}

class Rollup extends BaseModel {
  static get modelSchema() {
    return {
      productId: { type: Schema.Types.ObjectId, required: true },
      month: { type: Date, required: true },
      updatedAt: { type: Date, default: () => new Date() },
    } as const;
  }

  static get schemaOptions() {
    return {
      ...BaseModel.schemaOptions,
      timestamps: false,
      collection: 'rollups',
    } as const;
  }
}

type RollupModelLite = GetModelTypeLiteFromSchema<
  typeof Rollup.modelSchema,
  typeof Rollup.schemaOptions
>;
type RollupDocument = InstanceType<RollupModelLite>;

export function customSchemaOptions(doc: RollupDocument) {
  const updatedAt: Date | null | undefined = doc.updatedAt;
  // @ts-expect-error timestamps:false must not add BaseModel's createdAt field
  doc.createdAt;
  void updatedAt;
}

class CreatedOnlyAudit extends BaseModel {
  static get modelSchema() {
    return {
      event: { type: String, required: true },
    } as const;
  }

  static get schemaOptions() {
    return {
      timestamps: { createdAt: true, updatedAt: false },
    } as const;
  }
}

type CreatedOnlyAuditModelLite = GetModelTypeLiteFromSchema<
  typeof CreatedOnlyAudit.modelSchema,
  typeof CreatedOnlyAudit.schemaOptions
>;
type CreatedOnlyAuditDocument = InstanceType<CreatedOnlyAuditModelLite>;
type CreatedOnlyAuditHandle = GetModelTypeFromClass<typeof CreatedOnlyAudit>;

export function oneSidedTimestamps(doc: CreatedOnlyAuditDocument) {
  const createdAt: Date = doc.createdAt;
  // @ts-expect-error updatedAt:false removes the runtime timestamp path
  doc.updatedAt;
  void createdAt;
}

export async function classDerivedOneSidedTimestamps(
  M: CreatedOnlyAuditHandle,
) {
  const doc = await M.findOne();
  if (doc) {
    const createdAt: Date = doc.createdAt;
    // @ts-expect-error class-derived types use the same timestamp resolution
    doc.updatedAt;
    void createdAt;
  }
}

class RenamedAuditTimestamps extends BaseModel {
  static get modelSchema() {
    return {
      event: { type: String, required: true },
    } as const;
  }

  static get schemaOptions() {
    return {
      timestamps: {
        createdAt: 'created_on',
        updatedAt: 'updated_on',
      },
    } as const;
  }
}

type RenamedAuditModelLite = GetModelTypeLiteFromSchema<
  typeof RenamedAuditTimestamps.modelSchema,
  typeof RenamedAuditTimestamps.schemaOptions
>;
type RenamedAuditDocument = InstanceType<RenamedAuditModelLite>;

export function renamedTimestamps(doc: RenamedAuditDocument) {
  const createdOn: Date = doc.created_on;
  const updatedOn: Date = doc.updated_on;
  // @ts-expect-error renamed timestamps do not add the default createdAt path
  doc.createdAt;
  // @ts-expect-error renamed timestamps do not add the default updatedAt path
  doc.updatedAt;
  void [createdOn, updatedOn];
}

class PartiallyRenamedAuditTimestamps extends BaseModel {
  static get modelSchema() {
    return {
      event: { type: String, required: true },
    } as const;
  }

  static get schemaOptions() {
    return {
      timestamps: { createdAt: 'created_on' },
    } as const;
  }
}

type PartiallyRenamedAuditModelLite = GetModelTypeLiteFromSchema<
  typeof PartiallyRenamedAuditTimestamps.modelSchema,
  typeof PartiallyRenamedAuditTimestamps.schemaOptions
>;
type PartiallyRenamedAuditDocument =
  InstanceType<PartiallyRenamedAuditModelLite>;

export function partiallyRenamedTimestamps(doc: PartiallyRenamedAuditDocument) {
  const createdOn: Date = doc.created_on;
  const updatedAt: Date = doc.updatedAt;
  // @ts-expect-error createdAt was renamed while omitted updatedAt stays enabled
  doc.createdAt;
  void [createdOn, updatedAt];
}

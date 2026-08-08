/**
 * Type-level fixture (compiled by `ModelTyping.typecheck.test.ts`, excluded from
 * the build). Pins runtime-accurate `_id` placement for nested definitions on
 * the hydrated surface.
 *
 * Mongoose builds a subdocument — and generates an `_id` for it — only for the
 * `{ type: { … } }` spelling. A plain nested object is a path *grouping*: at
 * runtime `doc.profile._id` is `undefined` and nothing is stored for it.
 * `InferHydratedDocType` types both spellings the same way, intersecting
 * `{ _id: ObjectId }` onto plain nested paths as well, so without a correction:
 *
 *  - `doc.profile._id` compiles for a value that is always `undefined`;
 *  - assigning the real runtime shape (`doc.profile = { first: 'a' }`) fails on
 *    a property Mongoose will never persist, pushing consumers to `Omit<…>`
 *    bridges or `unknown` casts at every nested-path call site.
 *
 * The raw surface already matches runtime and must stay untouched.
 */

import type { Model, Types } from 'mongoose';
import type { GetModelTypeFromClass } from '../../modules/BaseModel.ts';
import { BaseModel } from '../../modules/BaseModel.ts';
import type { TUser } from '../User.ts';

class NestedPathModel extends BaseModel {
  static get modelSchema() {
    return {
      title: { type: String, required: true },
      // Plain nested path — no `_id` at runtime, at any depth.
      profile: {
        first: { type: String },
        last: { type: String },
        address: {
          city: { type: String },
        },
      },
      // Single nested subdocument — Mongoose DOES generate an `_id`.
      wrapped: {
        type: {
          label: { type: String },
        },
      },
    } as const;
  }
}

type NestedPathModelType = GetModelTypeFromClass<typeof NestedPathModel>;
type NestedPathDocument = InstanceType<NestedPathModelType>;

type HasKey<T, K extends string> = K extends keyof T ? true : false;

const plainNestedPathHasNoId: HasKey<
  NonNullable<NestedPathDocument['profile']>,
  '_id'
> = false;

const deepNestedPathHasNoId: HasKey<
  NonNullable<NonNullable<NestedPathDocument['profile']>['address']>,
  '_id'
> = false;

// The framework's own `User.name` is a plain nested path — the shipped model
// must not carry a phantom `_id` either.
const frameworkUserNameHasNoId: HasKey<
  NonNullable<InstanceType<TUser>['name']>,
  '_id'
> = false;

// A real subdocument keeps its generated `_id`.
const singleNestedSubdocumentHasId: HasKey<
  NonNullable<NestedPathDocument['wrapped']>,
  '_id'
> = true;

// The raw surface already matched runtime exactly before the hydrated
// correction — no `_id` on the nested path, a real one on the subdocument — and
// must stay that way (the correction applies to hydrated documents only).
type RawDocumentOf<T> =
  T extends Model<
    infer Raw,
    infer _QueryHelpers,
    infer _InstanceMethods,
    infer _Virtuals,
    infer _HydratedDocument,
    infer _Schema
  >
    ? Raw
    : never;
type RawDocument = RawDocumentOf<NestedPathModelType>;

const rawNestedPathHasNoId: HasKey<
  NonNullable<RawDocument['profile']>,
  '_id'
> = false;

const rawSingleNestedSubdocumentHasId: HasKey<
  NonNullable<RawDocument['wrapped']>,
  '_id'
> = true;

function assertNestedPathWrites(doc: NestedPathDocument) {
  // The runtime shape assigns cleanly — no `_id`, no cast, no `Omit<…>` bridge.
  doc.profile = { first: 'Ada', last: 'Lovelace', address: { city: 'London' } };
  doc.profile = { first: 'Ada' };

  const city: string | null | undefined = doc.profile?.address?.city;

  // Subdocument ids stay reachable and typed.
  const wrappedId: Types.ObjectId | undefined = doc.wrapped?._id;

  void [city, wrappedId];
}

export async function assertRawWrites(Model: NestedPathModelType) {
  // The create/raw shape takes the runtime object as-is, with no `_id`.
  await Model.create({
    title: 'Persisted',
    profile: { first: 'Ada', address: { city: 'London' } },
  });
}

export {
  assertNestedPathWrites,
  deepNestedPathHasNoId,
  frameworkUserNameHasNoId,
  plainNestedPathHasNoId,
  rawNestedPathHasNoId,
  rawSingleNestedSubdocumentHasId,
  singleNestedSubdocumentHasId,
};

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
 * A subdocument disables its generated `_id` with either of two spellings:
 * `field: { type: { … }, _id: false }` carries the marker as a sibling of
 * `type`, `field: { type: { _id: false, … } }` carries it inside. Both build
 * the same runtime schema, so neither document surface may keep an `_id` — the
 * sibling marker used to be dropped while unwrapping to the inner definition,
 * leaving a phantom `ObjectId` on the hydrated document only. Both spellings are
 * pinned here for *single-nested* subdocuments only: on a subdocument ARRAY
 * (`field: { type: [{ … }], _id: false }`) the sibling marker is still dropped
 * and hydrated elements still carry an `_id` the runtime never generates — out
 * of scope, tracked in `.plans/refactor/done/model-typing-seam-fixes.md`.
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
      // The same subdocument with the generated `_id` disabled, spelled as a
      // sibling of `type:`…
      flagged: {
        type: {
          label: { type: String },
        },
        _id: false,
      },
      // …and spelled inside `type:`.
      inside: {
        type: {
          _id: false,
          label: { type: String },
        },
      },
    } as const;
  }
}

type NestedPathModelType = GetModelTypeFromClass<typeof NestedPathModel>;
type NestedPathDocument = InstanceType<NestedPathModelType>;

type HasKey<T, K extends string> = K extends keyof T ? true : false;

/** Invariant type identity: unlike assignability, `never` and `any` fail it. */
type Exact<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

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

const singleNestedSubdocumentIdIsObjectId: Exact<
  NonNullable<NestedPathDocument['wrapped']>['_id'],
  Types.ObjectId
> = true;

// `_id: false` takes it away — whichever of the two spellings declared it. The
// key itself comes from the subdocument base type and cannot be removed there,
// so "no id" is spelled `never`: reachable, but usable for nothing.
const siblingIdFalseHasNoUsableId: Exact<
  NonNullable<NestedPathDocument['flagged']>['_id'],
  never
> = true;

const insideIdFalseHasNoUsableId: Exact<
  NonNullable<NestedPathDocument['inside']>['_id'],
  never
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

const rawSiblingIdFalseHasNoId: HasKey<
  NonNullable<RawDocument['flagged']>,
  '_id'
> = false;

const rawInsideIdFalseHasNoId: HasKey<
  NonNullable<RawDocument['inside']>,
  '_id'
> = false;

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
  insideIdFalseHasNoUsableId,
  plainNestedPathHasNoId,
  rawInsideIdFalseHasNoId,
  rawNestedPathHasNoId,
  rawSiblingIdFalseHasNoId,
  rawSingleNestedSubdocumentHasId,
  siblingIdFalseHasNoUsableId,
  singleNestedSubdocumentHasId,
  singleNestedSubdocumentIdIsObjectId,
};

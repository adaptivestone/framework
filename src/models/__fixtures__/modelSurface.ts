/**
 * Type-level fixture (compiled by the `User.typecheck.test.ts` tsc-gate, excluded
 * from the build). Pins the *full model surface* a consumer touches on a plain
 * `BaseModel` — so the common shapes "just work" with no casts:
 *
 *  - query shapes: `find()` → array of hydrated docs, `findOne()` / `findById()`
 *    → doc | null;
 *  - custom `modelStatics` callable on the model with precise arg/return;
 *  - `modelVirtuals` read on the doc as the getter's return type — a clean
 *    `string`, NOT the raw `{ get, options }` definition leaking in;
 *  - `modelInstanceMethods` callable on the doc;
 *  - field types across array + complex forms: `enum` union, array of refs
 *    (`ObjectId[]`), subdocument array (element + `_id`), `Map` (`Record`),
 *    nested object, primitive array.
 *
 * A regression in any of these fails `tsc` here.
 */

import { Schema, type Types } from 'mongoose';
import type { GetModelTypeFromClass } from '../../modules/BaseModel.ts';
import { BaseModel } from '../../modules/BaseModel.ts';

class Order extends BaseModel {
  static get modelSchema() {
    return {
      kind: { type: String, enum: ['web', 'pos'] as const }, // enum → union
      tagIds: [{ type: Schema.Types.ObjectId, ref: 'Tag' }], // array of refs
      lines: [{ sku: { type: String }, qty: { type: Number } }], // subdoc array
      attrs: { type: Map, of: Number }, // Map → Record
      address: { city: { type: String }, zip: { type: String } }, // nested object
      labels: [String], // primitive array
    } as const;
  }

  static get modelStatics() {
    return {
      summarize(prefix: string): string {
        return prefix;
      },
    };
  }

  static get modelVirtuals() {
    return {
      displayName: {
        options: { type: Object },
        get(): string {
          return 'order';
        },
      },
    };
  }

  static get modelInstanceMethods() {
    return {
      total(): number {
        return 0;
      },
    };
  }
}

type OrderModel = GetModelTypeFromClass<typeof Order>;

export async function check(M: OrderModel) {
  // ---- query shapes ----
  const all = await M.find();
  const arrayOfDocs: number = all.length; // `find()` returns an array
  const one = await M.findOne();
  const byId = await M.findById('id');
  void [arrayOfDocs, byId];

  // ---- create(): accepts a plain object of the schema shape, returns a doc ----
  const created = await M.create({ kind: 'web', labels: ['a'] });
  created.total(); // the returned doc is hydrated (instance methods present)

  // ---- lean(): the raw document — fields present, no instance methods ----
  const lean = await M.findOne().lean();
  if (lean) {
    const leanKind: 'web' | 'pos' | null | undefined = lean.kind;
    void leanKind;
    // @ts-expect-error a lean() result is a plain object — no instance methods
    lean.total;
  }

  // ---- static (custom, callable on the model) ----
  const summary: string = M.summarize('order');
  void summary;

  if (!one) {
    return;
  }

  // ---- virtual: clean getter return type, no raw def leak ----
  const displayName: string = one.displayName;
  void displayName;
  // @ts-expect-error the raw virtual definition must NOT leak onto the doc
  one.displayName.options;

  // ---- instance method ----
  const total: number = one.total();
  void total;

  // ---- array + complex field types ----
  const kind: 'web' | 'pos' | null | undefined = one.kind; // enum union
  one.tagIds?.[0]?.toHexString(); // array of refs → real ObjectId[]
  const line = one.lines?.[0]; // subdoc array element
  const sku: string | null | undefined = line?.sku;
  const lineId: Types.ObjectId | undefined = line?._id; // subdocs get `_id`
  // Mongoose infers a `Map` field as a `Record` (runtime is a real `Map` — a
  // known Mongoose inference quirk the framework inherits):
  const attrs: Record<string, number> | null | undefined = one.attrs;
  const city: string | null | undefined = one.address?.city; // nested object
  const label: string | null | undefined = one.labels?.[0]; // primitive array
  void [kind, sku, lineId, attrs, city, label];
}

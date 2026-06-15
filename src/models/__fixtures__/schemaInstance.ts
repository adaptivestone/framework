/**
 * Type-level fixture (compiled by the `User.typecheck.test.ts` tsc-gate, excluded
 * from the build). Pins that a pre-built mongoose `Schema` INSTANCE reused as a
 * (sub-)document definition — `field: SubSchema` and `[SubSchema]`, a standard
 * Mongoose pattern — is opaque to the `__tsType` override scan.
 *
 * Regression guard for rc.8: `HasTsOverride` mapped over `keyof Schema` and a
 * Schema instance isn't a constructor, so the scan recursed into the instance's
 * self-referential internals (`childSchemas`, `options`, …) → TS2615 at every
 * `findOne()` call site. Two models below cover both override code paths:
 *  - `FileDoc` (marker-free) → exercises `HasTsOverride`'s skip (the crash path);
 *  - `FileWithMarker` (a `__tsType` elsewhere) → exercises `ApplyTsOverrides`
 *    running while a Schema-instance field is also present.
 */

import mongoose, { type Types } from 'mongoose';
import type {
  GetModelTypeFromClass,
  TsTypeOverride,
} from '../../modules/BaseModel.ts';
import { BaseModel } from '../../modules/BaseModel.ts';

/** A pre-built sub-schema instance, the way a real app shares one across models. */
const ResizedMetadata = new mongoose.Schema({
  width: Number,
  height: Number,
});

/* ---- marker-free model: hits HasTsOverride's Schema-instance skip path ---- */
class FileDoc extends BaseModel {
  static get modelSchema() {
    return {
      resizedMetadata: [ResizedMetadata], // instance in a subdoc-array def
      thumbnail: ResizedMetadata, // instance as a direct subdoc def
      name: { type: String },
    } as const;
  }
}
type TFile = GetModelTypeFromClass<typeof FileDoc>;

export async function fileCheck(M: TFile) {
  const doc = await M.findOne(); // rc.8 regressed here with TS2615
  const name: string | null | undefined = doc?.name;
  void name;
}

/* ---- Schema instance + a __tsType marker: ApplyTsOverrides must run AND treat
 * the Schema-instance field as a leaf (no recursion into its internals). ---- */
type IntlValue = { native: string; machine: string };
function intl<C extends object>(field: C) {
  return field as C & TsTypeOverride<IntlValue>;
}

class FileWithMarker extends BaseModel {
  static get modelSchema() {
    return {
      meta: ResizedMetadata, // Schema instance alongside a marker
      title: intl({ type: String }), // reshaped field → override applies
      owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    } as const;
  }
}
type TFileMarker = GetModelTypeFromClass<typeof FileWithMarker>;

export async function markerCheck(M: TFileMarker) {
  const doc = await M.findOne();
  if (doc) {
    const title: IntlValue | null | undefined = doc.title; // override still applies
    const owner: Types.ObjectId | null | undefined = doc.owner; // ref stays clean
    void [title, owner];
  }
}

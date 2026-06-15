/**
 * Type-level fixture (compiled by the `User.typecheck.test.ts` tsc-gate, excluded
 * from the build). Pins the per-field `__tsType` override: a field marked with
 * {@link TsTypeOverride} is typed as the override on `getModel(...).findOne()`
 * results (and on method `this`), at every depth — top-level, nested object, and
 * subdocument array — while unmarked fields (including arrays of primitives) keep
 * their Mongoose-inferred type. Mirrors how a runtime-reshaping plugin like
 * `mongoose-intl` keeps static and runtime types in sync.
 */

import type {
  GetModelTypeFromClass,
  TsTypeOverride,
} from '../../modules/BaseModel.ts';
import { BaseModel } from '../../modules/BaseModel.ts';

/** Stand-in for mongoose-intl's `IntlSubDocValue` (the reshaped runtime value). */
type IntlSubDocValue<T> = { native: T; machine: T };

/** Tiny app-side factory: a `String` field whose static type is an intl value.
 * Runtime is unchanged (`type: String`); only the compile-time type is marked. */
function intlString<C extends object>(field: C) {
  return field as C & TsTypeOverride<IntlSubDocValue<string>>;
}

class Event extends BaseModel {
  static get modelSchema() {
    return {
      title: intlString({ type: String, intl: true }), // top-level
      plain: { type: String }, // unmarked → string
      tags: [String], // primitive array → string[]
      organizer: { name: intlString({ type: String }) }, // nested object
      schedule: [{ title: intlString({ type: String }) }], // subdoc array
    } as const;
  }
}

type EventModel = GetModelTypeFromClass<typeof Event>;

export async function check(M: EventModel) {
  const doc = await M.findOne();
  if (doc) {
    // overridden at every depth
    const title: IntlSubDocValue<string> | null | undefined = doc.title;
    const orgName: IntlSubDocValue<string> | null | undefined =
      doc.organizer?.name;
    const schedTitle: IntlSubDocValue<string> | null | undefined =
      doc.schedule?.[0]?.title;
    // unmarked fields keep their inferred type
    const plain: string | null | undefined = doc.plain;
    const tag: string | null | undefined = doc.tags?.[0];
    void title;
    void orgName;
    void schedTitle;
    void plain;
    void tag;
  }
}

/**
 * tsc-gate fixture (compiled by `User.typecheck.test.ts`, excluded from build).
 *
 * Pins the caller-facing `this`-stripping on instance methods: a method that
 * declares an explicit `this: <bridge>` (a narrower hand-written shape its body
 * needs) must still be callable as `doc.method(...)` on the hydrated document,
 * even though that document is deliberately NOT assignable to the bridge. The
 * body stays type-checked against its declared `this`; only the caller-facing
 * projection drops the constraint — it never guards a real call, since
 * `doc.method()` always binds `this` to the document at runtime.
 *
 * Without the fix this fails with TS2684 ("'this' context ... not assignable").
 */

import type { GetModelTypeFromClass } from '../../modules/BaseModel.ts';
import { BaseModel } from '../../modules/BaseModel.ts';

/** A deliberately narrow "doc bridge" a method body assumes: a non-null,
 * reshaped `title` and a sibling method — neither guaranteed by the raw
 * hydrated doc, so the hydrated doc is NOT assignable to this. */
type BoatDoc = {
  title: { native: string };
  getSummary(this: BoatDoc): string;
};

class Boat extends BaseModel {
  static get modelSchema() {
    return {
      title: { type: String },
    } as const;
  }

  static get modelInstanceMethods() {
    return {
      getSummary(this: BoatDoc): string {
        // body relies on the narrow bridge shape (reshaped `title`)
        return this.title.native;
      },
      getPublic(
        this: BoatDoc,
        locale: string | null = null,
      ): { title: string } {
        return {
          title: locale ? `${locale}:${this.title.native}` : this.title.native,
        };
      },
      // No explicit `this` — must pass through unchanged (the no-op branch).
      label(prefix: string): string {
        return `${prefix}-boat`;
      },
    };
  }
}

type BoatModel = GetModelTypeFromClass<typeof Boat>;

export async function check(M: BoatModel) {
  const doc = await M.findOne();
  if (doc) {
    // ✅ callable on the hydrated doc despite the narrow authored `this`
    const s: string = doc.getSummary();
    // arg + return types are preserved (not stripped along with `this`)
    const pub: { title: string } = doc.getPublic('en');
    const pubDefault: { title: string } = doc.getPublic();
    // a method with no authored `this` is unaffected (arg + return preserved)
    const label: string = doc.label('sl');
    void s;
    void pub;
    void pubDefault;
    void label;
  }
}

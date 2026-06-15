/**
 * Type-level fixture (compiled by the `User.typecheck.test.ts` tsc-gate, excluded
 * from the build). Pins `GetModelTypeLiteFromSchema` — the public helper the docs
 * tell consumers to use for the `this:` context in statics, instance methods, and
 * `initHooks`, where referencing the full model type would be circular.
 *
 *  - as a `this:` **Model** type in a static — `this.find()` / `this.findOne()`
 *    resolve and return typed instances;
 *  - as `InstanceType<…>` — a **document** with precise field access;
 *  - in an `initHooks` pre-hook `this` context.
 *
 * If the lite helper stops resolving the schema (fields go `unknown`, or the
 * query helpers vanish), this file fails `tsc`.
 */

import type { Schema } from 'mongoose';
import type { GetModelTypeLiteFromSchema } from '../../modules/BaseModel.ts';
import { BaseModel } from '../../modules/BaseModel.ts';

class Account extends BaseModel {
  static get modelSchema() {
    return {
      email: { type: String, required: true },
      active: { type: Boolean, default: false },
    } as const;
  }

  static get modelStatics() {
    return {
      // The documented pattern: `this` typed via the lite helper.
      findActive: async function findActive(this: AccountLite) {
        const list = await this.find({ active: true });
        const first = list[0];
        const email: string | undefined = first?.email; // precise field access
        return email;
      },
    };
  }

  static initHooks(schema: Schema) {
    schema.pre('save', async function preSave(this: InstanceType<AccountLite>) {
      // `this` is the document — fields are typed:
      const email: string = this.email;
      void email;
    });
  }
}

/** Exactly the alias a consumer writes; avoids circular linking on the full
 * model type. */
type AccountLite = GetModelTypeLiteFromSchema<typeof Account.modelSchema>;

// `InstanceType<…>` of the lite model is the document — precise field access:
export function asDocument(doc: InstanceType<AccountLite>) {
  const email: string = doc.email; // required → non-null
  const active: boolean | null | undefined = doc.active;
  void [email, active];
}

// The lite type is a Model — query helpers resolve on it:
export async function asModel(M: AccountLite) {
  const one = await M.findOne({ email: 'a@b.io' });
  const email: string | undefined = one?.email;
  void email;
}

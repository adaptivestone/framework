/**
 * Type-level fixture (compiled by the `User.typecheck.test.ts` tsc-gate, excluded
 * from the build). Pins the documented "typing populated references" pattern
 * (docs repo `05-models.md`): a ref field marked with
 * `TsTypeOverride<Types.ObjectId | PopulatedDoc>` resolves to that union on
 * `getModel(...).findOne()`, and an `in`-narrowing check selects the populated
 * shape with no cast — while `.populate<T>()` stays available regardless. If the
 * union override or the narrowing ever regresses, this file fails `tsc`.
 */

import { Schema, type Types } from 'mongoose';
import type {
  GetModelTypeFromClass,
  TsTypeOverride,
} from '../../modules/BaseModel.ts';
import { BaseModel } from '../../modules/BaseModel.ts';

type PopulatedOwner = { email: string; name: string };

/** App-side factory: a ref field typed as the union of both states — the stored
 * `ObjectId` and the document it points to once populated. */
function ref<C extends object, T>(field: C) {
  return field as C & TsTypeOverride<Types.ObjectId | T>;
}

class Boat extends BaseModel {
  static get modelSchema() {
    return {
      owner: ref<
        { type: typeof Schema.Types.ObjectId; ref: 'User' },
        PopulatedOwner
      >({ type: Schema.Types.ObjectId, ref: 'User' }),
    } as const;
  }
}

type BoatModel = GetModelTypeFromClass<typeof Boat>;

export async function check(M: BoatModel) {
  const boat = await M.findOne();
  if (!boat) {
    return;
  }

  // The marked union is what the field resolves to (no cast):
  const owner: Types.ObjectId | PopulatedOwner | undefined = boat.owner;
  void owner;

  // `in`-narrowing selects the populated shape:
  if (boat.owner && 'email' in boat.owner) {
    const email: string = boat.owner.email;
    void email;
  } else if (boat.owner) {
    // the other arm is the stored id — a real ObjectId, methods callable:
    boat.owner.toHexString();
  }

  // `.populate<T>()` stays available on any ref, marked or not:
  const populated = await boat.populate<{ owner: PopulatedOwner }>('owner');
  const email: string = populated.owner.email;
  void email;
}

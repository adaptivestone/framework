/**
 * Compile-time coverage for schema-level lean defaults.
 *
 * Mongoose reads the `lean` default from the model's Schema generic. Both the
 * complete class-derived model and the reduced schema-derived authoring model
 * must therefore return plain objects by default while preserving an explicit
 * `{ lean: false }` escape hatch to hydrated documents.
 */

import type {
  GetModelTypeFromClass,
  GetModelTypeLiteFromSchema,
} from '../../modules/BaseModel.ts';
import { BaseModel } from '../../modules/BaseModel.ts';

class LeanDefaultRecord extends BaseModel {
  static get modelSchema() {
    return {
      title: { type: String, required: true },
      active: { type: Boolean, default: true },
    } as const;
  }

  static get schemaOptions() {
    return { lean: true } as const;
  }
}

type LeanDefaultAuthoringModel = GetModelTypeLiteFromSchema<
  typeof LeanDefaultRecord.modelSchema,
  typeof LeanDefaultRecord.schemaOptions
>;
type LeanDefaultCompleteModel = GetModelTypeFromClass<typeof LeanDefaultRecord>;

async function checkLeanDefaults(Model: LeanDefaultAuthoringModel) {
  const one = await Model.findOne();
  if (one) {
    const title: string = one.title;
    // @ts-expect-error schema-level lean returns a plain object by default
    one.save();
    void title;
  }

  const list = await Model.find();
  const firstTitle: string | undefined = list[0]?.title;
  // @ts-expect-error schema-level lean applies to array query results too
  list[0]?.save();

  const updated = await Model.findOneAndUpdate(
    { active: true },
    { $set: { active: false } },
  );
  if (updated) {
    const active: boolean | null | undefined = updated.active;
    // @ts-expect-error findOneAndUpdate inherits the schema-level lean default
    updated.save();
    void active;
  }

  const hydrated = await Model.findOne({}, null, { lean: false });
  if (hydrated) {
    const title: string = hydrated.title;
    await hydrated.save();
    void title;
  }

  const hydratedList = await Model.find({}, null, { lean: false });
  await hydratedList[0]?.save();

  const hydratedUpdate = await Model.findOneAndUpdate(
    { active: false },
    { $set: { active: true } },
    { lean: false },
  );
  await hydratedUpdate?.save();

  void firstTitle;
}

export async function schemaDerivedLeanDefaults(
  Model: LeanDefaultAuthoringModel,
) {
  await checkLeanDefaults(Model);
}

export async function classDerivedLeanDefaults(
  Model: LeanDefaultCompleteModel,
) {
  const plain = await Model.findById('record-id');
  if (plain) {
    const title: string = plain.title;
    // @ts-expect-error the complete model inherits the same lean default
    plain.save();
    void title;
  }

  const hydrated = await Model.findById('record-id', null, { lean: false });
  await hydrated?.save();

  // A complete model must remain usable wherever an unfinished static declared
  // the reduced authoring model as its `this` context.
  await checkLeanDefaults(Model);
}

class LeanOptionsRecord extends BaseModel {
  static get modelSchema() {
    return {
      code: { type: String, required: true },
    } as const;
  }

  static get schemaOptions() {
    return { lean: { versionKey: false } } as const;
  }
}

type LeanOptionsAuthoringModel = GetModelTypeLiteFromSchema<
  typeof LeanOptionsRecord.modelSchema,
  typeof LeanOptionsRecord.schemaOptions
>;

export async function objectFormLeanDefault(Model: LeanOptionsAuthoringModel) {
  const plain = await Model.findById('record-id');
  if (plain) {
    const code: string = plain.code;
    // @ts-expect-error an object-form schema lean option also enables lean
    plain.save();
    void code;
  }

  const hydrated = await Model.findById('record-id', null, { lean: false });
  await hydrated?.save();
}

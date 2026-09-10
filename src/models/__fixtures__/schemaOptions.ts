/** Compile-time coverage for schema options that change Mongoose inference. */

import type { Model } from 'mongoose';
import type {
  GetModelTypeFromClass,
  GetModelTypeLiteFromSchema,
  TsTypeOverride,
} from '../../modules/BaseModel.ts';
import { BaseModel } from '../../modules/BaseModel.ts';

type StoredLocale = Partial<Record<'en' | 'fr', string>>;
type VisibleLocale = string | StoredLocale;

function localeField<C extends object>(field: C) {
  return field as C & TsTypeOverride<StoredLocale, VisibleLocale>;
}

type RawDocumentOf<M> =
  M extends Model<infer Raw, infer _Q, infer _I, infer _V, infer _H, infer _S>
    ? Raw
    : never;

type HasKey<T, K extends PropertyKey> = K extends keyof T ? true : false;

type Exact<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

class CustomTypeKeyRecord extends BaseModel {
  static get modelSchema() {
    return {
      title: { $type: String, required: true },
      count: { $type: Number, required: true },
      localized: localeField({ $type: String, required: true }),
      localizedItems: {
        $type: [
          {
            title: localeField({ $type: String, required: true }),
            count: { $type: Number, required: true },
            profile: { label: { $type: String } },
          },
        ],
      },
    } as const;
  }

  static get schemaOptions() {
    return { typeKey: '$type', timestamps: false } as const;
  }
}

type CustomModel = GetModelTypeFromClass<typeof CustomTypeKeyRecord>;
type CustomDocument = InstanceType<CustomModel>;
type CustomRaw = RawDocumentOf<CustomModel>;

type CustomLite = GetModelTypeLiteFromSchema<
  typeof CustomTypeKeyRecord.modelSchema,
  typeof CustomTypeKeyRecord.schemaOptions
>;
const customLiteTitle: Exact<InstanceType<CustomLite>['title'], string> = true;
const customLiteItem: Exact<
  InstanceType<CustomLite>['localizedItems'][number]['title'],
  VisibleLocale
> = true;
const customRawItem: Exact<
  CustomRaw['localizedItems'][number]['title'],
  StoredLocale
> = true;
export async function checkCustomLean(Model: CustomModel, Lite: CustomLite) {
  const doc = await Model.findOne().lean().orFail();
  const lite = await Lite.findOne().lean().orFail();
  const rawTitle: Exact<
    (typeof doc.localizedItems)[number]['title'],
    StoredLocale
  > = true;
  const liteRawTitle: Exact<
    (typeof lite.localizedItems)[number]['title'],
    StoredLocale
  > = true;
  void [rawTitle, liteRawTitle];
}

const customTitle: Exact<CustomDocument['title'], string> = true;
const customCount: Exact<CustomDocument['count'], number> = true;
const customRawTitle: Exact<CustomRaw['title'], string> = true;
type CustomDocumentLocalized = CustomDocument['localized'];
const customLocalized: Exact<CustomDocumentLocalized, VisibleLocale> = true;
const customLocalizedItem: Exact<
  NonNullable<CustomDocument['localizedItems']>[number]['title'],
  VisibleLocale
> = true;
const customItemCount: Exact<
  CustomDocument['localizedItems'][number]['count'],
  number
> = true;
const customRawItemCount: Exact<
  CustomRaw['localizedItems'][number]['count'],
  number
> = true;
const customItemProfileNoId: HasKey<
  NonNullable<CustomDocument['localizedItems'][number]['profile']>,
  '_id'
> = false;
const noDefaultCreatedAt: HasKey<CustomDocument, 'createdAt'> = false;

class NoIdRecord extends BaseModel {
  static get modelSchema() {
    return { title: { type: String, required: true } } as const;
  }

  static get schemaOptions() {
    return { _id: false, timestamps: false } as const;
  }
}

type NoIdModel = GetModelTypeFromClass<typeof NoIdRecord>;
type NoIdDocument = InstanceType<NoIdModel>;
type NoIdRaw = RawDocumentOf<NoIdModel>;

const noTopLevelHydratedId: Exact<NoIdDocument['_id'], undefined> = true;
const noTopLevelIdVirtual: HasKey<NoIdDocument, 'id'> = false;
const noTopLevelRawId: Exact<NoIdRaw['_id'], undefined> = true;
type NoIdLite = GetModelTypeLiteFromSchema<
  typeof NoIdRecord.modelSchema,
  typeof NoIdRecord.schemaOptions
>;
const noLiteId: Exact<InstanceType<NoIdLite>['_id'], undefined> = true;
export async function checkDisabledId(Model: NoIdModel, Lite: NoIdLite) {
  const doc = await Model.findOne().lean().orFail();
  const lite = await Lite.findOne().lean().orFail();
  const noLeanId: Exact<typeof doc._id, undefined> = true;
  const noLiteLeanId: Exact<typeof lite._id, undefined> = true;
  void [noLeanId, noLiteLeanId];
}
class ExplicitIdRecord extends NoIdRecord {
  static get modelSchema() {
    return {
      ...super.modelSchema,
      _id: { type: String, required: true },
    } as const;
  }
}
const explicitId: Exact<
  InstanceType<GetModelTypeFromClass<typeof ExplicitIdRecord>>['_id'],
  string
> = true;

class RenamedTimestampRecord extends BaseModel {
  static get modelSchema() {
    return { title: { type: String, required: true } } as const;
  }

  static get schemaOptions() {
    return {
      timestamps: { createdAt: 'madeAt', updatedAt: 'changedAt' },
    } as const;
  }
}

type RenamedDocument = InstanceType<
  GetModelTypeFromClass<typeof RenamedTimestampRecord>
>;
type RenamedLiteDocument = InstanceType<
  GetModelTypeLiteFromSchema<
    typeof RenamedTimestampRecord.modelSchema,
    typeof RenamedTimestampRecord.schemaOptions
  >
>;

const madeAt: Exact<RenamedDocument['madeAt'], Date> = true;
const changedAt: Exact<RenamedDocument['changedAt'], Date> = true;
const liteMadeAt: Exact<RenamedLiteDocument['madeAt'], Date> = true;
const noCreatedAt: HasKey<RenamedDocument, 'createdAt'> = false;

void [
  customTitle,
  customCount,
  customRawTitle,
  customLocalized,
  customLocalizedItem,
  noDefaultCreatedAt,
  noTopLevelHydratedId,
  noTopLevelRawId,
  madeAt,
  changedAt,
  liteMadeAt,
  noCreatedAt,
];

export {
  changedAt,
  customCount,
  customItemCount,
  customItemProfileNoId,
  customLiteItem,
  customLiteTitle,
  customLocalized,
  customLocalizedItem,
  customRawItem,
  customRawItemCount,
  customRawTitle,
  customTitle,
  explicitId,
  liteMadeAt,
  madeAt,
  noCreatedAt,
  noDefaultCreatedAt,
  noLiteId,
  noTopLevelHydratedId,
  noTopLevelIdVirtual,
  noTopLevelRawId,
};

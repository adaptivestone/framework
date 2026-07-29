/**
 * Type-level fixture (compiled by `ModelTyping.typecheck.test.ts`, excluded from the
 * build). Pins readonly-schema inference at the framework boundary.
 *
 * Mongoose's `InferRawDocType` recognizes mutable required-message tuples and
 * mutable array definitions, while TypeScript's recommended `as const` spelling
 * makes both readonly. The framework must normalize only that readonly surface
 * before inference so:
 *
 *  - `required: [true, message]` remains required;
 *  - direct and `{ type: [...] }` arrays keep Mongoose's non-null array type;
 *  - explicit `required: false` and `default: undefined | null` stay optional.
 */

import type {
  GetModelTypeFromClass,
  GetModelTypeLiteFromSchema,
} from '../../modules/BaseModel.ts';
import { BaseModel } from '../../modules/BaseModel.ts';

const readonlySchema = {
  title: {
    type: String,
    required: [true, 'title is required'],
  },
  tags: [String],
  labels: {
    type: [String],
  },
  lines: [
    {
      sku: { type: String, required: true },
    },
  ],
  optionalNote: {
    type: String,
    required: false,
  },
  deferredTags: {
    type: [String],
    default: undefined,
  },
  nullableTags: {
    type: [String],
    default: null,
  },
} as const;

class ReadonlySchemaModel extends BaseModel {
  static get modelSchema() {
    return readonlySchema;
  }
}

type FullModel = GetModelTypeFromClass<typeof ReadonlySchemaModel>;
type LiteModel = GetModelTypeLiteFromSchema<typeof readonlySchema>;

function assertDocumentShape(
  doc: InstanceType<FullModel> | InstanceType<LiteModel>,
) {
  // Required-message tuple: no spurious `| null | undefined`.
  const title: string = doc.title;

  // Every ordinary array spelling follows Mongoose's default `[]` contract.
  const tags: string[] = doc.tags;
  const labels: string[] = doc.labels;
  const lines: { sku: string }[] = doc.lines;

  // Explicit opt-outs remain optional after readonly normalization.
  const optionalNoteNull: typeof doc.optionalNote = null;
  const optionalNoteUndefined: typeof doc.optionalNote = undefined;
  const deferredTagsNull: typeof doc.deferredTags = null;
  const deferredTagsUndefined: typeof doc.deferredTags = undefined;
  const nullableTagsNull: typeof doc.nullableTags = null;
  const nullableTagsUndefined: typeof doc.nullableTags = undefined;

  void [
    title,
    tags,
    labels,
    lines,
    optionalNoteNull,
    optionalNoteUndefined,
    deferredTagsNull,
    deferredTagsUndefined,
    nullableTagsNull,
    nullableTagsUndefined,
  ];
}

export async function checkFullModel(Model: FullModel) {
  const doc = await Model.findOne();
  if (doc) {
    assertDocumentShape(doc);
  }
}

export function checkLiteDocument(doc: InstanceType<LiteModel>) {
  assertDocumentShape(doc);
}

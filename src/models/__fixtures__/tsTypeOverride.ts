/**
 * Type-level fixture (compiled by the `ModelTyping.typecheck.test.ts` tsc-gate, excluded
 * from the build). Pins the per-field `__tsType` override: a field marked with
 * {@link TsTypeOverride} can expose one type on raw/create/lean values and a
 * different type on hydrated documents, at every depth — top-level, nested
 * object, and subdocument array. Its one-argument form remains the same type on
 * both surfaces. Unmarked fields (including arrays of primitives and built-in
 * instances like ObjectId refs / Date, which stay clean and usable rather than
 * being mapped over) keep their Mongoose-inferred type.
 */

import { Schema, type Types } from 'mongoose';
import type {
  GetModelTypeFromClass,
  GetModelTypeLiteFromSchema,
  TsTypeOverride,
} from '../../modules/BaseModel.ts';
import { BaseModel } from '../../modules/BaseModel.ts';

/** Stand-in for mongoose-intl's `IntlSubDocValue` (the reshaped runtime value). */
type IntlSubDocValue<T> = { native: T; machine: T };
type IntlText = Partial<Record<'en' | 'fr', string>>;
type IntlHydratedValue = string | IntlText;

/** Tiny app-side factory: a `String` field whose static type is an intl value.
 * Runtime is unchanged (`type: String`); only the compile-time type is marked. */
function intlString<C extends object>(field: C) {
  return field as C & TsTypeOverride<IntlSubDocValue<string>>;
}

/** A plugin stores a locale map but its virtual getter normally returns the
 * selected string and can expose the full map in an explicit document mode. */
function localeString<C extends object>(field: C) {
  return field as C & TsTypeOverride<IntlText, IntlHydratedValue>;
}

class Event extends BaseModel {
  static get modelSchema() {
    return {
      title: intlString({ type: String, intl: true }), // top-level
      plain: { type: String }, // unmarked → string
      tags: [String], // primitive array → string[]
      owner: { type: Schema.Types.ObjectId, ref: 'User' }, // ref → ObjectId
      startsAt: { type: Date }, // built-in instance → Date
      organizer: { name: intlString({ type: String }) }, // nested object
      schedule: [{ title: intlString({ type: String }) }], // subdoc array
      // deepest combined path: marker in a nested object INSIDE a subdoc array
      // (array → object → field) — exercises HasTsOverride's full recursion.
      sessions: [{ room: { label: intlString({ type: String }) } }],
      localizedTitle: localeString({
        type: String,
        required: true,
        intl: true,
      }),
      localizedSchedule: [
        {
          title: localeString({
            type: String,
            required: true,
            intl: true,
          }),
        },
      ],
    } as const;
  }
}

type EventModel = GetModelTypeFromClass<typeof Event>;
type EventAuthoringModel = GetModelTypeLiteFromSchema<typeof Event.modelSchema>;

export async function checkAuthoringModel(M: EventAuthoringModel) {
  const created = await M.create({
    localizedTitle: { en: 'Title', fr: 'Titre' },
  });
  const hydratedStringState: typeof created.localizedTitle = 'Title';
  void hydratedStringState;

  const lean = await M.findOne().lean();
  if (lean) {
    const rawTitle: IntlText = lean.localizedTitle;
    // @ts-expect-error the reduced model also keeps strings off the raw surface
    const invalidRawTitle: typeof lean.localizedTitle = 'Title';
    void rawTitle;
    void invalidRawTitle;
  }
}

export async function check(M: EventModel) {
  const created = await M.create({
    localizedTitle: { en: 'Title', fr: 'Titre' },
    localizedSchedule: [{ title: { en: 'Session', fr: 'Séance' } }],
  });
  const createdTitle: IntlHydratedValue = created.localizedTitle;
  const createdScheduleTitle: IntlHydratedValue =
    created.localizedSchedule[0].title;
  const createdStringGetterState: typeof created.localizedTitle = 'Title';
  void createdTitle;
  void createdScheduleTitle;
  void createdStringGetterState;

  const doc = await M.findOne();
  if (doc) {
    // overridden at every depth
    const title: IntlSubDocValue<string> | null | undefined = doc.title;
    const orgName: IntlSubDocValue<string> | null | undefined =
      doc.organizer?.name;
    const schedTitle: IntlSubDocValue<string> | null | undefined =
      doc.schedule?.[0]?.title;
    const createdScheduleItem = doc.schedule.create({
      title: { native: 'Session', machine: 'Session' },
    });
    doc.schedule.push(createdScheduleItem);
    const createdScheduleItemId: Types.ObjectId = createdScheduleItem._id;
    const createdScheduleTitle: IntlSubDocValue<string> | null | undefined =
      createdScheduleItem.title;
    const sessionLabel: IntlSubDocValue<string> | null | undefined =
      doc.sessions?.[0]?.room?.label; // array → nested object → marker
    // The distinct hydrated override accepts every state the plugin getter can
    // expose, while a raw locale map remains inspectable after narrowing.
    const hydratedStringState: typeof doc.localizedTitle = 'Title';
    const hydratedMapState: typeof doc.localizedTitle = { en: 'Title' };
    if (typeof doc.localizedTitle !== 'string') {
      const hydratedEnglish: string | undefined = doc.localizedTitle.en;
      void hydratedEnglish;
    }
    const localizedItem = doc.localizedSchedule.create({
      title: { en: 'Session', fr: 'Séance' },
    });
    const localizedItemTitle: IntlHydratedValue = localizedItem.title;
    const localizedItemStringGetterState: typeof localizedItem.title =
      'Session';
    doc.localizedSchedule.push(localizedItem);
    void sessionLabel;
    void hydratedStringState;
    void hydratedMapState;
    void localizedItemTitle;
    void localizedItemStringGetterState;
    // unmarked fields keep their inferred type
    const plain: string | null | undefined = doc.plain;
    const tag: string | null | undefined = doc.tags?.[0];
    // built-in instances are left clean (not mapped over): a ref stays a real
    // ObjectId and a Date stays a real Date — methods callable, no cast — even
    // though they sit on a model that uses overrides elsewhere.
    const owner: Types.ObjectId | null | undefined = doc.owner;
    doc.owner?.toHexString();
    const startsAt: Date | null | undefined = doc.startsAt;
    doc.startsAt?.getTime();
    // timestamps are non-null on the hydrated doc (Mongoose always sets them) —
    // no `| null | undefined`, so no guard needed:
    const createdAt: Date = doc.createdAt;
    const updatedAt: Date = doc.updatedAt;
    createdAt.getTime();
    updatedAt.getTime();
    void title;
    void orgName;
    void schedTitle;
    void createdScheduleItemId;
    void createdScheduleTitle;
    void plain;
    void tag;
    void owner;
    void startsAt;
    void createdAt;
    void updatedAt;
  }

  const lean = await M.findOne().lean();
  if (lean) {
    // The one-argument form remains identical on raw and hydrated surfaces.
    const legacyRawTitle: IntlSubDocValue<string> | null | undefined =
      lean.title;
    const rawTitle: IntlText = lean.localizedTitle;
    const rawScheduleTitle: IntlText = lean.localizedSchedule[0].title;
    // @ts-expect-error raw/lean values use the stored locale-map surface
    const invalidRawTitle: typeof lean.localizedTitle = 'Title';
    void legacyRawTitle;
    void rawTitle;
    void rawScheduleTitle;
    void invalidRawTitle;
  }
}

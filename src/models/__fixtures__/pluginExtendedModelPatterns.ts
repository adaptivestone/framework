/**
 * Compile-time coverage for plugin-extended model patterns.
 *
 * Covers plugin-reshaped fields, overrides nested in document arrays,
 * populated nested refs, per-document `$locals`, virtuals added to an authoring
 * document bridge, aggregate facets, Map-based preload caches, sibling method
 * calls, and recovering the model with `$model<T>()` instead of casting
 * `document.constructor`.
 */

import mongoose, { type Schema, type Types } from 'mongoose';
import type {
  GetModelTypeFromClass,
  GetModelTypeLiteFromSchema,
  TsTypeOverride,
} from '../../modules/BaseModel.ts';
import { BaseModel } from '../../modules/BaseModel.ts';

interface IntlValue<V = string> {
  native?: Record<string, V> | null;
  machine?: Record<string, V> | null;
}

function intlString<C extends object>(field: C) {
  return field as C & TsTypeOverride<IntlValue<string>>;
}

const MEDIA_TYPES = ['image', 'video'] as const;

class PluginExtendedRecord extends BaseModel {
  static get modelSchema() {
    return {
      title: intlString({
        type: String,
        required: true,
        intl: true,
      }),
      description: intlString({
        type: String,
        intl: true,
      }),
      key: { type: String, required: true, unique: true },
      groupKey: { type: String },
      enabled: { type: Boolean, default: false },
      owner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
      },
      locations: [
        {
          label: String,
          group: String,
          lat: Number,
          lng: Number,
        },
      ],
      intervals: [
        {
          begin: { type: Date, index: true },
          end: Date,
          title: intlString({ type: String, intl: true }),
          picture: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'File',
          },
        },
      ],
      assets: [
        {
          image: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'File',
          },
          mediaType: {
            type: String,
            enum: MEDIA_TYPES,
          },
          description: String,
          url: String,
          isPrimary: { type: Boolean, default: false },
        },
      ],
      metadata: {
        title: Object,
        description: Object,
        image: Object,
      },
    } as const;
  }

  static get modelVirtuals() {
    return {
      uniqueLocationGroups: {
        options: { type: Number },
        get(this: PluginExtendedBaseDocument): number {
          return new Set(this.locations.map((location) => location.group)).size;
        },
      },
      primaryTitle: {
        options: { type: String },
        get(this: PluginExtendedBaseDocument): string | undefined {
          return (
            this.title.native?.en ?? Object.values(this.title.native ?? {})[0]
          );
        },
      },
    } as const;
  }

  static get modelStatics() {
    return {
      search(
        this: PluginExtendedModelLite,
        text: string,
        skip: number,
        limit: number,
      ) {
        return this.aggregate<{
          getCount: Array<{ count: number }>;
          results: Array<{
            _id: Types.ObjectId;
            key: string;
            locations: Array<{ group?: string }>;
          }>;
        }>([
          {
            $match: {
              $or: [
                { 'title.native.en': { $regex: text, $options: 'i' } },
                { 'locations.group': { $regex: text, $options: 'i' } },
              ],
            },
          },
          {
            $facet: {
              getCount: [{ $count: 'count' }],
              results: [{ $skip: skip }, { $limit: limit }],
            },
          },
        ]);
      },
      mediaSizes() {
        return [
          { width: 1760, height: 990 },
          { width: 520, height: 320 },
        ];
      },
    } as const;
  }

  static get modelInstanceMethods() {
    return {
      async ensureUniqueKey(
        this: PluginExtendedDocument,
        requested: string,
      ): Promise<string> {
        const model = this.$model<PluginExtendedModelLite>();
        const collisions = await model.find(
          {
            _id: { $ne: this._id },
            key: new RegExp(`^${requested}`),
          },
          { key: 1 },
        );
        return collisions.length === 0
          ? requested
          : `${requested}-${collisions.length + 1}`;
      },

      getIntervalRange(this: PluginExtendedDocument) {
        const first = this.intervals[0]?.begin ?? null;
        const last = this.intervals.at(-1)?.end ?? null;
        return { first, last };
      },

      async serialize(
        this: PluginExtendedDocument,
        locale = 'en',
        fileCache: Map<string, unknown> | null = null,
      ) {
        const title =
          this.title.native?.[locale] ??
          this.title.machine?.[locale] ??
          this.primaryTitle ??
          null;
        const assets = this.assets.map((item) => ({
          image: fileCache?.get(String(item.image)) ?? item.image,
          mediaType: item.mediaType,
          description: item.description ?? null,
          url: item.url ?? null,
          isPrimary: item.isPrimary ?? false,
        }));
        return {
          key: this.key,
          groupKey: this.groupKey ?? this.key,
          title,
          locationGroups: this.uniqueLocationGroups,
          interval: this.getIntervalRange(),
          assets,
        };
      },
    } as const;
  }

  static initHooks(schema: Schema) {
    schema.index({ enabled: 1, createdAt: -1 });
    schema.index({ enabled: 1, 'intervals.0.begin': 1 });

    schema.pre('save', function rememberCreation(this: PluginExtendedDocument) {
      this.$locals.wasNew = this.isNew;
      if (!this.groupKey) {
        this.groupKey = this.key;
      }
    });

    schema.post(
      'save',
      function clearCreationFlag(
        this: PluginExtendedDocument,
        saved: PluginExtendedDocument,
      ) {
        if (saved._id.equals(this._id)) {
          this.$locals.wasNew = false;
        }
      },
    );
  }
}

type PluginExtendedModelLite = GetModelTypeLiteFromSchema<
  typeof PluginExtendedRecord.modelSchema
>;
type PluginExtendedBaseDocument = InstanceType<PluginExtendedModelLite>;
type SaveState = { wasNew?: boolean };
type PluginExtendedDocument = PluginExtendedBaseDocument & {
  $locals: SaveState;
  uniqueLocationGroups: number;
  primaryTitle?: string;
  getIntervalRange(): {
    first: Date | null;
    last: Date | null;
  };
};
type PluginExtendedModel = GetModelTypeFromClass<typeof PluginExtendedRecord>;

type PopulatedFile = {
  _id: Types.ObjectId;
  url: string;
  mimeType: string;
};
type PopulatedMediaItem = Omit<
  PluginExtendedBaseDocument['assets'][number],
  'image'
> & {
  image: PopulatedFile;
};

export async function checkPluginExtendedPatterns(M: PluginExtendedModel) {
  const results = await M.search('value', 0, 20);
  const resultKey: string | undefined = results[0]?.results[0]?.key;
  const mediaWidth: number = M.mediaSizes()[0].width;

  const record = await M.findOne();
  if (!record) {
    return;
  }

  const title: IntlValue<string> = record.title;
  const intervalTitle: IntlValue<string> | null | undefined =
    record.intervals[0]?.title;
  const owner: Types.ObjectId = record.owner;
  const locationGroup: string | null | undefined = record.locations[0]?.group;
  const mediaType: 'image' | 'video' | null | undefined =
    record.assets[0]?.mediaType;
  const locationGroups: number = record.uniqueLocationGroups;
  const key: string = await record.ensureUniqueKey('record-key');
  const serialized = await record.serialize('en', new Map());
  const serializedTitle: string | null = serialized.title;

  const populated = await record.populate<{ assets: PopulatedMediaItem[] }>({
    path: 'assets.image',
  });
  const populatedUrl: string | undefined = populated.assets[0]?.image.url;

  void [
    resultKey,
    mediaWidth,
    title,
    intervalTitle,
    owner,
    locationGroup,
    mediaType,
    locationGroups,
    key,
    serializedTitle,
    populatedUrl,
  ];
}

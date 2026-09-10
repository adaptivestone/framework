import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BaseModel, type TsTypeOverride } from '../modules/BaseModel.ts';

function numericGetterField() {
  const field = {
    type: String,
    required: true,
    get: (value: string) => Number(value),
  } as const;
  return field as typeof field & TsTypeOverride<string, number>;
}

describe('model typing runtime parity', () => {
  it('keeps nested ids and getter values aligned with the schema', () => {
    class RuntimeNestedRecord extends BaseModel {
      static get modelSchema() {
        return {
          children: [{ profile: { name: String } }],
          wrapped: { type: { profile: { name: String } } },
          noIds: { type: [{ title: String }], _id: false },
          customProfile: {
            _id: { type: String, required: true },
            name: String,
          },
          bareOverride: [
            {
              title: numericGetterField(),
            },
          ],
          wrappedOverride: {
            type: [
              {
                title: numericGetterField(),
              },
            ],
          },
        } as const;
      }
    }

    const Model = RuntimeNestedRecord.initialize();
    try {
      const doc = new Model({
        children: [{ profile: { name: 'Ada' } }],
        wrapped: { profile: { name: 'Ada' } },
        noIds: [{ title: 'x' }],
        customProfile: { _id: 'external-123', name: 'Ada' },
        bareOverride: [{ title: '2' }],
        wrappedOverride: [{ title: '2' }],
      });

      assert.ok(doc.children[0].profile);
      assert.ok(doc.wrapped?.profile);
      assert.equal(Reflect.get(doc.children[0].profile, '_id'), undefined);
      assert.equal(Reflect.get(doc.wrapped.profile, '_id'), undefined);
      assert.equal(doc.noIds[0]?._id, undefined);
      assert.equal(doc.customProfile?._id, 'external-123');
      assert.equal(doc.bareOverride[0]?.title, 2);
      assert.equal(doc.wrappedOverride[0]?.title, 2);
      assert.ok(doc.wrapped?._id);
      const createdChild = doc.noIds.create({ title: 'created' });
      assert.equal(createdChild._id, undefined);
      assert.equal('save' in createdChild, true);
      const raw = doc.toObject();
      assert.ok(raw.children[0].profile);
      assert.equal(Object.hasOwn(raw.noIds[0], '_id'), false);
      assert.equal(Object.hasOwn(raw.children[0].profile, '_id'), false);
      const hydratedOverride: number = doc.wrappedOverride[0].title;
      const storedOverride: string = raw.wrappedOverride[0].title;
      assert.equal(hydratedOverride, 2);
      assert.equal(storedOverride, '2');
    } finally {
      Model.db.deleteModel(Model.modelName);
    }
  });

  it('honors custom type keys, timestamp options, and top-level id options', () => {
    class RuntimeOptionsRecord extends BaseModel {
      static get modelSchema() {
        return {
          title: { $type: String, required: true },
          children: {
            $type: [
              {
                count: { $type: Number, required: true },
                profile: { label: { $type: String } },
              },
            ],
            _id: false,
          },
        } as const;
      }

      static get schemaOptions() {
        return { typeKey: '$type', timestamps: false } as const;
      }
    }

    class RuntimeNoIdRecord extends BaseModel {
      static get modelSchema() {
        return { title: { type: String, required: true } } as const;
      }

      static get schemaOptions() {
        return { _id: false, timestamps: false } as const;
      }
    }

    class RuntimeExplicitIdRecord extends RuntimeNoIdRecord {
      static get modelSchema() {
        return {
          ...super.modelSchema,
          _id: { type: String, required: true },
        } as const;
      }
    }

    class RuntimeTimestampRecord extends BaseModel {
      static get modelSchema() {
        return RuntimeOptionsRecord.modelSchema;
      }

      static get schemaOptions() {
        return {
          typeKey: '$type',
          timestamps: { createdAt: 'madeAt' },
        } as const;
      }
    }

    const OptionsModel = RuntimeOptionsRecord.initialize();
    const NoIdModel = RuntimeNoIdRecord.initialize();
    const ExplicitIdModel = RuntimeExplicitIdRecord.initialize();
    const TimestampModel = RuntimeTimestampRecord.initialize();
    try {
      const optionsDoc = new OptionsModel({
        title: 'x',
        children: [{ count: 2, profile: { label: 'child' } }],
      });
      assert.equal(optionsDoc.title, 'x');
      assert.ok(optionsDoc.children[0].profile);
      assert.equal(optionsDoc.children[0].count, 2);
      assert.equal(optionsDoc.children[0].profile.label, 'child');
      assert.equal(optionsDoc.children[0]._id, undefined);
      assert.equal(Reflect.get(optionsDoc, 'createdAt'), undefined);
      assert.equal(Reflect.get(optionsDoc, 'updatedAt'), undefined);

      const noIdDoc = new NoIdModel({ title: 'x' });
      assert.equal(Reflect.get(noIdDoc, '_id'), undefined);
      assert.equal(Reflect.get(noIdDoc, 'id'), undefined);
      assert.deepEqual(noIdDoc.toObject(), { title: 'x' });
      const explicitIdDoc = new ExplicitIdModel({
        _id: 'custom-id',
        title: 'x',
      });
      assert.equal(explicitIdDoc._id, 'custom-id');
      assert.equal(explicitIdDoc.id, 'custom-id');
      assert.ok(TimestampModel.schema.path('madeAt'));
      assert.ok(TimestampModel.schema.path('updatedAt'));
      assert.equal(TimestampModel.schema.path('createdAt'), undefined);
    } finally {
      OptionsModel.db.deleteModel(OptionsModel.modelName);
      NoIdModel.db.deleteModel(NoIdModel.modelName);
      ExplicitIdModel.db.deleteModel(ExplicitIdModel.modelName);
      TimestampModel.db.deleteModel(TimestampModel.modelName);
    }
  });

  it('keeps setter-only virtuals writable with undefined reads', () => {
    class RuntimeVirtualRecord extends BaseModel {
      static get modelSchema() {
        return { title: { type: String, required: true } } as const;
      }

      static get modelVirtuals() {
        return {
          writeOnly: {
            set(this: { title: string }, value: string) {
              this.title = value;
            },
          },
        } as const;
      }
    }

    const Model = RuntimeVirtualRecord.initialize();
    try {
      const doc = new Model({ title: 'before' });
      doc.writeOnly = 'after';
      assert.equal(doc.writeOnly, undefined);
      assert.equal(doc.title, 'after');
    } finally {
      Model.db.deleteModel(Model.modelName);
    }
  });
});
